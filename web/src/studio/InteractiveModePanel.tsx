import { LiveControls } from '@/components/LiveControls'
import type { RuntimeState } from '@/types'

export function InteractiveModePanel({ state }: { state: RuntimeState }) {
  return (
    <LiveControls layoutId={state.layoutId} ledCount={state.ledCount} outputMode={state.mode} />
  )
}
