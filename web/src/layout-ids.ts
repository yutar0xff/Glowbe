export const LAYOUT_ID_GEODESIC_2V_60 = 'geodesic-2v-60'
export const LAYOUT_ID_ICOSAHEDRON_15 = 'icosahedron-15'

/** Default chain profile (60 active panels / 1260 LEDs). */
export const DEFAULT_LAYOUT_ID = LAYOUT_ID_GEODESIC_2V_60

/** Minimum LED count for mate face rendering (icosahedron-15 = 225). */
export const MATE_MIN_LED_COUNT = 225

export function mateSupportedForLedCount(ledCount: number): boolean {
  return ledCount >= MATE_MIN_LED_COUNT
}

export function formatLayoutHash(hash: number | null | undefined): string {
  if (hash == null) return '—'
  return `0x${hash.toString(16).padStart(8, '0')}`
}

/** True when both hashes are known and differ (matches runtime STATUS check). */
export function isLayoutHashMismatch(
  expectedLayoutHash: number | null | undefined,
  espLayoutHash: number | null | undefined,
): boolean {
  if (expectedLayoutHash == null || espLayoutHash == null) return false
  return expectedLayoutHash !== espLayoutHash
}

export function isLayoutMismatch(state: {
  expectedLayoutHash?: number | null
  espLayoutHash?: number | null
}): boolean {
  return isLayoutHashMismatch(state.expectedLayoutHash, state.espLayoutHash)
}
