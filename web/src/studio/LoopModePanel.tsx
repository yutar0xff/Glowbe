import { LiveMetricsRow } from '../components/LiveMetricsRow'
import { formatDate } from '../format'
import { useGlowbeRuntime } from '../GlowbeRuntimeContext'
import type { RuntimeState, SequenceSummary } from '../types'

export function LoopModePanel({ state, sequences }: { state: RuntimeState; sequences: SequenceSummary[] }) {
  const { selectSequence, sequenceBusy } = useGlowbeRuntime()
  const playingSequenceId = state.mode === 'loop' ? state.loopSequenceId : null

  return (
    <div className="studio-mode-block">
      <header className="mode-panel-intro">
        <h2 className="mode-panel-title">Loop</h2>
        <p className="subtitle mode-panel-desc">
          Test pattern or a converted sequence. Selecting a sequence calls <code>POST /api/v1/loop/select</code> and
          sets output mode to <code>loop</code>.
        </p>
      </header>

      <LiveMetricsRow state={state} />

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
                    {seq.frameCount} frame(s) @ {seq.fps} fps · {seq.sourceWidth}×{seq.sourceHeight} · {seq.sourceKind}
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
    </div>
  )
}
