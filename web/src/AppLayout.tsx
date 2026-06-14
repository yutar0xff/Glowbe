import { useMemo } from 'react'
import { MasterToneDrawer } from './components/MasterToneDrawer'
import { StatusPill } from './components/StatusPill'
import { useGlowbeRuntime } from './GlowbeRuntimeContext'
import { StudioPage } from './studio/StudioPage'

export function AppLayout() {
  const { load } = useGlowbeRuntime()
  const state = load.kind === 'ready' ? load.state : undefined
  const health = load.kind === 'ready' || load.kind === 'error' ? load.health : undefined

  const runtimeTone = useMemo(() => {
    if (load.kind === 'error') return 'bad'
    if (!state) return 'muted'
    if (state.frameLoopStaleMs > 1000) return 'bad'
    if (state.layoutMismatch) return 'warn'
    return 'ok'
  }, [load.kind, state])

  return (
    <main className="dashboard">
      <header className="hero">
        <div>
          <p className="eyebrow">LED output</p>
          <h1>Glowbe Studio</h1>
          <p className="subtitle">Output mode, mode controls, and runtime status on one screen.</p>
        </div>
        <div className="status-row">
          <StatusPill label={health?.ok ? 'health: ok' : 'health: stale/error'} tone={health?.ok ? 'ok' : 'bad'} />
          <StatusPill label={`runtime: ${runtimeTone}`} tone={runtimeTone} />
          {load.kind === 'ready' ? <MasterToneDrawer /> : null}
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

      {load.kind === 'ready' ? <StudioPage /> : null}
    </main>
  )
}
