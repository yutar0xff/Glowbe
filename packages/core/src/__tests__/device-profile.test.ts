import { describe, expect, it } from "vitest";
import {
  DEVICE_POWER_LIMITS,
  DEVICE_PROFILE_MAGIC,
  decodeDeviceProfile,
  deviceProfileByteSize,
  encodeValidatedDeviceProfile,
  rig60Panels,
  validateDeviceProfile,
} from "../index";

describe("device profile", () => {
  it("rejects invalid magic", () => {
    const buf = new Uint8Array(deviceProfileByteSize(1));
    expect(decodeDeviceProfile(buf)).toBeNull();
    writeU32LE(buf, 0, DEVICE_PROFILE_MAGIC);
    expect(decodeDeviceProfile(buf)).toBeNull();
  });

  it("rejects profiles with invalid GPIO pins", () => {
    const rig = rig60Panels(150);
    const built = encodeValidatedDeviceProfile(rig, DEVICE_POWER_LIMITS, 1);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const decoded = decodeDeviceProfile(built.bytes);
    expect(decoded).not.toBeNull();
    decoded!.pins[0] = 255;
    expect(validateDeviceProfile(decoded!)).toEqual({
      ok: false,
      message: "Channel 0 GPIO 255 is out of range for ESP32 (0–39).",
    });
  });

  it("round-trips 60panels rig with validation", () => {
    const rig = rig60Panels(150);
    const built = encodeValidatedDeviceProfile(rig, DEVICE_POWER_LIMITS, 1);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const decoded = decodeDeviceProfile(built.bytes);
    expect(decoded).not.toBeNull();
    expect(validateDeviceProfile(decoded!)).toEqual({ ok: true });
    expect(decoded!.ledCount).toBeGreaterThan(0);
  });
});

function writeU32LE(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >> 8) & 0xff;
  b[o + 2] = (v >> 16) & 0xff;
  b[o + 3] = (v >> 24) & 0xff;
}
