import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ChangeEvent, MouseEvent } from 'react'
import {
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useOutletContext,
} from 'react-router-dom'
import './App.css'

type RuntimeState = {
  layoutId: string
  mode: string
  fpsOut: number
  fpsRx: number | null
  espFramesComplete: number | null
  espRssi: number | null
  espDrops: number | null
  espStatusAddr: string | null
  outputTargetAddr: string | null
  ledCount: number
  loopSequenceId: string | null
  uptimeSec: number
  frameLoopStaleMs: number
  layoutMismatch: boolean
  framesSent: number
}

type SequenceSummary = {
  id: string
  layoutId: string
  ledCount: number
  frameCount: number
  fps: number
  sourceKind: string
  sourceWidth: number
  sourceHeight: number
  createdAtUnixSec: number
}

type Health = {
  ok: boolean
  text: string
}

type LayoutUvLed = {
  i: number
  u: number
  v: number
  channel?: number
  chainIndex?: number
}

type LayoutUvResponse = {
  layoutId: string
  ledCount: number
  leds: LayoutUvLed[]
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; state: RuntimeState; health: Health; sequences: SequenceSummary[]; fetchedAt: Date }
  | { kind: 'error'; message: string; health?: Health; fetchedAt?: Date }

const API_BASE = import.meta.env.VITE_GLOWBE_API_BASE ?? ''
const POLL_MS = 1000

function resolveGlowbeWsUrl(): string {
  const base = import.meta.env.VITE_GLOWBE_API_BASE ?? ''
  if (!base) {
    const p = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${p}//${location.host}/api/v1/ws`
  }
  const u = new URL(base.startsWith('http') ? base : `http://${base}`)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  u.pathname = '/api/v1/ws'
  u.search = ''
  u.hash = ''
  return u.toString()
}

async function fetchText(path: string, signal: AbortSignal): Promise<{
  ok: boolean
  status: number
  text: string
}> {
  const res = await fetch(`${API_BASE}${path}`, { signal })
  return { ok: res.ok, status: res.status, text: await res.text() }
}

async function fetchState(signal: AbortSignal): Promise<LoadState> {
  const [stateRes, healthRes, sequencesRes] = await Promise.all([
    fetch(`${API_BASE}/api/v1/state`, { signal }),
    fetchText('/health', signal).catch((err: unknown) => ({
      ok: false,
      status: 0,
      text: err instanceof Error ? err.message : String(err),
    })),
    fetch(`${API_BASE}/api/v1/sequences`, { signal }).catch(() => undefined),
  ])

  const health: Health = {
    ok: healthRes.ok,
    text: healthRes.ok ? healthRes.text : `${healthRes.status} ${healthRes.text}`,
  }

  if (!stateRes.ok) {
    return {
      kind: 'error',
      message: `GET /api/v1/state failed: ${stateRes.status}`,
      health,
      fetchedAt: new Date(),
    }
  }

  return {
    kind: 'ready',
    state: (await stateRes.json()) as RuntimeState,
    health,
    sequences: sequencesRes?.ok ? ((await sequencesRes.json()) as SequenceSummary[]) : [],
    fetchedAt: new Date(),
  }
}

function formatNumber(value: number | null, digits = 1): string {
  return value === null ? '-' : value.toFixed(digits)
}

function formatUptime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h > 0
    ? `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`
    : `${m}m ${s.toString().padStart(2, '0')}s`
}

function formatDate(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '-'
  return new Date(sec * 1000).toLocaleString()
}

type GlowbeRuntimeContextValue = {
  load: LoadState
  modeBusy: string | null
  sequenceBusy: string | null
  setMode: (mode: 'idle' | 'loop' | 'ripple') => Promise<void>
  selectSequence: (sequenceId: string) => Promise<void>
}

const GlowbeRuntimeContext = createContext<GlowbeRuntimeContextValue | null>(null)

function useGlowbeRuntime(): GlowbeRuntimeContextValue {
  const v = useContext(GlowbeRuntimeContext)
  if (!v) throw new Error('useGlowbeRuntime must be used within GlowbeRuntimeProvider')
  return v
}

function GlowbeRuntimeProvider({ children }: { children: React.ReactNode }) {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' })
  const [modeBusy, setModeBusy] = useState<string | null>(null)
  const [sequenceBusy, setSequenceBusy] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let timer: number | undefined

    const tick = async () => {
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 3500)
      try {
        const next = await fetchState(controller.signal)
        if (active) setLoad(next)
      } catch (err) {
        if (active) {
          setLoad({
            kind: 'error',
            message: err instanceof Error ? err.message : String(err),
            fetchedAt: new Date(),
          })
        }
      } finally {
        window.clearTimeout(timeout)
        if (active) timer = window.setTimeout(tick, POLL_MS)
      }
    }

    tick()

    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [])

  const setMode = useCallback(async (mode: 'idle' | 'loop' | 'ripple') => {
    setModeBusy(mode)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 3500)
    try {
      const res = await fetch(`${API_BASE}/api/v1/mode`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`POST /api/v1/mode failed: ${res.status}`)
      const newState = (await res.json()) as RuntimeState
      setLoad((prev) => {
        if (prev.kind === 'ready') {
          return {
            ...prev,
            state: newState,
            fetchedAt: new Date(),
          }
        }
        return {
          kind: 'ready',
          state: newState,
          health: prev.kind === 'error' && prev.health ? prev.health : { ok: true, text: 'ok' },
          sequences: [],
          fetchedAt: new Date(),
        }
      })
    } catch (err) {
      setLoad((prev) => ({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
        health: prev.kind === 'ready' || prev.kind === 'error' ? prev.health : undefined,
        fetchedAt: new Date(),
      }))
    } finally {
      window.clearTimeout(timeout)
      setModeBusy(null)
    }
  }, [])

  const selectSequence = useCallback(async (sequenceId: string) => {
    setSequenceBusy(sequenceId)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 3500)
    try {
      const res = await fetch(`${API_BASE}/api/v1/loop/select`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sequenceId }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`POST /api/v1/loop/select failed: ${res.status}`)
      const newState = (await res.json()) as RuntimeState
      setLoad((prev) => {
        if (prev.kind === 'ready') {
          return { ...prev, state: newState, fetchedAt: new Date() }
        }
        return {
          kind: 'ready',
          state: newState,
          health: { ok: true, text: 'ok' },
          sequences: [],
          fetchedAt: new Date(),
        }
      })
    } catch (err) {
      setLoad((prev) => ({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
        health: prev.kind === 'ready' || prev.kind === 'error' ? prev.health : undefined,
        fetchedAt: new Date(),
      }))
    } finally {
      window.clearTimeout(timeout)
      setSequenceBusy(null)
    }
  }, [])

  const value = useMemo(
    () => ({ load, modeBusy, sequenceBusy, setMode, selectSequence }),
    [load, modeBusy, sequenceBusy, setMode, selectSequence],
  )

  return <GlowbeRuntimeContext.Provider value={value}>{children}</GlowbeRuntimeContext.Provider>
}

function StatusPill({
  label,
  tone,
}: {
  label: string
  tone: 'ok' | 'warn' | 'bad' | 'muted'
}) {
  return <span className={`pill pill-${tone}`}>{label}</span>
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <article className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {hint ? <div className="metric-hint">{hint}</div> : null}
    </article>
  )
}

function LiveControls({
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
          Open <strong>Modes → Ripple</strong> in the navigation so the runtime switches to{' '}
          <code>ripple</code> mode; then UV clicks affect the UDP stream.
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

function usePageHeading() {
  const { pathname } = useLocation()
  if (pathname === '/') {
    return {
      title: 'Status',
      subtitle: (
        <>
          Polling <code>/api/v1/state</code> and <code>/health</code>. Change output under{' '}
          <NavLink to="/mode">Modes</NavLink>.
        </>
      ),
    }
  }
  if (pathname === '/mode') {
    return {
      title: 'Modes',
      subtitle: (
        <>
          Pick <NavLink to="/mode/loop">Loop</NavLink> or <NavLink to="/mode/ripple">Ripple</NavLink>.
          Use the Idle switch for blackout (clears the selected sequence).
        </>
      ),
    }
  }
  if (pathname === '/mode/loop') {
    return {
      title: 'Loop',
      subtitle: (
        <>
          Test pattern or a converted sequence. Selecting a sequence calls{' '}
          <code>POST /api/v1/loop/select</code> and sets output mode to <code>loop</code>.
        </>
      ),
    }
  }
  if (pathname === '/mode/ripple') {
    return {
      title: 'Ripple',
      subtitle: (
        <>
          Black frames with WebSocket <code>ripple</code> composited on the UDP stream. Open this
          route to activate <code>ripple</code> mode automatically.
        </>
      ),
    }
  }
  return { title: 'Glowbe', subtitle: null as React.ReactNode }
}

function AppLayout() {
  const { load } = useGlowbeRuntime()
  const state = load.kind === 'ready' ? load.state : undefined
  const health = load.kind === 'ready' || load.kind === 'error' ? load.health : undefined
  const fetchedAt = load.kind !== 'loading' ? load.fetchedAt : undefined
  const { title, subtitle } = usePageHeading()

  const runtimeTone = useMemo(() => {
    if (load.kind === 'error') return 'bad'
    if (!state) return 'muted'
    if (state.frameLoopStaleMs > 1000) return 'bad'
    if (state.layoutMismatch) return 'warn'
    return 'ok'
  }, [load.kind, state])

  return (
    <main className="dashboard">
      <nav className="app-nav" aria-label="Primary">
        <NavLink className={({ isActive }) => (isActive ? 'active' : undefined)} end to="/">
          Status
        </NavLink>
        <NavLink className={({ isActive }) => (isActive ? 'active' : undefined)} to="/mode">
          Modes
        </NavLink>
      </nav>

      <header className="hero">
        <div>
          <p className="eyebrow">Glowbe Runtime</p>
          <h1>{title}</h1>
          {subtitle ? <p className="subtitle">{subtitle}</p> : null}
        </div>
        <div className="status-row">
          <StatusPill label={health?.ok ? 'health: ok' : 'health: stale/error'} tone={health?.ok ? 'ok' : 'bad'} />
          <StatusPill label={`runtime: ${runtimeTone}`} tone={runtimeTone} />
        </div>
      </header>

      {load.kind === 'loading' ? (
        <section className="panel">Connecting to runtime…</section>
      ) : null}

      {load.kind === 'error' ? (
        <section className="panel panel-error">
          <h2>Runtime unavailable</h2>
          <p>{load.message}</p>
          <p className="muted">
            Start the runtime with <code>cd runtime && cargo run -- ../config.toml</code>, or set{' '}
            <code>VITE_GLOWBE_API_BASE</code> if the API is on another host.
          </p>
        </section>
      ) : null}

      {state?.layoutMismatch ? (
        <section className="panel panel-warn">
          <h2>Layout mismatch</h2>
          <p>
            ESP <code>layout_hash</code> does not match the compiled layout. Re-run{' '}
            <code>tools/layout-compile.ts</code> and reflash the firmware.
          </p>
        </section>
      ) : null}

      <Outlet context={{ load, fetchedAt }} />
    </main>
  )
}

type OutletCtx = { load: LoadState; fetchedAt?: Date }

function useOutletLoad(): OutletCtx {
  return useOutletContext<OutletCtx>()
}

function StatusPage() {
  const { load, fetchedAt } = useOutletLoad()
  if (load.kind !== 'ready') return null
  const { state, sequences } = load
  const playingSequenceId = state.mode === 'loop' ? state.loopSequenceId : null

  return (
    <>
      <section className="grid">
        <MetricCard label="Mode" value={state.mode} hint={playingSequenceId ?? '—'} />
        <MetricCard label="FPS Out" value={formatNumber(state.fpsOut)} hint={`${state.framesSent} frames sent`} />
        <MetricCard label="FPS Rx" value={formatNumber(state.fpsRx)} hint="from ESP STATUS" />
        <MetricCard label="ESP Frames" value={state.espFramesComplete === null ? '-' : String(state.espFramesComplete)} />
        <MetricCard label="ESP RSSI" value={state.espRssi === null ? '-' : `${state.espRssi} dBm`} />
        <MetricCard label="ESP Drops" value={state.espDrops === null ? '-' : String(state.espDrops)} />
        <MetricCard label="ESP Status From" value={state.espStatusAddr ?? '-'} />
        <MetricCard label="Output Target" value={state.outputTargetAddr ?? '-'} />
        <MetricCard
          label="Frame Loop Stale"
          value={`${state.frameLoopStaleMs} ms`}
          hint="health fails above 1000 ms"
        />
        <MetricCard label="LED Count" value={String(state.ledCount)} hint={state.layoutId} />
        <MetricCard label="Uptime" value={formatUptime(state.uptimeSec)} />
        <MetricCard label="Sequences (count)" value={String(sequences.length)} hint="configure under Modes → Loop" />
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Raw state</h2>
          <span>{fetchedAt ? fetchedAt.toLocaleTimeString() : '-'}</span>
        </div>
        <pre>{JSON.stringify(state, null, 2)}</pre>
      </section>
    </>
  )
}

function ModeListPage() {
  const { load, modeBusy, setMode } = useGlowbeRuntime()
  if (load.kind !== 'ready') return null
  const { state } = load
  const idleOn = state.mode === 'idle'

  const onIdleChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (modeBusy !== null) return
    if (e.target.checked) void setMode('idle')
    else void setMode('loop')
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Output overview</h2>
        <span>
          Current mode: <strong>{state.mode}</strong>
        </span>
      </div>

      <div className="mode-idle-row">
        <label className="idle-toggle-label">
          <input
            type="checkbox"
            checked={idleOn}
            disabled={modeBusy !== null}
            onChange={onIdleChange}
          />
          <span>Idle (blackout, clears sequence)</span>
        </label>
        {modeBusy === 'idle' || modeBusy === 'loop' ? (
          <span className="muted">Applying…</span>
        ) : null}
      </div>

      <div className="mode-cards">
        <NavLink className={({ isActive }) => `mode-card${isActive ? ' active' : ''}`} to="/mode/loop">
          <h3>Loop</h3>
          <p className="muted">Test pattern or converted sequence playback.</p>
        </NavLink>
        <NavLink className={({ isActive }) => `mode-card${isActive ? ' active' : ''}`} to="/mode/ripple">
          <h3>Ripple</h3>
          <p className="muted">Black output with WebSocket ripple composited on UDP.</p>
        </NavLink>
      </div>
    </section>
  )
}

function LoopModePage() {
  const { load, setMode, selectSequence, sequenceBusy } = useGlowbeRuntime()
  const mode = load.kind === 'ready' ? load.state.mode : null

  useEffect(() => {
    if (mode === null || mode === 'loop') return
    void setMode('loop')
  }, [mode, setMode])

  if (load.kind !== 'ready') return null
  const { state, sequences } = load
  const playingSequenceId = state.mode === 'loop' ? state.loopSequenceId : null

  return (
    <>
      <section className="panel panel-compact-metrics">
        <div className="live-metrics-row">
          <span>
            Output mode: <strong>{state.mode}</strong>
          </span>
          <span className="muted">
            FPS out {formatNumber(state.fpsOut)} · stale {state.frameLoopStaleMs} ms · {state.framesSent}{' '}
            frames
          </span>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Sequences</h2>
          <span>
            {sequences.length} available · select to play in <code>loop</code>
          </span>
        </div>
        {sequences.length === 0 ? (
          <p className="muted">No sequences. Generate one with the runtime CLI <code>convert-image</code>.</p>
        ) : (
          <div className="sequence-list">
            {sequences.map((seq) => (
              <article className="sequence-card" key={seq.id}>
                <div>
                  <h3>{seq.id}</h3>
                  <p className="muted">
                    {seq.frameCount} frame(s) @ {seq.fps} fps · {seq.sourceWidth}×{seq.sourceHeight} ·{' '}
                    {seq.sourceKind}
                  </p>
                  <p className="muted">Created: {formatDate(seq.createdAtUnixSec)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void selectSequence(seq.id)}
                  disabled={sequenceBusy !== null || playingSequenceId === seq.id}
                >
                  {sequenceBusy === seq.id
                    ? 'Selecting…'
                    : playingSequenceId === seq.id
                      ? 'Selected'
                      : 'Select for loop'}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <p className="muted">
        <NavLink to="/mode">← Back to mode list</NavLink>
      </p>
    </>
  )
}

function RippleModePage() {
  const { load, setMode } = useGlowbeRuntime()
  const mode = load.kind === 'ready' ? load.state.mode : null

  useEffect(() => {
    if (mode === null || mode === 'ripple') return
    void setMode('ripple')
  }, [mode, setMode])

  if (load.kind !== 'ready') return null
  const { state } = load

  return (
    <>
      <section className="panel panel-compact-metrics">
        <div className="live-metrics-row">
          <span>
            Output mode: <strong>{state.mode}</strong>
          </span>
          <span className="muted">
            FPS out {formatNumber(state.fpsOut)} · stale {state.frameLoopStaleMs} ms · {state.framesSent}{' '}
            frames
          </span>
        </div>
      </section>

      <LiveControls layoutId={state.layoutId} ledCount={state.ledCount} outputMode={state.mode} />

      <p className="muted">
        <NavLink to="/mode">← Back to mode list</NavLink>
      </p>
    </>
  )
}

export default function App() {
  return (
    <GlowbeRuntimeProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<StatusPage />} />
          <Route path="mode" element={<ModeListPage />} />
          <Route path="mode/loop" element={<LoopModePage />} />
          <Route path="mode/ripple" element={<RippleModePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </GlowbeRuntimeProvider>
  )
}
