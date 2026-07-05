import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Loader2, Wifi } from 'lucide-react'
import type { InteractiveEffectKind } from '@/types'
import { resolveGlowbeWsUrl } from '@/api'
import { parsePreviewRgbFrame } from '@/lib/preview-frame'
import { useGlowbeRuntime } from '@/GlowbeRuntimeContext'
import { useLayoutUv } from '@/hooks/use-layout-uv'
import { LayoutUvSheet, type TapUvHighlight } from '@/components/LayoutUvMap'
import { LayoutUvSphereCanvas } from '@/components/LayoutUvSphereCanvas'
import { TAP_HIGHLIGHT_DECAY_MS } from '@/lib/layout-uv-geometry'
import { DEFAULT_INTERACTIVE_SETTINGS } from '@/interactive/constants'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'

function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.replace('#', '').trim()
  if (raw.length !== 6 || !/^[0-9a-fA-F]+$/.test(raw)) {
    return [200, 240, 255]
  }
  const n = parseInt(raw, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function connectionLabel(phase: 'idle' | 'connecting' | 'open' | 'closed'): string {
  if (phase === 'connecting') return 'Connecting…'
  if (phase === 'open') return 'Connected'
  if (phase === 'closed') return 'Reconnecting…'
  return 'Idle'
}

export function LiveControls({
  layoutId,
  ledCount,
  outputMode,
  resetSignal = 0,
}: {
  layoutId: string
  ledCount: number
  outputMode: string
  /** Increment to restore pulse / effect UI defaults and push them to the device. */
  resetSignal?: number
}) {
  const { activeDeviceId } = useGlowbeRuntime()
  const { uv, uvError, uvLoading } = useLayoutUv(layoutId, ledCount)
  const [wsPhase, setWsPhase] = useState<'idle' | 'connecting' | 'open' | 'closed'>('idle')
  const [lastWsNote, setLastWsNote] = useState<string | null>(null)
  const [pulseDurationMs, setPulseDurationMs] = useState(
    DEFAULT_INTERACTIVE_SETTINGS.pulseDurationMs,
  )
  const [pulseSigmaDeg, setPulseSigmaDeg] = useState(DEFAULT_INTERACTIVE_SETTINGS.pulseSigmaDeg)
  const [interactiveEffect, setInteractiveEffect] = useState<InteractiveEffectKind>(
    DEFAULT_INTERACTIVE_SETTINGS.interactiveEffect,
  )
  const [colorRandom, setColorRandom] = useState(DEFAULT_INTERACTIVE_SETTINGS.colorRandom)
  const [colorHex, setColorHex] = useState(DEFAULT_INTERACTIVE_SETTINGS.colorHex)
  const [ringSpeed, setRingSpeed] = useState(DEFAULT_INTERACTIVE_SETTINGS.ringSpeed)
  const [ringThicknessDeg, setRingThicknessDeg] = useState(
    DEFAULT_INTERACTIVE_SETTINGS.ringThicknessDeg,
  )
  const [solidBaseEnabled, setSolidBaseEnabled] = useState(
    DEFAULT_INTERACTIVE_SETTINGS.solidBaseEnabled,
  )
  const [solidBaseHex, setSolidBaseHex] = useState(DEFAULT_INTERACTIVE_SETTINGS.solidBaseHex)
  const [pulseHighlights, setPulseHighlights] = useState<TapUvHighlight[]>([])
  const liveRgbBufRef = useRef<Uint8Array | null>(null)
  const [liveRgbRevision, setLiveRgbRevision] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<number | undefined>(undefined)

  const mountedRef = useRef(true)

  const connectWs = useCallback(() => {
    function openWebSocket() {
      if (reconnectTimer.current !== undefined) {
        window.clearTimeout(reconnectTimer.current)
        reconnectTimer.current = undefined
      }
      wsRef.current?.close()
      const url = resolveGlowbeWsUrl(activeDeviceId)
      setWsPhase('connecting')
      const ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws

      ws.onopen = () => {
        setWsPhase('open')
        // ブラウザは接続が成立したあとも onerror を送ることがあり、文言が残り続けるためここで掃除する。
        setLastWsNote(null)
        ws.send(JSON.stringify({ type: 'previewSubscribe', enable: true }))
      }
      ws.onclose = () => {
        setWsPhase('closed')
        wsRef.current = null
        if (!mountedRef.current) return
        reconnectTimer.current = window.setTimeout(() => {
          if (mountedRef.current) openWebSocket()
        }, 2500)
      }
      // WebSocket の error イベントは詳細がなく、接続成功後にも発火することがあるため UI には出さない。
      ws.onerror = () => {
        console.warn('Live WebSocket error event (connection may still recover via onclose/onopen).')
      }
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') {
          const parsed = parsePreviewRgbFrame(ev.data as ArrayBuffer)
          if (!parsed || parsed.rgb.length !== ledCount * 3) return
          const prev = liveRgbBufRef.current
          if (prev?.length === parsed.rgb.length) {
            prev.set(parsed.rgb)
          } else {
            liveRgbBufRef.current = new Uint8Array(parsed.rgb)
          }
          setLiveRgbRevision((n) => n + 1)
          return
        }
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(ev.data) as Record<string, unknown>
        } catch {
          return
        }
        const t = msg.type
        if (t === 'event_status') {
          const st = msg.status
          if (st !== 'ok') setLastWsNote('The effect could not be applied.')
        }
      }
    }
    openWebSocket()
  }, [ledCount, activeDeviceId])

  useEffect(() => {
    mountedRef.current = true
    connectWs()
    return () => {
      mountedRef.current = false
      if (reconnectTimer.current !== undefined) window.clearTimeout(reconnectTimer.current)
      reconnectTimer.current = undefined
      const w = wsRef.current
      if (w && w.readyState === WebSocket.OPEN) {
        try {
          w.send(JSON.stringify({ type: 'previewSubscribe', enable: false }))
        } catch {
          /* ignore */
        }
      }
      w?.close()
      wsRef.current = null
      liveRgbBufRef.current = null
      setLiveRgbRevision(0)
    }
  }, [connectWs, layoutId, ledCount])

  useEffect(() => {
    if (resetSignal <= 0) return
    const d = DEFAULT_INTERACTIVE_SETTINGS
    setPulseDurationMs(d.pulseDurationMs)
    setPulseSigmaDeg(d.pulseSigmaDeg)
    setInteractiveEffect(d.interactiveEffect)
    setColorRandom(d.colorRandom)
    setColorHex(d.colorHex)
    setRingSpeed(d.ringSpeed)
    setRingThicknessDeg(d.ringThicknessDeg)
    setSolidBaseEnabled(d.solidBaseEnabled)
    setSolidBaseHex(d.solidBaseHex)
  }, [resetSignal])

  useEffect(() => {
    if (wsPhase !== 'open') return
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'interactive', action: 'setEffect', effect: interactiveEffect }))
  }, [interactiveEffect, wsPhase])

  useEffect(() => {
    if (wsPhase !== 'open') return
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    const t = window.setTimeout(() => {
      const w = wsRef.current
      if (!w || w.readyState !== WebSocket.OPEN) return
      if (!solidBaseEnabled) {
        w.send(JSON.stringify({ type: 'interactive', action: 'setSolid', enabled: false }))
        return
      }
      const [r, g, b] = hexToRgb(solidBaseHex)
      w.send(
        JSON.stringify({
          type: 'interactive',
          action: 'setSolid',
          enabled: true,
          colorRgb: [r, g, b],
        }),
      )
    }, 180)
    return () => window.clearTimeout(t)
  }, [solidBaseEnabled, solidBaseHex, wsPhase])

  useEffect(() => {
    if (pulseHighlights.length === 0) return
    const id = window.setInterval(() => {
      const now = performance.now()
      setPulseHighlights((prev) =>
        prev.filter((h) => now - h.t0 < TAP_HIGHLIGHT_DECAY_MS + 120),
      )
    }, 180)
    return () => window.clearInterval(id)
  }, [pulseHighlights.length])

  const sendInteractivePulse = (u: number, v: number) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setLastWsNote('Not connected — wait for the link to open, then try again.')
      return
    }
    const sigmaRad = (pulseSigmaDeg * Math.PI) / 180
    const [r, g, b] = hexToRgb(colorHex)
    const ringThicknessRad = ringThicknessDeg <= 0 ? 0 : (ringThicknessDeg * Math.PI) / 180
    const payload: Record<string, unknown> = {
      type: 'interactive',
      action: 'pulse',
      u,
      v,
      amplitude: 1.0,
      durationMs: pulseDurationMs,
      sigmaRad,
      effect: interactiveEffect,
      colorRandom,
    }
    if (!colorRandom) {
      payload.colorRgb = [r, g, b]
    }
    if (interactiveEffect === 'expandingRingDiagonal') {
      payload.ringSpeed = ringSpeed
      payload.ringThicknessRad = ringThicknessRad
    }
    ws.send(JSON.stringify(payload))
  }

  const canInteractive = outputMode === 'interactive'

  const handleInteractiveTapUv = (u: number, v: number, uSphere?: number) => {
    if (!canInteractive) return
    const id = crypto.randomUUID()
    const t0 = performance.now()
    setPulseHighlights((prev) => {
      const now = t0
      const pruned = prev.filter((h) => now - h.t0 < TAP_HIGHLIGHT_DECAY_MS + 80)
      const next: TapUvHighlight = { id, u, v, t0 }
      if (uSphere !== undefined) next.uSphere = uSphere
      return [...pruned, next]
    })
    sendInteractivePulse(u, v)
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-1 space-y-0 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Wifi className="size-5 text-muted-foreground" aria-hidden />
            Live map
          </CardTitle>
          <CardDescription className="text-xs">
            {connectionLabel(wsPhase)}
            {uvLoading ? ' · Map loading…' : uv ? ` · ${uv.leds.length} LEDs` : ''}
          </CardDescription>
        </div>
        {wsPhase === 'connecting' ? <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Connecting" /> : null}
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          The 2:1 map and 3D sphere share device UV. Drag with one finger to orbit; tap with another finger for
          pulses. Use the slider under the sphere for camera distance (zoom).
        </p>

          {uvLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Loading layout map…
            </p>
          ) : null}
          {uvError ? (
            <p className="max-w-full break-words text-sm text-destructive" role="alert">
              Could not load the LED layout for this device. {uvError}
            </p>
          ) : null}

          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-xs font-semibold">Effect</Label>
                <Select
                  value={interactiveEffect}
                  onValueChange={(v) => setInteractiveEffect(v as InteractiveEffectKind)}
                  disabled={!canInteractive}
                >
                  <SelectTrigger className="w-full text-xs" aria-label="Interactive effect">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sphereGaussian">Soft spot</SelectItem>
                    <SelectItem value="expandingRingDiagonal">Expanding ring</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {interactiveEffect === 'sphereGaussian' ? (
                <>
                  <div className="space-y-2 sm:col-span-1">
                    <div className="flex justify-between gap-2">
                      <Label className="text-xs font-semibold">Duration (ms)</Label>
                      <span className="text-xs text-muted-foreground tabular-nums">{pulseDurationMs}</span>
                    </div>
                    <Slider
                      disabled={!canInteractive}
                      min={100}
                      max={5000}
                      step={50}
                      value={[pulseDurationMs]}
                      onValueChange={(v) => setPulseDurationMs(v[0]!)}
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-1">
                    <div className="flex justify-between gap-2">
                      <Label className="text-xs font-semibold">Spot radius (σ, °)</Label>
                      <span className="text-xs text-muted-foreground tabular-nums">{pulseSigmaDeg}°</span>
                    </div>
                    <Slider
                      disabled={!canInteractive}
                      min={2}
                      max={34}
                      step={1}
                      value={[pulseSigmaDeg]}
                      onValueChange={(v) => setPulseSigmaDeg(v[0]!)}
                    />
                  </div>
                </>
              ) : null}

              {interactiveEffect === 'expandingRingDiagonal' ? (
                <>
                  <div className="space-y-2">
                    <div className="flex justify-between gap-2">
                      <Label className="text-xs font-semibold">Propagation speed</Label>
                      <span className="text-xs text-muted-foreground tabular-nums">{ringSpeed.toFixed(2)}×</span>
                    </div>
                    <Slider
                      disabled={!canInteractive}
                      min={25}
                      max={400}
                      step={5}
                      value={[Math.round(ringSpeed * 100)]}
                      onValueChange={(v) => setRingSpeed(v[0]! / 100)}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between gap-2">
                      <Label className="text-xs font-semibold">Wavefront width</Label>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {ringThicknessDeg <= 0 ? 'auto' : `${ringThicknessDeg}°`}
                      </span>
                    </div>
                    <Slider
                      disabled={!canInteractive}
                      min={0}
                      max={28}
                      step={1}
                      value={[ringThicknessDeg]}
                      onValueChange={(v) => setRingThicknessDeg(v[0]!)}
                    />
                  </div>
                </>
              ) : null}
            </div>

            <Separator />

            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  id="solid-base"
                  checked={solidBaseEnabled}
                  onCheckedChange={setSolidBaseEnabled}
                  disabled={!canInteractive}
                />
                <Label htmlFor="solid-base" className="text-xs font-semibold">
                  Solid base
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="solid-base-color" className="text-xs text-muted-foreground">
                  Base color
                </Label>
                <input
                  id="solid-base-color"
                  type="color"
                  value={solidBaseHex}
                  disabled={!canInteractive || !solidBaseEnabled}
                  onChange={(e) => setSolidBaseHex(e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent disabled:opacity-40"
                  aria-label="Interactive solid base color"
                />
              </div>
            </div>

            <Separator />

            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  id="color-random"
                  checked={colorRandom}
                  onCheckedChange={setColorRandom}
                  disabled={!canInteractive}
                />
                <Label htmlFor="color-random" className="text-xs font-semibold">
                  Random tint
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="tint-color" className="text-xs text-muted-foreground">
                  Color
                </Label>
                <input
                  id="tint-color"
                  type="color"
                  value={colorHex}
                  disabled={!canInteractive || colorRandom}
                  onChange={(e) => setColorHex(e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent disabled:opacity-40"
                  aria-label="Pulse tint color"
                />
              </div>
            </div>
          </div>

          {lastWsNote ? (
            <p className="text-xs text-muted-foreground" role="status">
              {lastWsNote}
            </p>
          ) : null}

        {uv && !uvLoading ? (
          <div className="flex flex-col gap-8">
            <div className="min-w-0 space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Equirect (2D)</p>
              <LayoutUvSheet
                uv={uv}
                disabled={!canInteractive}
                pulseHighlights={pulseHighlights}
                liveLedRgb={liveRgbBufRef.current}
                liveLedRevision={liveRgbRevision}
                onEquirectClick={canInteractive ? handleInteractiveTapUv : undefined}
              />
            </div>
            <div className="min-w-0 space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Sphere (Three.js)</p>
              <LayoutUvSphereCanvas
                uv={uv}
                disabled={!canInteractive}
                pulseHighlights={pulseHighlights}
                liveLedRgb={liveRgbBufRef.current ?? undefined}
                onSphereTap={handleInteractiveTapUv}
              />
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
