import { useState } from 'react'
import { LiveControls } from '@/components/LiveControls'
import type { RuntimeState } from '@/types'
import { ModeResetBar } from './ModeResetBar'

export function InteractiveModePanel({ state }: { state: RuntimeState }) {
  const [resetSignal, setResetSignal] = useState(0)

  return (
    <div className="space-y-6">
      <ModeResetBar onReset={() => setResetSignal((n) => n + 1)} />
      <LiveControls
        layoutId={state.layoutId}
        ledCount={state.ledCount}
        outputMode={state.mode}
        resetSignal={resetSignal}
      />
    </div>
  )
}
