import { z } from "zod";

/**
 * Power model for the LED array. Conservative defaults; the exact SK6805 EC14
 * per-channel current is a hardware open question (see `docs/hardware.md`), so
 * these are tunable. All current in amperes, voltage in volts.
 */
export const PowerModelSchema = z.object({
  volts: z.number().positive().default(5),
  /** Current per color channel at full (255) brightness, in mA. */
  mAPerChannelFull: z.number().nonnegative().default(13),
  /** Quiescent current per LED (controller idle), in mA. */
  idleMaPerLed: z.number().nonnegative().default(1),
  /** Global current budget in amperes (used for the preview clamp). */
  maxCurrentA: z.number().positive().default(10),
  /** Whether Studio previews the firmware's global current clamp. */
  clampEnabled: z.boolean().default(false),
});
export type PowerModel = z.infer<typeof PowerModelSchema>;

export const DEFAULT_POWER_MODEL: PowerModel = {
  volts: 5,
  mAPerChannelFull: 13,
  idleMaPerLed: 1,
  maxCurrentA: 10,
  clampEnabled: false,
};

/**
 * ESP32 limits (`firmware/esp32/include/glowbe_power_limits.h`).
 * Used to derive the device brightness ceiling — not the Studio preview budget.
 */
export const DEVICE_POWER_LIMITS = {
  maxCurrentA: 2,
  mAPerChannelFull: 13,
  idleMaPerLed: 1,
} as const;

/**
 * Maximum output brightness byte (0–255) so an all-white frame at CONTROL 255
 * stays within `limitCurrentA`. Idle current is fixed; channel current scales
 * linearly with this byte (same model as firmware `glowbe_max_brightness_byte`).
 */
export const deviceMaxBrightnessByte = (
  ledCount: number,
  limits: Pick<PowerModel, "mAPerChannelFull" | "idleMaPerLed" | "maxCurrentA"> = DEVICE_POWER_LIMITS,
): number => {
  if (ledCount <= 0) return 0;
  const limitMa = limits.maxCurrentA * 1000;
  const idleMa = ledCount * limits.idleMaPerLed;
  const dynamicBudgetMa = limitMa - idleMa;
  if (dynamicBudgetMa <= 0) return 0;
  const fullDynamicMa = ledCount * 3 * limits.mAPerChannelFull;
  if (fullDynamicMa <= 0) return 255;
  const b = (255 * dynamicBudgetMa) / fullDynamicMa;
  if (b <= 0) return 0;
  if (b >= 255) return 255;
  return Math.round(b);
};

/** Map UI 0..1 to CONTROL 0..255 (100% → 255; device applies the power ceiling). */
export const brightness01ToControlByte = (brightness01: number): number => {
  const t = Math.max(0, Math.min(1, brightness01));
  return Math.round(t * 255);
};

/** Map CONTROL 0–255 to driver brightness 0–ceiling (100% UI → 255 → ceiling). */
export const deviceEffectiveBrightnessByte = (
  controlByte: number,
  ledCount: number,
  limits: Pick<PowerModel, "mAPerChannelFull" | "idleMaPerLed" | "maxCurrentA"> = DEVICE_POWER_LIMITS,
): number => {
  const control = Math.max(0, Math.min(255, Math.round(controlByte)));
  const ceiling = deviceMaxBrightnessByte(ledCount, limits);
  return Math.round((control * ceiling) / 255);
};

/**
 * Device output (matches firmware): FRAME rgb unchanged; I2S `setBrightness(effective(CONTROL))`.
 * Linear estimate for tests (driver gamma omitted).
 */
export const scaleChannelForDeviceOutput = (
  channel: number,
  controlByte: number,
  ledCount: number,
  limits: Pick<PowerModel, "mAPerChannelFull" | "idleMaPerLed" | "maxCurrentA"> = DEVICE_POWER_LIMITS,
): number => {
  const v = Math.max(0, Math.min(255, Math.round(channel)));
  const driverBri = deviceEffectiveBrightnessByte(controlByte, ledCount, limits);
  if (v === 0 || driverBri === 0) return 0;
  return Math.min(255, Math.round((v * driverBri) / 255));
};

/**
 * Scale packed preview RGB like the device (CONTROL × power ceiling). For tests/tools.
 */
export const mapRgbForDevice = (
  previewRgb: Uint8Array,
  brightness01: number,
  ledCount = Math.floor(previewRgb.length / 3),
  limits: Pick<PowerModel, "mAPerChannelFull" | "idleMaPerLed" | "maxCurrentA"> = DEVICE_POWER_LIMITS,
): Uint8Array => {
  const control = brightness01ToControlByte(brightness01);
  const out = new Uint8Array(previewRgb.length);
  for (let i = 0; i < previewRgb.length; i++) {
    out[i] = scaleChannelForDeviceOutput(previewRgb[i] ?? 0, control, ledCount, limits);
  }
  return out;
};

export interface PowerEstimate {
  currentA: number;
  watts: number;
  ledCount: number;
}

/**
 * Estimate total current/power for a packed RGB byte buffer (length = 3*N).
 * Linear in channel value: a channel at value v contributes
 * (v/255) * mAPerChannelFull mA, plus a fixed idle per LED.
 */
export const estimatePower = (
  rgb: Uint8Array | number[],
  model: PowerModel,
): PowerEstimate => {
  const n = Math.floor(rgb.length / 3);
  let channelSum = 0; // sum of (value/255) over all channels
  for (let i = 0; i < n * 3; i++) channelSum += (rgb[i] ?? 0) / 255;
  const mA = channelSum * model.mAPerChannelFull + n * model.idleMaPerLed;
  const currentA = mA / 1000;
  return { currentA, watts: currentA * model.volts, ledCount: n };
};

/**
 * Scale factor (0..1) to keep the array within the current budget. Idle current
 * is treated as a fixed floor that scaling cannot reduce. Returns 1 when the
 * clamp is disabled or already within budget.
 */
export const currentClampScale = (
  estimate: PowerEstimate,
  model: PowerModel,
): number => {
  if (!model.clampEnabled) return 1;
  if (estimate.currentA <= model.maxCurrentA) return 1;
  const idleA = (estimate.ledCount * model.idleMaPerLed) / 1000;
  const dynamicA = estimate.currentA - idleA;
  if (dynamicA <= 0) return 1;
  const budgetForDynamic = model.maxCurrentA - idleA;
  if (budgetForDynamic <= 0) return 0;
  const scale = budgetForDynamic / dynamicA;
  return scale < 0 ? 0 : scale > 1 ? 1 : scale;
};
