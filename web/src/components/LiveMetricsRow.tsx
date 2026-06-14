import type { RuntimeState } from '../types'
import { formatNumber } from '../format'

export function LiveMetricsRow({ state }: { state: RuntimeState }) {
  return (
    <section className="panel panel-compact-metrics">
      <div className="live-metrics-row">
        <span>
          Output mode: <strong>{state.mode}</strong>
        </span>
        <span className="muted">
          FPS out {formatNumber(state.fpsOut)} · stale {state.frameLoopStaleMs} ms · {state.framesSent} frames
        </span>
      </div>
    </section>
  )
}
