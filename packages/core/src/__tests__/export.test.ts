import { describe, expect, it } from "vitest";
import { buildCalibration } from "../export/calibration";
import { generateLayoutHeader } from "../export/header";
import { rig60Panels } from "../presets";
import { autoAssignWiring } from "../wiring";

describe("buildCalibration", () => {
  it("totals match and per-channel counts sum to the total", () => {
    const rig = autoAssignWiring(rig60Panels(), { numChannels: 10 });
    const cal = buildCalibration(rig);
    expect(cal.totalLeds).toBe(900);
    expect(cal.leds).toHaveLength(900);
    const sum = cal.channels.reduce((s, c) => s + c.ledCount, 0);
    expect(sum).toBe(900);
  });
});

describe("generateLayoutHeader", () => {
  it("emits the totals and channel count", () => {
    const rig = autoAssignWiring(rig60Panels(), { numChannels: 10 });
    const header = generateLayoutHeader(rig);
    expect(header).toContain("#define GLOWBE_TOTAL_LEDS 900");
    expect(header).toContain("#define GLOWBE_NUM_CHANNELS 10");
    expect(header).toContain("GLOWBE_LEDS_PER_CHANNEL");
    expect(header).toContain("GLOWBE_GLOBAL_OFFSET");
  });
});
