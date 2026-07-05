import { z } from "zod";
import { buildCalibration } from "./export/calibration";
import type { Rig } from "./schema";
import { readU16LE, readU32LE, writeU16LE, writeU32LE } from "./device-profile-le";

export const DEVICE_PROFILE_MAGIC = 0x46525047; // "GPRF" LE
export const DEVICE_PROFILE_VERSION = 1;
export const DEVICE_PROFILE_MAX_CHANNELS = 10;
export const DEVICE_PROFILE_MAX_LEDS = 900;

const writeF32LE = (b: Uint8Array, o: number, v: number): void => {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, v, true);
  b.set(new Uint8Array(buf), o);
};

const readF32LE = (b: Uint8Array, o: number): number =>
  new DataView(b.buffer, b.byteOffset + o, 4).getFloat32(0, true);

export const DeviceProfilePowerSchema = z.object({
  maxCurrentA: z.number().positive(),
  mAPerChannelFull: z.number().nonnegative(),
  idleMaPerLed: z.number().nonnegative(),
});

export type DeviceProfilePower = z.infer<typeof DeviceProfilePowerSchema>;

export const DeviceProfileSchema = z.object({
  profileVersion: z.number().int().nonnegative(),
  ledCount: z.number().int().positive().max(DEVICE_PROFILE_MAX_LEDS),
  numChannels: z.number().int().positive().max(DEVICE_PROFILE_MAX_CHANNELS),
  power: DeviceProfilePowerSchema,
  pins: z.array(z.number().int().min(0).max(255)),
  ledsPerChannel: z.array(z.number().int().positive().max(4096)),
  globalOffsets: z.array(z.number().int().min(0).max(65535)),
});

export type DeviceProfile = z.infer<typeof DeviceProfileSchema>;

const HEADER_SIZE = 26;

export const deviceProfileByteSize = (ledCount: number): number =>
  HEADER_SIZE + DEVICE_PROFILE_MAX_CHANNELS + DEVICE_PROFILE_MAX_CHANNELS * 2 + ledCount * 2;

/** Build profile bytes from a resolved rig (same routing as `generateLayoutHeader`). */
export const encodeDeviceProfile = (
  rig: Rig,
  power: DeviceProfilePower,
  profileVersion = 1,
): Uint8Array => {
  const cal = buildCalibration(rig);
  const numChannels = Math.min(cal.channels.length, DEVICE_PROFILE_MAX_CHANNELS);
  const ledCount = Math.min(cal.totalLeds, DEVICE_PROFILE_MAX_LEDS);

  const channelBase: number[] = [];
  let base = 0;
  for (let i = 0; i < numChannels; i++) {
    channelBase.push(base);
    base += cal.channels[i]?.ledCount ?? 0;
  }

  const globalOffsets: number[] = [];
  for (let g = 0; g < ledCount; g++) {
    const led = cal.leds[g];
    if (!led) {
      globalOffsets.push(0);
      continue;
    }
    const chBase = channelBase[led.address.channel] ?? 0;
    globalOffsets.push((chBase + led.address.chainIndex) * 3);
  }

  const pins = cal.channels.slice(0, numChannels).map((c) => c.pin);
  const ledsPerChannel = cal.channels.slice(0, numChannels).map((c) => c.ledCount);

  const out = new Uint8Array(deviceProfileByteSize(ledCount));
  writeU32LE(out, 0, DEVICE_PROFILE_MAGIC);
  writeU16LE(out, 4, DEVICE_PROFILE_VERSION);
  writeU32LE(out, 6, profileVersion >>> 0);
  writeU16LE(out, 10, ledCount & 0xffff);
  out[12] = numChannels & 0xff;
  out[13] = 0;
  writeF32LE(out, 14, power.maxCurrentA);
  writeF32LE(out, 18, power.mAPerChannelFull);
  writeF32LE(out, 22, power.idleMaPerLed);

  let o = HEADER_SIZE;
  for (let i = 0; i < DEVICE_PROFILE_MAX_CHANNELS; i++) {
    const pin = pins[i];
    out[o++] = pin == null || pin < 0 ? 0 : pin & 0xff;
  }
  for (let i = 0; i < DEVICE_PROFILE_MAX_CHANNELS; i++) {
    writeU16LE(out, o, ledsPerChannel[i] ?? 0);
    o += 2;
  }
  for (let g = 0; g < ledCount; g++) {
    writeU16LE(out, o, globalOffsets[g] ?? 0);
    o += 2;
  }

  return out;
};

export const decodeDeviceProfile = (buf: Uint8Array): DeviceProfile | null => {
  const minSize = deviceProfileByteSize(0);
  if (buf.length < minSize) return null;
  if (readU32LE(buf, 0) !== DEVICE_PROFILE_MAGIC) return null;
  if (readU16LE(buf, 4) !== DEVICE_PROFILE_VERSION) return null;

  const profileVersion = readU32LE(buf, 6) >>> 0;
  const ledCount = readU16LE(buf, 10);
  const numChannels = buf[12]!;
  if (ledCount <= 0 || ledCount > DEVICE_PROFILE_MAX_LEDS) return null;
  if (numChannels <= 0 || numChannels > DEVICE_PROFILE_MAX_CHANNELS) return null;
  if (buf.length < deviceProfileByteSize(ledCount)) return null;

  const power = {
    maxCurrentA: readF32LE(buf, 14),
    mAPerChannelFull: readF32LE(buf, 18),
    idleMaPerLed: readF32LE(buf, 22),
  };

  let o = HEADER_SIZE;
  const pins: number[] = [];
  for (let i = 0; i < DEVICE_PROFILE_MAX_CHANNELS; i++) {
    pins.push(buf[o++]!);
  }
  const ledsPerChannel: number[] = [];
  for (let i = 0; i < DEVICE_PROFILE_MAX_CHANNELS; i++) {
    ledsPerChannel.push(readU16LE(buf, o));
    o += 2;
  }
  const globalOffsets: number[] = [];
  for (let g = 0; g < ledCount; g++) {
    globalOffsets.push(readU16LE(buf, o));
    o += 2;
  }

  const parsed = DeviceProfileSchema.safeParse({
    profileVersion,
    ledCount,
    numChannels,
    power,
    pins: pins.slice(0, numChannels),
    ledsPerChannel: ledsPerChannel.slice(0, numChannels),
    globalOffsets,
  });
  return parsed.success ? parsed.data : null;
};

const maxWireByteOffset = (profile: DeviceProfile): number => {
  let max = 0;
  for (const off of profile.globalOffsets) {
    if (off > max) max = off;
  }
  return max;
};

/** Structural checks on a decoded profile (offsets, channel lengths). */
export const validateDeviceProfile = (
  profile: DeviceProfile,
): { ok: true } | { ok: false; message: string } => {
  if (profile.pins.length !== profile.numChannels) {
    return { ok: false, message: "pins length does not match numChannels." };
  }
  if (profile.ledsPerChannel.length !== profile.numChannels) {
    return { ok: false, message: "ledsPerChannel length does not match numChannels." };
  }
  if (profile.globalOffsets.length !== profile.ledCount) {
    return { ok: false, message: "globalOffsets length does not match ledCount." };
  }
  for (let i = 0; i < profile.numChannels; i++) {
    if ((profile.ledsPerChannel[i] ?? 0) <= 0) {
      return { ok: false, message: `Channel ${i} has zero LEDs.` };
    }
    const pin = profile.pins[i];
    if (pin === undefined || pin < 0) {
      return {
        ok: false,
        message: `Channel ${i} has no GPIO pin — assign pins in Device setup before upload.`,
      };
    }
    if (pin > 39) {
      return {
        ok: false,
        message: `Channel ${i} GPIO ${pin} is out of range for ESP32 (0–39).`,
      };
    }
  }
  const maxOff = maxWireByteOffset(profile);
  const wireCap = DEVICE_PROFILE_MAX_LEDS * 3;
  if (maxOff + 2 >= wireCap) {
    return {
      ok: false,
      message: `Wire offset ${maxOff} exceeds I2S buffer (${wireCap} bytes).`,
    };
  }
  return { ok: true };
};

/** Encode rig profile and run structural validation. */
export const encodeValidatedDeviceProfile = (
  rig: Rig,
  power: DeviceProfilePower,
  profileVersion = 1,
): { ok: true; bytes: Uint8Array } | { ok: false; message: string } => {
  const bytes = encodeDeviceProfile(rig, power, profileVersion);
  const decoded = decodeDeviceProfile(bytes);
  if (!decoded) {
    return { ok: false, message: "Encoded profile failed to decode." };
  }
  const check = validateDeviceProfile(decoded);
  if (!check.ok) return check;
  return { ok: true, bytes };
};
