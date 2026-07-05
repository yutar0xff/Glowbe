/** Timeline / playback sampling rate when no media or invalid UI input. */
export const TIMELINE_FPS_DEFAULT = 60;

const TIMELINE_FPS_MIN_VALID = 1;

/**
 * Finite fps ≥ {@link TIMELINE_FPS_MIN_VALID}; otherwise default. No upper cap.
 */
export function normalizeTimelineFps(raw: unknown): number {
  const n = typeof raw === "number" ? raw : parseFloat(String(raw).trim());
  if (!Number.isFinite(n) || n < TIMELINE_FPS_MIN_VALID) return TIMELINE_FPS_DEFAULT;
  return n;
}
