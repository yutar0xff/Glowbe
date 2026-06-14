import { createContext, useContext } from 'react'
import type { LoadState, OutputMode } from './types'

export type GlowbeRuntimeContextValue = {
  load: LoadState
  modeBusy: string | null
  sequenceBusy: string | null
  setMode: (mode: OutputMode) => Promise<void>
  selectSequence: (sequenceId: string) => Promise<void>
}

export const GlowbeRuntimeContext = createContext<GlowbeRuntimeContextValue | null>(null)

export function useGlowbeRuntime(): GlowbeRuntimeContextValue {
  const v = useContext(GlowbeRuntimeContext)
  if (!v) throw new Error('useGlowbeRuntime must be used within GlowbeRuntimeProvider')
  return v
}
