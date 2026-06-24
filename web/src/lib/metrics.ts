import type { RuntimeState } from '@/types'

/** Outbound FPS; 0 when the device is idle (no frame UDP). */
export function effectiveFpsOut(state: RuntimeState): number {
  if (state.mode === 'idle') return 0
  return state.fpsOut
}

/** Device-reported receive FPS; 0 when idle or unknown. */
export function effectiveFpsRx(state: RuntimeState): number | null {
  if (state.mode === 'idle') return 0
  return state.fpsRx
}
