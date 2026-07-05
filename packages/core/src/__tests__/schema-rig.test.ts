import { describe, expect, it } from "vitest";
import { parseRig } from "../schema";
import { rig60Panels } from "../presets";

describe("RigSchema channels", () => {
  it("rejects channel index outside 0..9", () => {
    const rig = rig60Panels();
    const bad = {
      ...rig,
      channels: [...rig.channels, { index: 10, pin: 1, partIds: ["part-x"] }],
    };
    expect(() => parseRig(bad)).toThrow();
  });

  it("accepts indices 0..9", () => {
    const rig = rig60Panels();
    expect(() => parseRig(rig)).not.toThrow();
  });
});
