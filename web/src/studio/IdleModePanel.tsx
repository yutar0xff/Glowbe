import { LiveMetricsRow } from '@/components/LiveMetricsRow'
import type { RuntimeState } from '@/types'

export function IdleModePanel({ state }: { state: RuntimeState }) {
  return (
    <div className="space-y-6">
      <LiveMetricsRow state={state} />
      <p className="text-sm text-muted-foreground">
        Output stays dark until you choose Loop or Interactive above.
      </p>
    </div>
  )
}
