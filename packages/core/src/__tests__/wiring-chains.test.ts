import { describe, expect, it } from "vitest";
import { buildWiringFromChains, DEFAULT_PINS } from "../wiring";

describe("buildWiringFromChains", () => {
  it("maps each non-empty row to a part and channel", () => {
    const { parts, channels } = buildWiringFromChains({
      chains: [
        ["a", "b"],
        [],
        ["c"],
      ],
      pins: DEFAULT_PINS,
    });
    expect(parts).toHaveLength(2);
    expect(parts[0]!.id).toBe("part-0");
    expect(parts[0]!.faceIds).toEqual(["a", "b"]);
    expect(parts[1]!.id).toBe("part-2");
    expect(parts[1]!.faceIds).toEqual(["c"]);
    expect(channels).toHaveLength(3);
    expect(channels[0]!.partIds).toEqual(["part-0"]);
    expect(channels[1]!.partIds).toEqual([]);
    expect(channels[2]!.partIds).toEqual(["part-2"]);
    expect(channels[0]!.pin).toBe(DEFAULT_PINS[0]);
    expect(channels[2]!.pin).toBe(DEFAULT_PINS[2]);
  });

  it("applies faceRotations to faceConnections", () => {
    const { parts } = buildWiringFromChains({
      chains: [["a", "b"]],
      pins: DEFAULT_PINS,
      faceRotations: { a: 1, b: 2 },
    });
    expect(parts[0]!.faceConnections![0]!.rotation).toBe(1);
    expect(parts[0]!.faceConnections![1]!.rotation).toBe(2);
  });
});
