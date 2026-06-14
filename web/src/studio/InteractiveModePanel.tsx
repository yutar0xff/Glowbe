import { LiveControls } from '@/components/LiveControls'
import { LiveMetricsRow } from '@/components/LiveMetricsRow'
import type { RuntimeState } from '@/types'

export function InteractiveModePanel({ state }: { state: RuntimeState }) {
  return (
    <div className="space-y-6">
      <LiveMetricsRow state={state} />
      <LiveControls layoutId={state.layoutId} ledCount={state.ledCount} outputMode={state.mode} />
    </div>
  )
}
