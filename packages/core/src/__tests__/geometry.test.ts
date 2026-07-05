import { describe, expect, it } from "vitest";
import { centroid, dot } from "../math/vec";
import { icosahedron } from "../geometry/icosahedron";
import { subdivide } from "../geometry/geodesic";
import { octahedron, tetrahedron } from "../geometry/platonic";
import { generateSolid } from "../geometry/solids";
import type { FaceRegion } from "../schema";

const regionCounts = (regions: FaceRegion[]) => {
  const counts = { top: 0, middle: 0, bottom: 0 };
  for (const r of regions) counts[r] += 1;
  return counts;
};

describe("icosahedron", () => {
  const mesh = icosahedron();

  it("has 12 vertices and 20 triangular faces", () => {
    expect(mesh.vertices).toHaveLength(12);
    expect(mesh.faces).toHaveLength(20);
  });

  it("has all vertices on the unit sphere", () => {
    for (const v of mesh.vertices) {
      expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 6);
    }
  });

  it("splits faces into top 5 / middle 10 / bottom 5", () => {
    expect(regionCounts(mesh.faces.map((f) => f.region))).toEqual({
      top: 5,
      middle: 10,
      bottom: 5,
    });
  });
});

describe("geodesic 2V", () => {
  const mesh = subdivide(icosahedron());

  it("has 42 vertices and 80 faces", () => {
    expect(mesh.vertices).toHaveLength(42);
    expect(mesh.faces).toHaveLength(80);
  });

  it("inherits regions: top 20 / middle 40 / bottom 20", () => {
    expect(regionCounts(mesh.faces.map((f) => f.region))).toEqual({
      top: 20,
      middle: 40,
      bottom: 20,
    });
  });
});

describe("platonic solids", () => {
  it("octahedron has 6 vertices and 8 faces", () => {
    const mesh = octahedron();
    expect(mesh.vertices).toHaveLength(6);
    expect(mesh.faces).toHaveLength(8);
  });

  it("tetrahedron has 4 vertices and 4 faces", () => {
    const mesh = tetrahedron();
    expect(mesh.vertices).toHaveLength(4);
    expect(mesh.faces).toHaveLength(4);
  });

  it("does not disable faces on exploratory solids", () => {
    expect(generateSolid("octahedron", 1).disabledFaceIds).toHaveLength(0);
    expect(generateSolid("tetrahedron", 1).disabledFaceIds).toHaveLength(0);
  });
});

describe("generateSolid", () => {
  it("produces outward-facing normals", () => {
    const solid = generateSolid("icosahedron", 1);
    for (const face of solid.faces) {
      const c = centroid(face.vertices);
      expect(dot(face.normal, c)).toBeGreaterThan(0);
    }
  });

  it("disables the bottom cap by default", () => {
    expect(generateSolid("icosahedron", 1).disabledFaceIds).toHaveLength(5);
    expect(generateSolid("geodesic-ico-2v", 1).disabledFaceIds).toHaveLength(20);
  });

  it("produces outward normals for the octahedron too", () => {
    const solid = generateSolid("octahedron", 1);
    for (const face of solid.faces) {
      expect(dot(face.normal, centroid(face.vertices))).toBeGreaterThan(0);
    }
  });

  it("throws for unimplemented presets", () => {
    expect(() => generateSolid("dodecahedron", 1)).toThrow();
  });
});
