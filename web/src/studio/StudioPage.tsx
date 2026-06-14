import type { OutputMode } from '../types'
import { useGlowbeRuntime } from '../GlowbeRuntimeContext'
import { IdleModePanel } from './IdleModePanel'
import { InteractiveModePanel } from './InteractiveModePanel'
import { LoopModePanel } from './LoopModePanel'
import { StatusSection } from './StatusSection'

const MODES: OutputMode[] = ['loop', 'interactive', 'idle']

function panelMode(mode: string): OutputMode {
  if (mode === 'loop') return 'loop'
  if (mode === 'interactive' || mode === 'ripple') return 'interactive'
  return 'idle'
}

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
        {MODES.map((mode) => {
          const isActive =
            mode === 'interactive'
              ? currentMode === 'interactive' || currentMode === 'ripple'
              : currentMode === mode
          return (
            <button
              key={mode}
              type="button"
              className={`mode-badge${isActive ? ' active' : ''}`}
              onClick={() => onPick(mode)}
              disabled={modeBusy !== null}
              aria-pressed={isActive}
            >
              {mode === 'loop' ? 'Loop' : mode === 'interactive' ? 'Interactive' : 'Idle'}
            </button>
          )
        })}
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

  const modeKey = panelMode(state.mode)

  return (
    <div className="studio-stack">
      <ModeBadges currentMode={state.mode} modeBusy={modeBusy} onPick={pickMode} />

      {modeKey === 'loop' ? (
        <LoopModePanel state={state} sequences={sequences} />
      ) : modeKey === 'interactive' ? (
        <InteractiveModePanel state={state} />
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
