import { z } from "zod";

export { mapRgbForDevice } from "./power";

/**
 * Studio-side color management for previews. `brightness` is sent to the device
 * via CONTROL (preview stays full-range). Kept out of the
 * Rig schema but Zod-validated for future project persistence.
 */
export const ColorSettingsSchema = z.object({
  /** Device output (0..1 UI). 100% sends CONTROL 255; firmware scales to the power ceiling. */
  brightness: z.number().min(0).max(1).default(0.05),
  /**
   * Display gamma exponent applied per channel: out = in^gamma (on 0..1).
   * 1 = no change (preview equals source). >1 darkens mids, <1 brightens.
   */
  gamma: z.number().min(0.2).max(4).default(2.2),
  /** Per-channel white-balance gains (0..2). */
  whiteBalance: z
    .object({
      r: z.number().min(0).max(2).default(1),
      g: z.number().min(0).max(2).default(1),
      b: z.number().min(0).max(2).default(1),
    })
    .default({ r: 1, g: 1, b: 1 }),
});
export type ColorSettings = z.infer<typeof ColorSettingsSchema>;

export const DEFAULT_COLOR_SETTINGS: ColorSettings = {
  brightness: 0.05,
  gamma: 2.2,
  whiteBalance: { r: 1, g: 1, b: 1 },
};

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/**
 * Apply white balance and gamma to one sRGB byte triple (preview path).
 * Does not apply `brightness` (device applies it from CONTROL).
 */
export const applyColor = (
  r: number,
  g: number,
  b: number,
  s: ColorSettings,
): [number, number, number] => {
  const wb = s.whiteBalance;
  const ch = (value: number, gain: number): number => {
    const n = (value / 255) * gain;
    const c = n <= 0 ? 0 : n >= 1 ? 1 : n;
    return clamp255(255 * Math.pow(c, s.gamma));
  };
  return [ch(r, wb.r), ch(g, wb.g), ch(b, wb.b)];
};
