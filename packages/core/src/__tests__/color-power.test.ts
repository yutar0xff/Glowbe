import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLOR_SETTINGS,
  DEFAULT_POWER_MODEL,
  DEVICE_POWER_LIMITS,
  applyColor,
  brightness01ToControlByte,
  currentClampScale,
  deviceEffectiveBrightnessByte,
  deviceMaxBrightnessByte,
  scaleChannelForDeviceOutput,
  estimatePower,
  mapRgbForDevice,
} from "../index";

describe("applyColor", () => {
  it("is identity with linear gamma and unity WB", () => {
    expect(applyColor(255, 128, 0, { ...DEFAULT_COLOR_SETTINGS, gamma: 1 })).toEqual([255, 128, 0]);
  });

  it("does not apply brightness (preview stays full-range)", () => {
    const [r] = applyColor(255, 0, 0, { ...DEFAULT_COLOR_SETTINGS, brightness: 0.5 });
    expect(r).toBe(255);
  });

  it("applies white balance per channel", () => {
    const [r, g, b] = applyColor(200, 200, 200, {
      ...DEFAULT_COLOR_SETTINGS,
      gamma: 1,
      whiteBalance: { r: 0.5, g: 1, b: 2 },
    });
    expect(r).toBe(100);
    expect(g).toBe(200);
    expect(b).toBe(255);
  });

  it("gamma 2 darkens midtones", () => {
    const [r] = applyColor(128, 0, 0, { ...DEFAULT_COLOR_SETTINGS, gamma: 2 });
    expect(r).toBeLessThan(128);
    expect(r).toBeGreaterThan(0);
  });
});

describe("deviceMaxBrightnessByte", () => {
  it("matches firmware formula for 900 LEDs at 2 A", () => {
    expect(deviceMaxBrightnessByte(900, DEVICE_POWER_LIMITS)).toBe(8);
  });

  it("returns 255 when budget exceeds full-white draw", () => {
    expect(deviceMaxBrightnessByte(1, { ...DEVICE_POWER_LIMITS, maxCurrentA: 100 })).toBe(255);
  });
});

describe("brightness01ToControlByte", () => {
  it("maps 100% to 255", () => {
    expect(brightness01ToControlByte(1)).toBe(255);
  });
});

describe("scaleChannelForDeviceOutput", () => {
  const n = 900;

  it("is monotonic in CONTROL for white", () => {
    const low = scaleChannelForDeviceOutput(255, 26, n);
    const mid = scaleChannelForDeviceOutput(255, 128, n);
    const high = scaleChannelForDeviceOutput(255, 255, n);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
    expect(high).toBe(deviceMaxBrightnessByte(n, DEVICE_POWER_LIMITS));
  });

  it("driver brightness has eight steps for white when ceiling is 8", () => {
    const levels = new Set<number>();
    for (let c = 0; c <= 255; c++) {
      levels.add(deviceEffectiveBrightnessByte(c, n, DEVICE_POWER_LIMITS));
    }
    expect(levels.size).toBe(9);
    expect(deviceEffectiveBrightnessByte(255, n, DEVICE_POWER_LIMITS)).toBe(8);
    expect(deviceEffectiveBrightnessByte(32, n, DEVICE_POWER_LIMITS)).toBe(1);
  });
});

describe("mapRgbForDevice", () => {
  const ledCount = 1;

  it("maps 0% brightness to zero", () => {
    const rgb = new Uint8Array([255, 128, 0]);
    expect(mapRgbForDevice(rgb, 0, ledCount)).toEqual(new Uint8Array([0, 0, 0]));
  });

  it("at 100% caps white at the device ceiling", () => {
    const rgb = new Uint8Array([255, 128, 0]);
    const ceiling = deviceMaxBrightnessByte(ledCount, DEVICE_POWER_LIMITS);
    expect(mapRgbForDevice(rgb, 1, ledCount)).toEqual(
      new Uint8Array([ceiling, scaleChannelForDeviceOutput(128, 255, ledCount), 0]),
    );
  });

  it("maps 50% CONTROL to roughly half the white cap", () => {
    const rgb = new Uint8Array([255, 100, 0]);
    const half = scaleChannelForDeviceOutput(255, 128, ledCount);
    expect(mapRgbForDevice(rgb, 0.5, ledCount)).toEqual(
      new Uint8Array([
        half,
        scaleChannelForDeviceOutput(100, 128, ledCount),
        0,
      ]),
    );
  });
});

describe("estimatePower", () => {
  it("counts idle current with all LEDs off", () => {
    const rgb = new Uint8Array(3 * 10);
    const e = estimatePower(rgb, DEFAULT_POWER_MODEL);
    expect(e.ledCount).toBe(10);
    expect(e.currentA).toBeCloseTo((10 * DEFAULT_POWER_MODEL.idleMaPerLed) / 1000, 6);
  });

  it("full white scales with channel count", () => {
    const rgb = new Uint8Array(3 * 2).fill(255);
    const e = estimatePower(rgb, DEFAULT_POWER_MODEL);
    const expectedMa = 6 * DEFAULT_POWER_MODEL.mAPerChannelFull + 2 * DEFAULT_POWER_MODEL.idleMaPerLed;
    expect(e.currentA).toBeCloseTo(expectedMa / 1000, 6);
  });
});

describe("currentClampScale", () => {
  it("returns 1 when clamp disabled", () => {
    const est = { currentA: 999, watts: 0, ledCount: 100 };
    expect(currentClampScale(est, { ...DEFAULT_POWER_MODEL, clampEnabled: false })).toBe(1);
  });

  it("scales down the dynamic portion above budget", () => {
    const est = { currentA: 4.1, watts: 0, ledCount: 100 };
    const scale = currentClampScale(est, {
      ...DEFAULT_POWER_MODEL,
      clampEnabled: true,
      idleMaPerLed: 1,
      maxCurrentA: 2.1,
    });
    expect(scale).toBeCloseTo(0.5, 6);
  });
});
