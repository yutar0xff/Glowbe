import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Loader2, Wifi } from 'lucide-react'
import type { MateSummary, RuntimeState } from '@/types'
import { API_BASE, apiDeviceQuery, resolveGlowbeWsUrl } from '@/api'
import { parsePreviewRgbFrame } from '@/lib/preview-frame'
import { useGlowbeRuntime } from '@/GlowbeRuntimeContext'
import { useLayoutUv } from '@/hooks/use-layout-uv'
import { LayoutUvSheet, type TapUvHighlight } from '@/components/LayoutUvMap'
import { LayoutUvSphereCanvas } from '@/components/LayoutUvSphereCanvas'
import { TAP_HIGHLIGHT_DECAY_MS } from '@/lib/layout-uv-geometry'
import { Button } from '@/components/ui/button'
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

const EXPRESSIONS = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'sleepy',
  'surprised',
  'curious',
  'playful',
] as const

const MOODS = ['calm', 'curious', 'playful', 'sleepy', 'alert'] as const

const ROUTINES = ['drift', 'orbit', 'figure8', 'spiralPole', 'wander'] as const

function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.replace('#', '').trim()
  if (raw.length !== 6 || !/^[0-9a-fA-F]+$/.test(raw)) {
    return [200, 240, 255]
  }
  const n = parseInt(raw, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

function defaultMateControls(): MateSummary {
  return {
    expression: 'neutral',
    mood: 'calm',
    idleRoutine: 'orbit',
    gazeU: 0.5,
    gazeV: 0.42,
    gazePull: 0.55,
    cluster: 0.15,
    idleSpeed: 0.35,
    color: [200, 240, 255],
    brightness: 0.92,
    faceAngularRadiusDeg: 58,
    featureScale: 0.32,
    eyeSpacing: 0.52,
    dynamics: {
      stiffness: 6,
      damping: 0.72,
      floatiness: 0.35,
      trailLag: 0.28,
    },
    autoBreath: true,
    autoBlink: true,
    autoSaccade: true,
    autoTremor: false,
  }
}

function mergeMateFromServer(m: MateSummary | null | undefined): MateSummary {
  const d = defaultMateControls()
  if (!m) return d
  return {
    ...d,
    ...m,
    dynamics: { ...d.dynamics, ...m.dynamics },
  }
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] leading-snug text-muted-foreground">{children}</p>
}

function connectionLabel(phase: 'idle' | 'connecting' | 'open' | 'closed'): string {
  if (phase === 'connecting') return 'Connecting…'
  if (phase === 'open') return 'Connected'
  if (phase === 'closed') return 'Reconnecting…'
  return 'Idle'
}

export function MateModePanel({ state }: { state: RuntimeState }) {
  const { refreshLoad, activeDeviceId } = useGlowbeRuntime()
  const canMate = state.mode === 'mate'
  const { uv, uvError, uvLoading } = useLayoutUv(state.layoutId, state.ledCount)
  const [wsPhase, setWsPhase] = useState<'idle' | 'connecting' | 'open' | 'closed'>('idle')
  const [lastNote, setLastNote] = useState<string | null>(null)
  const [pulseHighlights, setPulseHighlights] = useState<TapUvHighlight[]>([])
  const liveRgbBufRef = useRef<Uint8Array | null>(null)
  const [liveRgbRevision, setLiveRgbRevision] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const reconnectTimer = useRef<number | undefined>(undefined)
  const mountedRef = useRef(true)

  const [ctrl, setCtrl] = useState(() => mergeMateFromServer(state.mate))
  const [colorHex, setColorHex] = useState(() =>
    rgbToHex(...(state.mate?.color ?? [200, 240, 255])),
  )

  useEffect(() => {
    setCtrl(mergeMateFromServer(state.mate))
    if (state.mate?.color) {
      setColorHex(rgbToHex(state.mate.color[0]!, state.mate.color[1]!, state.mate.color[2]!))
    }
  }, [state.mate])

  const sendMate = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setLastNote('WebSocket is not connected yet. Wait for “Connected”, then try again.')
      return
    }
    ws.send(JSON.stringify({ type: 'mate', ...payload }))
  }, [])

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
        setLastNote(null)
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
      ws.onerror = () => {
        console.warn('Mate WebSocket error event.')
      }
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') {
          const parsed = parsePreviewRgbFrame(ev.data as ArrayBuffer)
          if (!parsed || parsed.rgb.length !== stateRef.current.ledCount * 3) return
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
        if (msg.type === 'event_status' && msg.event === 'mate' && msg.status === 'error') {
          setLastNote(typeof msg.reason === 'string' ? msg.reason : 'Mate update failed.')
        }
        if (msg.type === 'event_status' && msg.event === 'mate' && msg.status === 'ok') {
          setLastNote(null)
        }
      }
    }
    openWebSocket()
  }, [activeDeviceId])

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
  }, [connectWs, state.layoutId, activeDeviceId])

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

  const postMateState = useCallback(async (body: Record<string, unknown>): Promise<boolean> => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 3500)
    try {
      const q = apiDeviceQuery(activeDeviceId)
      const res = await fetch(`${API_BASE}/api/v1/mate/state${q}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok) {
        const t = await res.text()
        setLastNote(t || `HTTP ${res.status}`)
        return false
      }
      return true
    } catch (e) {
      setLastNote(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      window.clearTimeout(timeout)
    }
  }, [activeDeviceId])

  const followExpressionTint = useCallback(async () => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      sendMate({ action: 'setAppearance', useExpressionTint: true })
      window.setTimeout(() => void refreshLoad(), 200)
      return
    }
    const ok = await postMateState({ useExpressionTint: true })
    if (ok) await refreshLoad()
  }, [postMateState, refreshLoad, sendMate])

  const handleGazeTap = (u: number, v: number, uSphere?: number) => {
    if (!canMate) return
    const id = crypto.randomUUID()
    const t0 = performance.now()
    setPulseHighlights((prev) => {
      const now = t0
      const pruned = prev.filter((h) => now - h.t0 < TAP_HIGHLIGHT_DECAY_MS + 80)
      const next: TapUvHighlight = { id, u, v, t0 }
      if (uSphere !== undefined) next.uSphere = uSphere
      return [...pruned, next]
    })
    sendMate({ action: 'setGaze', u, v })
    setCtrl((c) => ({ ...c, gazeU: u, gazeV: v }))
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-1 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Wifi className="size-5 text-muted-foreground" aria-hidden />
              Mate (live)
            </CardTitle>
            <CardDescription className="text-xs">
              {connectionLabel(wsPhase)}
              {uvLoading ? ' · Loading map…' : uv ? ` · ${uv.leds.length} LEDs` : ''}
            </CardDescription>
          </div>
          {wsPhase === 'connecting' ? (
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Connecting" />
          ) : null}
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">Quick guide</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>
                <strong className="text-foreground">Expression</strong> — preset face shape; each has its own
                tint that can drive LED color when not using a fixed color.
              </li>
              <li>
                <strong className="text-foreground">Mood</strong> — tweaks motion feel (spring strength) on top
                of the expression.
              </li>
              <li>
                <strong className="text-foreground">Idle routine</strong> — how the face wanders on the sphere
                when idle; <strong>Idle speed</strong> sets how fast that path runs.
              </li>
              <li>
                <strong className="text-foreground">Gaze pull</strong> — 0: eyes only toward target; 1: whole
                face rotates toward the gaze target on the sphere.
              </li>
              <li>
                <strong className="text-foreground">Cluster</strong> — shifts highlights toward the gaze side
                (more “looking that way” on low LED counts).
              </li>
              <li>
                <strong className="text-foreground">2D / sphere map</strong> — tap to set gaze UV (where the
                buddy “looks”).
              </li>
              <li>
                <strong className="text-foreground">Dynamics</strong> — how quickly the face catches the target
                (stiffness), overshoot (damping), extra lag (floatiness / trail).
              </li>
              <li>
                <strong className="text-foreground">Brightness</strong> — mate render gain before master tone.
              </li>
              <li>
                <strong className="text-foreground">Face angular radius</strong> — where parts are placed and
                clipped on the sphere (58° ≈ one quarter).{' '}
                <strong className="text-foreground">Feature scale</strong> — eye and mouth size.{' '}
                <strong className="text-foreground">Eye spacing</strong> — distance between eyes.
              </li>
              <li>
                <strong className="text-foreground">Fixed color</strong> — locks LED tint; use{' '}
                <strong className="text-foreground">Use expression tint</strong> to follow the preset color again.
              </li>
              <li>
                <strong className="text-foreground">Mouth</strong> — demo open amount or return mouth motion to
                the expression preset.
              </li>
              <li>
                <strong className="text-foreground">Auto motion</strong> — breath, blink, micro-saccades, tremor
                overlays.
              </li>
            </ul>
          </div>

          {!canMate ? (
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Output mode is not Mate. Select the <strong>Mate</strong> tab above to use these controls.
            </p>
          ) : null}

          <div className="space-y-3">
            <Label className="text-xs font-semibold">Expression</Label>
            <Hint>Preset face shape and default tint channel for the LEDs.</Hint>
            <div className="flex flex-wrap gap-2">
              {EXPRESSIONS.map((ex) => (
                <Button
                  key={ex}
                  type="button"
                  size="sm"
                  variant={ctrl.expression === ex ? 'default' : 'outline'}
                  disabled={!canMate}
                  className="text-xs capitalize"
                  onClick={() => {
                    sendMate({ action: 'setExpression', expression: ex })
                    setCtrl((c) => ({ ...c, expression: ex }))
                  }}
                >
                  {ex}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Mood</Label>
              <Hint>Calmer vs snappier motion (affects spring feel).</Hint>
              <Select
                value={ctrl.mood}
                disabled={!canMate}
                onValueChange={(mood) => {
                  sendMate({ action: 'setMood', mood })
                  setCtrl((c) => ({ ...c, mood }))
                }}
              >
                <SelectTrigger className="w-full text-xs" aria-label="Mood">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MOODS.map((m) => (
                    <SelectItem key={m} value={m} className="text-xs capitalize">
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Idle routine</Label>
              <Hint>Path the face follows on the sphere while idle.</Hint>
              <Select
                value={ctrl.idleRoutine}
                disabled={!canMate}
                onValueChange={(routine) => {
                  sendMate({ action: 'setIdle', routine })
                  setCtrl((c) => ({ ...c, idleRoutine: routine }))
                }}
              >
                <SelectTrigger className="w-full text-xs" aria-label="Idle routine">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROUTINES.map((r) => (
                    <SelectItem key={r} value={r} className="text-xs">
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between gap-2">
              <Label className="text-xs font-semibold">Idle speed</Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {ctrl.idleSpeed.toFixed(2)}
              </span>
            </div>
            <Hint>How fast the idle path runs (higher = more movement).</Hint>
            <Slider
              disabled={!canMate}
              min={2}
              max={200}
              step={1}
              value={[Math.round(ctrl.idleSpeed * 100)]}
              onValueChange={(v) => {
                const speed = v[0]! / 100
                setCtrl((c) => ({ ...c, idleSpeed: speed }))
                sendMate({ action: 'setIdle', routine: ctrl.idleRoutine, speed })
              }}
            />
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex justify-between gap-2">
                <Label className="text-xs font-semibold">Gaze pull</Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {ctrl.gazePull.toFixed(2)}
                </span>
              </div>
              <Hint>Blend from “eyes only” (0) toward “whole face turns to target” (1).</Hint>
              <Slider
                disabled={!canMate}
                min={0}
                max={100}
                step={1}
                value={[Math.round(ctrl.gazePull * 100)]}
                onValueChange={(v) => {
                  const gazePull = v[0]! / 100
                  setCtrl((c) => ({ ...c, gazePull }))
                  sendMate({ action: 'setGaze', gazePull })
                }}
              />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between gap-2">
                <Label className="text-xs font-semibold">Cluster</Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {ctrl.cluster.toFixed(2)}
                </span>
              </div>
              <Hint>How much features bias toward the gaze direction on the tangent plane.</Hint>
              <Slider
                disabled={!canMate}
                min={0}
                max={100}
                step={1}
                value={[Math.round(ctrl.cluster * 100)]}
                onValueChange={(v) => {
                  const cluster = v[0]! / 100
                  setCtrl((c) => ({ ...c, cluster }))
                  sendMate({ action: 'setGaze', cluster })
                }}
              />
            </div>
          </div>

          <Separator />

          <p className="text-sm text-muted-foreground">
            Tap the 2:1 map or the sphere to set gaze target UV (same layout as the device).
          </p>
          {uvLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading layout UV…
            </p>
          ) : null}
          {uvError ? (
            <p className="max-w-full break-words text-sm text-destructive" role="alert">
              Could not load layout UV. {uvError}
            </p>
          ) : null}
          {uv && !uvLoading ? (
            <div className="flex flex-col gap-8">
              <div className="min-w-0 space-y-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Equirect (2D)
                </p>
                <LayoutUvSheet
                  uv={uv}
                  disabled={!canMate}
                  pulseHighlights={pulseHighlights}
                  liveLedRgb={liveRgbBufRef.current}
                  liveLedRevision={liveRgbRevision}
                  onEquirectClick={canMate ? handleGazeTap : undefined}
                />
              </div>
              <div className="min-w-0 space-y-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Sphere (Three.js)
                </p>
                <LayoutUvSphereCanvas
                  uv={uv}
                  disabled={!canMate}
                  pulseHighlights={pulseHighlights}
                  liveLedRgb={liveRgbBufRef.current ?? undefined}
                  onSphereTap={handleGazeTap}
                />
              </div>
            </div>
          ) : null}

          <Separator />

          <p className="text-xs font-semibold text-foreground">Liquid motion (dynamics)</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex justify-between gap-2">
                <Label className="text-xs font-semibold">Stiffness</Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {ctrl.dynamics.stiffness.toFixed(1)}
                </span>
              </div>
              <Hint>Higher = face snaps to target faster.</Hint>
              <Slider
                disabled={!canMate}
                min={5}
                max={300}
                step={1}
                value={[Math.round(ctrl.dynamics.stiffness * 10)]}
                onValueChange={(v) => {
                  const stiffness = v[0]! / 10
                  const next = { ...ctrl.dynamics, stiffness }
                  setCtrl((c) => ({ ...c, dynamics: next }))
                  sendMate({ action: 'setDynamics', stiffness })
                }}
              />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between gap-2">
                <Label className="text-xs font-semibold">Damping</Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {ctrl.dynamics.damping.toFixed(2)}
                </span>
              </div>
              <Hint>Higher = less overshoot / wobble after moves.</Hint>
              <Slider
                disabled={!canMate}
                min={0}
                max={95}
                step={1}
                value={[Math.round(ctrl.dynamics.damping * 100)]}
                onValueChange={(v) => {
                  const damping = v[0]! / 100
                  const next = { ...ctrl.dynamics, damping }
                  setCtrl((c) => ({ ...c, dynamics: next }))
                  sendMate({ action: 'setDynamics', damping })
                }}
              />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between gap-2">
                <Label className="text-xs font-semibold">Floatiness</Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {ctrl.dynamics.floatiness.toFixed(2)}
                </span>
              </div>
              <Hint>Extra ease / lag on top of stiffness.</Hint>
              <Slider
                disabled={!canMate}
                min={0}
                max={200}
                step={1}
                value={[Math.round(ctrl.dynamics.floatiness * 100)]}
                onValueChange={(v) => {
                  const floatiness = v[0]! / 100
                  const next = { ...ctrl.dynamics, floatiness }
                  setCtrl((c) => ({ ...c, dynamics: next }))
                  sendMate({ action: 'setDynamics', floatiness })
                }}
              />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between gap-2">
                <Label className="text-xs font-semibold">Trail lag</Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {ctrl.dynamics.trailLag.toFixed(2)}
                </span>
              </div>
              <Hint>Secondary follow-through (higher = more trailing motion).</Hint>
              <Slider
                disabled={!canMate}
                min={0}
                max={95}
                step={1}
                value={[Math.round(ctrl.dynamics.trailLag * 100)]}
                onValueChange={(v) => {
                  const trailLag = v[0]! / 100
                  const next = { ...ctrl.dynamics, trailLag }
                  setCtrl((c) => ({ ...c, dynamics: next }))
                  sendMate({ action: 'setDynamics', trailLag })
                }}
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex justify-between gap-2">
              <Label className="text-xs font-semibold">Brightness (mate)</Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {ctrl.brightness.toFixed(2)}
              </span>
            </div>
            <Hint>Gain on the mate face layer (master tone still applies afterward).</Hint>
            <Slider
              disabled={!canMate}
              min={0}
              max={200}
              step={1}
              value={[Math.round(ctrl.brightness * 100)]}
              onValueChange={(v) => {
                const brightness = v[0]! / 100
                setCtrl((c) => ({ ...c, brightness }))
                sendMate({ action: 'setAppearance', brightness })
              }}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex justify-between gap-2">
                <Label className="text-xs font-semibold">Face angular radius</Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {ctrl.faceAngularRadiusDeg.toFixed(0)}°
                </span>
              </div>
              <Hint>Part placement region (half-angle); parts only light up, no face fill.</Hint>
              <Slider
                disabled={!canMate}
                min={35}
                max={75}
                step={1}
                value={[Math.round(ctrl.faceAngularRadiusDeg)]}
                onValueChange={(v) => {
                  const faceAngularRadiusDeg = v[0]!
                  setCtrl((c) => ({ ...c, faceAngularRadiusDeg }))
                  sendMate({ action: 'setAppearance', faceAngularRadiusDeg })
                }}
              />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between gap-2">
                <Label className="text-xs font-semibold">Feature scale</Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {ctrl.featureScale.toFixed(2)}
                </span>
              </div>
              <Hint>Eye, brow, and mouth size relative to the part region.</Hint>
              <Slider
                disabled={!canMate}
                min={12}
                max={55}
                step={1}
                value={[Math.round(ctrl.featureScale * 100)]}
                onValueChange={(v) => {
                  const featureScale = v[0]! / 100
                  setCtrl((c) => ({ ...c, featureScale }))
                  sendMate({ action: 'setAppearance', featureScale })
                }}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <div className="flex justify-between gap-2">
                <Label className="text-xs font-semibold">Eye spacing</Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {ctrl.eyeSpacing.toFixed(2)}
                </span>
              </div>
              <Hint>Horizontal distance between eye centers (fraction of face width).</Hint>
              <Slider
                disabled={!canMate}
                min={30}
                max={70}
                step={1}
                value={[Math.round(ctrl.eyeSpacing * 100)]}
                onValueChange={(v) => {
                  const eyeSpacing = v[0]! / 100
                  setCtrl((c) => ({ ...c, eyeSpacing }))
                  sendMate({ action: 'setAppearance', eyeSpacing })
                }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="mate-color" className="text-xs text-muted-foreground">
                Fixed tint
              </Label>
              <input
                id="mate-color"
                type="color"
                value={colorHex}
                disabled={!canMate}
                onChange={(e) => {
                  const hex = e.target.value
                  setColorHex(hex)
                  const [r, g, b] = hexToRgb(hex)
                  sendMate({ action: 'setAppearance', color: [r, g, b] })
                  setCtrl((c) => ({ ...c, color: [r, g, b] }))
                }}
                className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent disabled:opacity-40"
                aria-label="Mate fixed tint color"
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="text-xs"
              disabled={!canMate}
              onClick={() => void followExpressionTint()}
            >
              Use expression tint
            </Button>
          </div>
          <Hint>
            Fixed tint locks LED color to your picker. “Use expression tint” removes the lock and snaps to the
            current expression&apos;s preset color (then continues to follow expression changes).
          </Hint>

          <Separator />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs"
              disabled={!canMate}
              onClick={() => {
                sendMate({ action: 'clearMouthOpen' })
              }}
            >
              Reset mouth to expression
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="text-xs"
              disabled={!canMate}
              onClick={() => sendMate({ action: 'setMouthOpen', value: 0.35 })}
            >
              Demo mouth open
            </Button>
          </div>
          <Hint>Manual mouth override for testing; reset returns control to the expression preset.</Hint>

          <Separator />

          <p className="text-xs font-semibold text-foreground">Automatic motion</p>
          <Hint>Breath: subtle sway · Blink: random eye closure · Saccade: tiny gaze jumps · Tremor: micro shake.</Hint>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-2 rounded-md border p-2">
              <Label className="text-xs font-semibold">Breath</Label>
              <Switch
                checked={ctrl.autoBreath}
                disabled={!canMate}
                onCheckedChange={(checked) => {
                  setCtrl((c) => ({ ...c, autoBreath: checked }))
                  sendMate({ action: 'setAuto', breath: checked })
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-2 rounded-md border p-2">
              <Label className="text-xs font-semibold">Blink</Label>
              <Switch
                checked={ctrl.autoBlink}
                disabled={!canMate}
                onCheckedChange={(checked) => {
                  setCtrl((c) => ({ ...c, autoBlink: checked }))
                  sendMate({ action: 'setAuto', blink: checked })
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-2 rounded-md border p-2">
              <Label className="text-xs font-semibold">Saccade</Label>
              <Switch
                checked={ctrl.autoSaccade}
                disabled={!canMate}
                onCheckedChange={(checked) => {
                  setCtrl((c) => ({ ...c, autoSaccade: checked }))
                  sendMate({ action: 'setAuto', saccade: checked })
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-2 rounded-md border p-2">
              <Label className="text-xs font-semibold">Tremor</Label>
              <Switch
                checked={ctrl.autoTremor}
                disabled={!canMate}
                onCheckedChange={(checked) => {
                  setCtrl((c) => ({ ...c, autoTremor: checked }))
                  sendMate({ action: 'setAuto', tremor: checked })
                }}
              />
            </div>
          </div>

          {lastNote ? (
            <p className="text-xs text-muted-foreground" role="status">
              {lastNote}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
