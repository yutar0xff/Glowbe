import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEVICE_POWER_LIMITS,
  FIRMWARE_BRIGHTNESS_MODEL,
  firmwareLedBrightnessByte,
} from "../power";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

const limitsHeader = readFileSync(
  join(repoRoot, "firmware/esp32/include/glowbe_power_limits.h"),
  "utf8",
);

const brightnessHeader = readFileSync(
  join(repoRoot, "firmware/esp32/include/glowbe_brightness.h"),
  "utf8",
);

function parseFloatConst(header: string, name: string): number {
  const m = header.match(new RegExp(`${name}\\s*=\\s*([0-9.]+)f`));
  if (!m) throw new Error(`missing ${name}`);
  return Number(m[1]);
}

function parseUintConst(header: string, name: string): number {
  const m = header.match(new RegExp(`${name}\\s*=\\s*([0-9]+)u`));
  if (!m) throw new Error(`missing ${name}`);
  return Number(m[1]);
}

function parseDefaultDefine(header: string, name: string): number {
  const m = header.match(new RegExp(`#define\\s+${name}\\s+([0-9]+)u`));
  if (!m) throw new Error(`missing default ${name}`);
  return Number(m[1]);
}

describe("firmware power limits header", () => {
  it("matches DEVICE_POWER_LIMITS from @glowbe/core", () => {
    expect(parseFloatConst(limitsHeader, "kGlowbeMaPerChannelFull")).toBe(
      DEVICE_POWER_LIMITS.mAPerChannelFull,
    );
    expect(parseFloatConst(limitsHeader, "kGlowbeIdleMaPerLed")).toBe(DEVICE_POWER_LIMITS.idleMaPerLed);
    expect(parseFloatConst(limitsHeader, "kGlowbeMaxCurrentA")).toBe(DEVICE_POWER_LIMITS.maxCurrentA);
  });
});

describe("firmware brightness header", () => {
  it("matches FIRMWARE_BRIGHTNESS_MODEL from @glowbe/core", () => {
    expect(parseUintConst(brightnessHeader, "kGlowbeLedWhiteMa")).toBe(
      FIRMWARE_BRIGHTNESS_MODEL.ledWhiteMa,
    );
    expect(parseDefaultDefine(brightnessHeader, "GLOWBE_MAX_CURRENT_MA")).toBe(
      FIRMWARE_BRIGHTNESS_MODEL.defaultMaxCurrentMa,
    );
  });

  it("computes 60-panel ceiling at default budget", () => {
    expect(firmwareLedBrightnessByte(1260)).toBe(40);
  });
});
