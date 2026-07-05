import { describe, expect, it } from "vitest";
import { activeFaceCount, resolveRig } from "../resolve";
import { rig15Panels, rig60Panels } from "../presets";
import { autoAssignWiring } from "../wiring";

describe("resolveRig — 15panels (icosahedron)", () => {
  const rig = rig15Panels();
  const leds = resolveRig(rig);

  it("has 15 active faces and 225 LEDs", () => {
    expect(activeFaceCount(rig)).toBe(15);
    expect(leds).toHaveLength(225);
  });

  it("assigns a unique, contiguous globalIndex", () => {
    const indices = leds.map((l) => l.globalIndex);
    expect(new Set(indices).size).toBe(225);
    expect(Math.min(...indices)).toBe(0);
    expect(Math.max(...indices)).toBe(224);
  });

  it("produces equirectangular UVs inside [0,1]", () => {
    for (const l of leds) {
      expect(l.uv.x).toBeGreaterThanOrEqual(0);
      expect(l.uv.x).toBeLessThanOrEqual(1);
      expect(l.uv.y).toBeGreaterThanOrEqual(0);
      expect(l.uv.y).toBeLessThanOrEqual(1);
    }
  });

  it("produces unit-length normals", () => {
    for (const l of leds) {
      expect(Math.hypot(l.normal.x, l.normal.y, l.normal.z)).toBeCloseTo(1, 6);
    }
  });
});

describe("resolveRig — 60panels (geodesic 2V)", () => {
  const rig = rig60Panels();

  it("has 60 active faces and 900 LEDs", () => {
    expect(activeFaceCount(rig)).toBe(60);
    expect(resolveRig(rig)).toHaveLength(900);
  });
});

describe("autoAssignWiring", () => {
  it("keeps the LED count and resets chainIndex per channel", () => {
    const wired = autoAssignWiring(rig15Panels(), { numChannels: 10 });
    const leds = resolveRig(wired);
    expect(leds).toHaveLength(225);

    const channels = new Set(leds.map((l) => l.address.channel));
    expect(channels.size).toBeGreaterThan(1);
    expect(channels.size).toBeLessThanOrEqual(10);

    // Each channel's chain indices start at 0 and are contiguous.
    for (const ch of channels) {
      const idx = leds
        .filter((l) => l.address.channel === ch)
        .map((l) => l.address.chainIndex)
        .sort((a, b) => a - b);
      expect(idx[0]).toBe(0);
      expect(idx[idx.length - 1]).toBe(idx.length - 1);
    }
  });
});
