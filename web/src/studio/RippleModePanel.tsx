import { LiveControls } from '../components/LiveControls'
import { LiveMetricsRow } from '../components/LiveMetricsRow'
import type { RuntimeState } from '../types'

export function RippleModePanel({ state }: { state: RuntimeState }) {
  return (
    <div className="studio-mode-block">
      <header className="mode-panel-intro">
        <h2 className="mode-panel-title">Ripple</h2>
        <p className="subtitle mode-panel-desc">
          Black frames with WebSocket <code>ripple</code> events composited on the UDP stream.
        </p>
      </header>

      <LiveMetricsRow state={state} />

      <LiveControls layoutId={state.layoutId} ledCount={state.ledCount} outputMode={state.mode} />
    </div>
  )
}
