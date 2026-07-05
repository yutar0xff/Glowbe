import { describe, expect, it } from "vitest";
import {
  activeFaceAdjacency,
  buildFaceAdjacency,
  faceCentroidUv,
  generateSolid,
  triangleLayout,
  type Rig,
} from "../index";

const minimalRig = (solid: ReturnType<typeof generateSolid>): Rig => ({
  meta: { id: "t", name: "t", schemaVersion: 1, units: "mm" },
  solid,
  faceLayouts: [triangleLayout()],
  parts: [],
  channels: [],
});

describe("buildFaceAdjacency", () => {
  it("icosahedron: each active face has 2–3 neighbors (boundary faces may have 2)", () => {
    const rig = minimalRig(generateSolid("icosahedron", 100));
    const adj = activeFaceAdjacency(rig);
    for (const id of adj.keys()) {
      const n = adj.get(id)!.size;
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(3);
    }
  });

  it("geodesic 2V: each active face has at most 3 neighbors", () => {
    const rig = minimalRig(generateSolid("geodesic-ico-2v", 100));
    const adj = activeFaceAdjacency(rig);
    for (const id of adj.keys()) {
      expect(adj.get(id)!.size).toBeLessThanOrEqual(3);
    }
  });
});

describe("faceCentroidUv", () => {
  it("returns UV in unit square", () => {
    const rig = minimalRig(generateSolid("icosahedron", 100));
    const f = rig.solid.faces[0]!;
    const uv = faceCentroidUv(f);
    expect(uv.x).toBeGreaterThanOrEqual(0);
    expect(uv.x).toBeLessThanOrEqual(1);
    expect(uv.y).toBeGreaterThanOrEqual(0);
    expect(uv.y).toBeLessThanOrEqual(1);
  });
});
