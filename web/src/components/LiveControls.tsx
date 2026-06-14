import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { MouseEvent } from 'react'
import type { LayoutUvResponse } from '../types'
import { API_BASE, resolveGlowbeWsUrl } from '../api'

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
  const [previewWanted, setPreviewWanted] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const previewWantedRef = useRef(false)
  const reconnectTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    previewWantedRef.current = previewWanted
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      if (previewWanted) {
        ws.send(JSON.stringify({ type: 'subscribe_preview', quality: 72 }))
      } else {
        ws.send(JSON.stringify({ type: 'unsubscribe_preview' }))
      }
    }
    if (!previewWanted) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear preview blob when unsubscribing
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
    }
  }, [previewWanted])

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
        if (previewWantedRef.current) {
          ws.send(JSON.stringify({ type: 'subscribe_preview', quality: 72 }))
        }
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
        if (t === 'preview_frame' && typeof msg.data === 'string') {
          try {
            const bin = Uint8Array.from(atob(msg.data as string), (c) => c.charCodeAt(0))
            const blob = new Blob([bin], { type: 'image/jpeg' })
            const nextUrl = URL.createObjectURL(blob)
            setPreviewUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev)
              return nextUrl
            })
          } catch {
            setLastWsNote('preview_frame base64 decode failed')
          }
        } else if (t === 'event_status') {
          const evName = msg.event
          const st = msg.status
          setLastWsNote(`event_status ${String(evName)}: ${String(st)}`)
        } else if (t === 'preview_status') {
          setLastWsNote(`preview_status: ${String(msg.status)}`)
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
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const sendRipple = (u: number, v: number) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setLastWsNote('ripple: WebSocket not open')
      return
    }
    ws.send(JSON.stringify({ type: 'ripple', u, v, amplitude: 1.0 }))
  }

  const canRipple = outputMode === 'ripple'

  const onUvSvgClick = (e: MouseEvent<SVGSVGElement>) => {
    if (!canRipple) return
    const svg = e.currentTarget
    const r = svg.getBoundingClientRect()
    const u = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const v = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    sendRipple(u, v)
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
        Equirectangular UV (2:1). Click to send <code>ripple</code>; the runtime applies it on the
        wire only in <strong>ripple</strong> output mode.
      </p>
      {!canRipple ? (
        <p className="panel-warn-text">
          Pick <strong>Ripple</strong> in output mode above so the runtime uses <code>ripple</code>; then UV clicks
          affect the UDP stream.
        </p>
      ) : null}
      <label className="preview-toggle">
        <input
          type="checkbox"
          checked={previewWanted}
          onChange={(e) => setPreviewWanted(e.target.checked)}
        />
        JPEG strip preview (latest frame on each state tick)
      </label>
      {previewWanted ? (
        <div className="preview-frame-wrap">
          {previewUrl ? (
            <img className="preview-frame-img" src={previewUrl} alt="Runtime strip preview" />
          ) : (
            <p className="muted">Waiting for preview_frame…</p>
          )}
        </div>
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
          <div className={`uv-map-inner ${canRipple ? '' : 'uv-map-inner--disabled'}`}>
            <svg
              className="uv-map-svg"
              viewBox="0 0 2 1"
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label="LED UV map (click to send ripple)"
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
