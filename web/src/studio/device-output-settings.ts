export function validateOutputFps(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { ok: false, error: 'Output FPS is required.' }
  }
  const n = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(n) || String(n) !== trimmed) {
    return { ok: false, error: 'Output FPS must be a whole number.' }
  }
  if (n < 1) {
    return { ok: false, error: 'Output FPS must be at least 1.' }
  }
  return { ok: true, value: n }
}

/** `value` is stored master brightness 0–1. */
export function brightnessToPercent(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100)
}

/** Percent 0–100 → stored master brightness 0–1. */
export function percentToBrightness(percent: number): number {
  return Math.min(100, Math.max(0, percent)) / 100
}

export function validateBrightnessPercent(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  const trimmed = raw.trim().replace(/%$/, '')
  if (!trimmed) {
    return { ok: false, error: 'Brightness is required.' }
  }
  const n = Number.parseFloat(trimmed)
  if (!Number.isFinite(n)) {
    return { ok: false, error: 'Brightness must be a number.' }
  }
  if (n < 0 || n > 100) {
    return { ok: false, error: 'Brightness must be between 0 and 100%.' }
  }
  return { ok: true, value: percentToBrightness(n) }
}

export function validateGamma(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { ok: false, error: 'Gamma is required.' }
  }
  const n = Number.parseFloat(trimmed)
  if (!Number.isFinite(n)) {
    return { ok: false, error: 'Gamma must be a number.' }
  }
  if (n < 0.45 || n > 3.5) {
    return { ok: false, error: 'Gamma must be between 0.45 and 3.5.' }
  }
  return { ok: true, value: n }
}

export function formatBrightnessPercent(value: number): string {
  return String(brightnessToPercent(value))
}

export function formatGamma(value: number): string {
  return value.toFixed(2)
}
