import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { MouseEvent } from 'react'
import type { InteractiveEffectKind, LayoutUvResponse } from '../types'
import { API_BASE, resolveGlowbeWsUrl } from '../api'

function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.replace('#', '').trim()
  if (raw.length !== 6 || !/^[0-9a-fA-F]+$/.test(raw)) {
    return [200, 240, 255]
  }
  const n = parseInt(raw, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function LiveControls({
  layoutId,
  ledCount,
  outputMode,
}: {
  layoutId: string
  ledCount: number
  outputMode: string
}) {
  const [uv, setUv] = useState<LayoutUvResponse | null>(null)
  const [uvError, setUvError] = useState<string | null>(null)
  const [uvLoading, setUvLoading] = useState(true)
  const [wsPhase, setWsPhase] = useState<'idle' | 'connecting' | 'open' | 'closed'>('idle')
  const [lastWsNote, setLastWsNote] = useState<string | null>(null)
  const [pulseDurationMs, setPulseDurationMs] = useState(450)
  const [pulseSigmaDeg, setPulseSigmaDeg] = useState(8)
  const [interactiveEffect, setInteractiveEffect] = useState<InteractiveEffectKind>('sphereGaussian')
  const [colorRandom, setColorRandom] = useState(false)
  const [colorHex, setColorHex] = useState('#c8f0ff')
  const [ringSpeed, setRingSpeed] = useState(1)
  const [ringThicknessDeg, setRingThicknessDeg] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset UV UI before async fetch
    setUvLoading(true)
    setUv(null)
    setUvError(null)
    ;(async () => {
      try {
        const r = await fetch(`${API_BASE}/api/v1/layout/uv`)
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = (await r.json()) as LayoutUvResponse
        if (cancelled) return
        if (j.ledCount !== ledCount) {
          setUvError(
            `ledmap ledCount (${j.ledCount}) does not match runtime ledCount (${ledCount})`,
          )
          setUv(null)
        } else if (j.ledCount !== j.leds.length) {
          setUvError('ledCount does not match leds[] length')
          setUv(null)
        } else {
          setUv(j)
        }
      } catch (e) {
        if (!cancelled) {
          setUv(null)
          setUvError(e instanceof Error ? e.message : String(e))
        }
      } finally {
        if (!cancelled) setUvLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [layoutId, ledCount])

  const mountedRef = useRef(true)

  const connectWs = useCallback(() => {
    function openWebSocket() {
      if (reconnectTimer.current !== undefined) {
        window.clearTimeout(reconnectTimer.current)
        reconnectTimer.current = undefined
      }
      wsRef.current?.close()
      const url = resolveGlowbeWsUrl()
      setWsPhase('connecting')
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        setWsPhase('open')
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
        setLastWsNote('WebSocket error (check runtime / proxy)')
      }
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(ev.data) as Record<string, unknown>
        } catch {
          return
        }
        const t = msg.type
        if (t === 'event_status') {
          const evName = msg.event
          const st = msg.status
          setLastWsNote(`event_status ${String(evName)}: ${String(st)}`)
        }
      }
    }
    openWebSocket()
  }, [])

  useEffect(() => {
    mountedRef.current = true
    connectWs()
    return () => {
      mountedRef.current = false
      if (reconnectTimer.current !== undefined) window.clearTimeout(reconnectTimer.current)
      reconnectTimer.current = undefined
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [connectWs, layoutId])

  useEffect(() => {
    if (wsPhase !== 'open') return
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'interactive', action: 'setEffect', effect: interactiveEffect }))
  }, [interactiveEffect, wsPhase])

  const sendInteractivePulse = (u: number, v: number) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setLastWsNote('interactive: WebSocket not open')
      return
    }
    const sigmaRad = (pulseSigmaDeg * Math.PI) / 180
    const [r, g, b] = hexToRgb(colorHex)
    const ringThicknessRad =
      ringThicknessDeg <= 0 ? 0 : (ringThicknessDeg * Math.PI) / 180
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

  const canInteractive = outputMode === 'interactive' || outputMode === 'ripple'

  const onUvSvgClick = (e: MouseEvent<SVGSVGElement>) => {
    if (!canInteractive) return
    const svg = e.currentTarget
    const r = svg.getBoundingClientRect()
    const u = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const v = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    sendInteractivePulse(u, v)
  }

  return (
    <section className="panel interactive-panel">
      <div className="panel-heading">
        <h2>Live (WebSocket)</h2>
        <span className="muted">
          WS: {wsPhase}
          {uvLoading ? ' · UV map…' : uv ? ` · ${uv.leds.length} LEDs` : ''}
        </span>
      </div>
      <p className="muted">
        Equirectangular UV (2:1). Choose an effect and tint, then click to stack <code>interactive</code> pulses;
        the runtime composites all active pulses on the UDP stream only in <strong>interactive</strong> output mode.
      </p>
      <div className={`ripple-params${canInteractive ? '' : ' ripple-params--disabled'}`}>
        <label className="ripple-param ripple-param--select">
          <span className="ripple-param-label">Effect</span>
          <select
            value={interactiveEffect}
            disabled={!canInteractive}
            onChange={(e) => setInteractiveEffect(e.target.value as InteractiveEffectKind)}
            aria-label="Interactive effect"
          >
            <option value="sphereGaussian">Sphere Gaussian (soft spot)</option>
            <option value="expandingRingDiagonal">Expanding ring (isotropic)</option>
          </select>
        </label>
        {interactiveEffect === 'sphereGaussian' ? (
          <>
            <label className="ripple-param">
              <span className="ripple-param-label">Duration (ms)</span>
              <input
                type="range"
                min={100}
                max={5000}
                step={50}
                value={pulseDurationMs}
                disabled={!canInteractive}
                onChange={(e) => setPulseDurationMs(Number(e.target.value))}
              />
              <span className="ripple-param-value">{pulseDurationMs}</span>
            </label>
            <label className="ripple-param">
              <span className="ripple-param-label">Spot radius (σ, °)</span>
              <input
                type="range"
                min={2}
                max={34}
                step={1}
                value={pulseSigmaDeg}
                disabled={!canInteractive}
                onChange={(e) => setPulseSigmaDeg(Number(e.target.value))}
              />
              <span className="ripple-param-value">{pulseSigmaDeg}°</span>
            </label>
          </>
        ) : null}
        <label className="ripple-param ripple-param--color">
          <span className="ripple-param-label">Tint</span>
          <div className="ripple-color-controls">
            <label className="ripple-check">
              <input
                type="checkbox"
                checked={colorRandom}
                disabled={!canInteractive}
                onChange={(e) => setColorRandom(e.target.checked)}
              />
              Random
            </label>
            <input
              type="color"
              value={colorHex}
              disabled={!canInteractive || colorRandom}
              onChange={(e) => setColorHex(e.target.value)}
              aria-label="Pulse tint color"
            />
          </div>
        </label>
        {interactiveEffect === 'expandingRingDiagonal' ? (
          <>
            <label className="ripple-param">
              <span className="ripple-param-label">Propagation speed</span>
              <input
                type="range"
                min={25}
                max={400}
                step={5}
                value={Math.round(ringSpeed * 100)}
                disabled={!canInteractive}
                onChange={(e) => setRingSpeed(Number(e.target.value) / 100)}
              />
              <span className="ripple-param-value">{ringSpeed.toFixed(2)}×</span>
            </label>
            <label className="ripple-param">
              <span className="ripple-param-label">Wavefront width</span>
              <input
                type="range"
                min={0}
                max={28}
                step={1}
                value={ringThicknessDeg}
                disabled={!canInteractive}
                onChange={(e) => setRingThicknessDeg(Number(e.target.value))}
              />
              <span className="ripple-param-value">
                {ringThicknessDeg <= 0 ? 'auto' : `${ringThicknessDeg}°`}
              </span>
            </label>
          </>
        ) : null}
      </div>
      {!canInteractive ? (
        <p className="panel-warn-text">
          Pick <strong>Interactive</strong> in output mode above; then UV clicks send pulses to the runtime.
        </p>
      ) : null}
      {uvLoading ? <p className="muted">Loading layout/uv…</p> : null}
      {uvError ? (
        <p className="panel-warn-text">
          Could not load layout/uv (needs <code>assets/compiled/{layoutId}.ledmap.json</code>):{' '}
          {uvError}
        </p>
      ) : null}
      {uv && !uvLoading ? (
        <div className="uv-map-wrap">
          <div className={`uv-map-inner ${canInteractive ? '' : 'uv-map-inner--disabled'}`}>
            <svg
              className="uv-map-svg"
              viewBox="0 0 2 1"
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label="LED UV map (click to send interactive pulse)"
              onClick={onUvSvgClick}
            >
              <rect x={0} y={0} width={2} height={1} className="uv-map-bg" />
              {uv.leds.map((led) => (
                <circle
                  key={led.i}
                  cx={led.u * 2}
                  cy={led.v}
                  r={0.028}
                  className="uv-led-dot"
                />
              ))}
            </svg>
          </div>
        </div>
      ) : null}
      {lastWsNote ? <p className="muted ws-note">{lastWsNote}</p> : null}
    </section>
  )
}
