import { describe, expect, it } from "vitest";
import {
  buildWiring,
  edgeLengthForRadius,
  faceEdgeLength,
  faceInradius,
  generateSolid,
  paddingMmToFraction,
  radiusForEdgeLength,
  resolveRig,
  triangleLayout,
  type Vec3,
} from "../index";

// Equilateral triangle with edge length 1.
const eq: Vec3[] = [
  { x: 0, y: 0, z: 0 },
  { x: 1, y: 0, z: 0 },
  { x: 0.5, y: Math.sqrt(3) / 2, z: 0 },
];

describe("face metrics", () => {
  it("computes edge length", () => {
    expect(faceEdgeLength(eq)).toBeCloseTo(1, 6);
  });

  it("inradius of unit equilateral = 1/(2√3)", () => {
    expect(faceInradius(eq)).toBeCloseTo(1 / (2 * Math.sqrt(3)), 6);
  });

  it("paddingMmToFraction = paddingMm / inradius, clamped", () => {
    const ir = faceInradius(eq);
    expect(paddingMmToFraction(ir * 0.2, ir)).toBeCloseTo(0.2, 6);
    expect(paddingMmToFraction(ir * 10, ir)).toBe(0.45);
    expect(paddingMmToFraction(0, ir)).toBe(0);
  });
});

describe("edge ↔ radius", () => {
  it("round-trips for icosahedron", () => {
    const r = 150;
    const e = edgeLengthForRadius("icosahedron", r);
    expect(e).toBeGreaterThan(0);
    expect(radiusForEdgeLength("icosahedron", e)).toBeCloseTo(r, 4);
  });
});

describe("buildWiring", () => {
  it("splits the chain into contiguous channels and resolves", () => {
    const rig = { ...generateSolidRig(), faceLayouts: [triangleLayout()] };
    const order = rig.solid.faces
      .map((f) => f.id)
      .filter((id) => !rig.solid.disabledFaceIds.includes(id));
    const { parts, channels } = buildWiring({ faceOrder: order, numChannels: 3 });
    expect(channels).toHaveLength(3);
    expect(parts.reduce((n, p) => n + p.faceIds.length, 0)).toBe(order.length);

    const wired = resolveRig({ ...rig, parts, channels });
    const usedChannels = new Set(wired.map((l) => l.address.channel));
    expect(usedChannels.size).toBe(3);
  });
});

function generateSolidRig() {
  return {
    meta: { id: "t", name: "t", schemaVersion: 1, units: "mm" as const },
    solid: generateSolid("icosahedron", 100),
    faceLayouts: [triangleLayout()],
    parts: [],
    channels: [],
  };
}
