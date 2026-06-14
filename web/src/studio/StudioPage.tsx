import type { OutputMode } from '../types'
import { useGlowbeRuntime } from '../GlowbeRuntimeContext'
import { IdleModePanel } from './IdleModePanel'
import { LoopModePanel } from './LoopModePanel'
import { RippleModePanel } from './RippleModePanel'
import { StatusSection } from './StatusSection'

const MODES: OutputMode[] = ['loop', 'ripple', 'idle']

function ModeBadges({
  currentMode,
  modeBusy,
  onPick,
}: {
  currentMode: string
  modeBusy: string | null
  onPick: (mode: OutputMode) => void
}) {
  return (
    <section className="panel panel-tight" aria-label="Output mode">
      <div className="mode-badges" role="group" aria-label="Select output mode">
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            className={`mode-badge${currentMode === mode ? ' active' : ''}`}
            onClick={() => onPick(mode)}
            disabled={modeBusy !== null}
            aria-pressed={currentMode === mode}
          >
            {mode === 'loop' ? 'Loop' : mode === 'ripple' ? 'Ripple' : 'Idle'}
          </button>
        ))}
      </div>
      {modeBusy !== null ? <p className="muted mode-busy-note">Applying {modeBusy}…</p> : null}
    </section>
  )
}

export function StudioPage() {
  const { load, modeBusy, setMode } = useGlowbeRuntime()
  if (load.kind !== 'ready') return null
  const { state, sequences } = load

  const pickMode = (mode: OutputMode) => {
    if (modeBusy !== null) return
    void setMode(mode)
  }

  const modeKey: OutputMode =
    state.mode === 'loop' || state.mode === 'ripple' || state.mode === 'idle' ? state.mode : 'idle'

  return (
    <div className="studio-stack">
      <ModeBadges currentMode={state.mode} modeBusy={modeBusy} onPick={pickMode} />

      {modeKey === 'loop' ? (
        <LoopModePanel state={state} sequences={sequences} />
      ) : modeKey === 'ripple' ? (
        <RippleModePanel state={state} />
      ) : (
        <IdleModePanel />
      )}

      <div className="studio-status-block">
        <h2 className="status-section-heading">Runtime status</h2>
        <StatusSection />
      </div>
    </div>
  )
}
