import { useEffect, useMemo, useState } from 'react'
import './App.css'

type RuntimeState = {
  layoutId: string
  mode: string
  fpsOut: number
  fpsRx: number | null
  espRssi: number | null
  espDrops: number | null
  ledCount: number
  loopSequenceId: string | null
  uptimeSec: number
  frameLoopStaleMs: number
  layoutMismatch: boolean
  framesSent: number
}

type Health = {
  ok: boolean
  text: string
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; state: RuntimeState; health: Health; fetchedAt: Date }
  | { kind: 'error'; message: string; health?: Health; fetchedAt?: Date }

const API_BASE = import.meta.env.VITE_GLOWBE_API_BASE ?? ''
const POLL_MS = 1000

async function fetchText(path: string, signal: AbortSignal): Promise<{
  ok: boolean
  status: number
  text: string
}> {
  const res = await fetch(`${API_BASE}${path}`, { signal })
  return { ok: res.ok, status: res.status, text: await res.text() }
}

async function fetchState(signal: AbortSignal): Promise<LoadState> {
  const [stateRes, healthRes] = await Promise.all([
    fetch(`${API_BASE}/api/v1/state`, { signal }),
    fetchText('/health', signal).catch((err: unknown) => ({
      ok: false,
      status: 0,
      text: err instanceof Error ? err.message : String(err),
    })),
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

function App() {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' })
  const [modeBusy, setModeBusy] = useState<string | null>(null)

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

  const state = load.kind === 'ready' ? load.state : undefined
  const health = load.kind === 'ready' || load.kind === 'error' ? load.health : undefined
  const fetchedAt = load.kind !== 'loading' ? load.fetchedAt : undefined

  const runtimeTone = useMemo(() => {
    if (load.kind === 'error') return 'bad'
    if (!state) return 'muted'
    if (state.frameLoopStaleMs > 1000) return 'bad'
    if (state.layoutMismatch) return 'warn'
    return 'ok'
  }, [load.kind, state])

  const setMode = async (mode: 'idle' | 'loop') => {
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
      setLoad({
        kind: 'ready',
        state: (await res.json()) as RuntimeState,
        health: health ?? { ok: true, text: 'ok' },
        fetchedAt: new Date(),
      })
    } catch (err) {
      setLoad({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
        health,
        fetchedAt: new Date(),
      })
    } finally {
      window.clearTimeout(timeout)
      setModeBusy(null)
    }
  }

  return (
    <main className="dashboard">
      <header className="hero">
        <div>
          <p className="eyebrow">Glowbe Runtime</p>
          <h1>Phase 1.5 Dashboard</h1>
          <p className="subtitle">
            Read-only view of <code>/api/v1/state</code> and <code>/health</code>.
          </p>
        </div>
        <div className="status-row">
          <StatusPill label={health?.ok ? 'health: ok' : 'health: stale/error'} tone={health?.ok ? 'ok' : 'bad'} />
          <StatusPill label={`runtime: ${runtimeTone}`} tone={runtimeTone} />
        </div>
      </header>

      {load.kind === 'loading' ? (
        <section className="panel">Connecting to runtime...</section>
      ) : null}

      {load.kind === 'error' ? (
        <section className="panel panel-error">
          <h2>Runtime unavailable</h2>
          <p>{load.message}</p>
          <p className="muted">
            Start the runtime with <code>cd runtime && cargo run -- ../config.toml</code>, or set
            <code> VITE_GLOWBE_API_BASE</code> when the API is on another host.
          </p>
        </section>
      ) : null}

      {state ? (
        <>
          <section className="grid">
            <MetricCard label="Mode" value={state.mode} hint={state.loopSequenceId ?? 'test pattern / no sequence'} />
            <MetricCard label="FPS Out" value={formatNumber(state.fpsOut)} hint={`${state.framesSent} frames sent`} />
            <MetricCard label="FPS Rx" value={formatNumber(state.fpsRx)} hint="from ESP STATUS" />
            <MetricCard label="ESP RSSI" value={state.espRssi === null ? '-' : `${state.espRssi} dBm`} />
            <MetricCard label="ESP Drops" value={state.espDrops === null ? '-' : String(state.espDrops)} />
            <MetricCard label="Frame Loop Stale" value={`${state.frameLoopStaleMs} ms`} hint="health fails above 1000 ms" />
            <MetricCard label="LED Count" value={String(state.ledCount)} hint={state.layoutId} />
            <MetricCard label="Uptime" value={formatUptime(state.uptimeSec)} />
          </section>

          <section className="panel">
            <div className="panel-heading">
              <h2>Mode Control</h2>
              <span>minimal Phase 1 API</span>
            </div>
            <div className="button-row">
              <button
                type="button"
                onClick={() => void setMode('loop')}
                disabled={modeBusy !== null || state.mode === 'loop'}
              >
                {modeBusy === 'loop' ? 'Switching...' : 'Loop'}
              </button>
              <button
                type="button"
                onClick={() => void setMode('idle')}
                disabled={modeBusy !== null || state.mode === 'idle'}
              >
                {modeBusy === 'idle' ? 'Switching...' : 'Idle / blackout'}
              </button>
            </div>
          </section>

          {state.layoutMismatch ? (
            <section className="panel panel-warn">
              <h2>Layout mismatch</h2>
              <p>
                ESP <code>layout_hash</code> does not match the runtime compiled layout. Re-run
                <code> tools/layout-compile.ts</code> and reflash firmware.
              </p>
            </section>
          ) : null}

          <section className="panel">
            <div className="panel-heading">
              <h2>Raw State</h2>
              <span>{fetchedAt ? fetchedAt.toLocaleTimeString() : '-'}</span>
            </div>
            <pre>{JSON.stringify(state, null, 2)}</pre>
          </section>
        </>
      ) : null}
    </main>
  )
}

export default App
