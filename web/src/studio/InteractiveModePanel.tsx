import { LiveControls } from '../components/LiveControls'
import { LiveMetricsRow } from '../components/LiveMetricsRow'
import type { RuntimeState } from '../types'

export function InteractiveModePanel({ state }: { state: RuntimeState }) {
  return (
    <div className="studio-mode-block">
      <header className="mode-panel-intro">
        <h2 className="mode-panel-title">Interactive</h2>
        <p className="subtitle mode-panel-desc">
          Black base frame; WebSocket <code>interactive</code> pulses stack additively until they expire.
          Pick an effect, tint (fixed or random), ring parameters for the expanding ring, then click the UV map.
          Use the header gear for master brightness/gamma on all modes. Legacy <code>ripple</code> WS messages
          are still accepted as pulses only.
        </p>
      </header>

      <LiveMetricsRow state={state} />

      <LiveControls layoutId={state.layoutId} ledCount={state.ledCount} outputMode={state.mode} />
    </div>
  )
}
