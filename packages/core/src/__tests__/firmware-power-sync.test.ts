import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEVICE_POWER_LIMITS } from "../power";

const limitsHeader = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../../firmware/esp32/include/glowbe_power_limits.h"),
  "utf8",
);

function parseFloatConst(name: string): number {
  const m = limitsHeader.match(new RegExp(`${name}\\s*=\\s*([0-9.]+)f`));
  if (!m) throw new Error(`missing ${name} in glowbe_power_limits.h`);
  return Number(m[1]);
}

describe("firmware power limits header", () => {
  it("matches DEVICE_POWER_LIMITS from @glowbe/core", () => {
    expect(parseFloatConst("kGlowbeMaPerChannelFull")).toBe(DEVICE_POWER_LIMITS.mAPerChannelFull);
    expect(parseFloatConst("kGlowbeIdleMaPerLed")).toBe(DEVICE_POWER_LIMITS.idleMaPerLed);
    expect(parseFloatConst("kGlowbeMaxCurrentA")).toBe(DEVICE_POWER_LIMITS.maxCurrentA);
  });
});
