import { length as vlen, scale, sub, triangleNormal } from "../math/vec";
import type { Vec3 } from "../math/vec";
import type { Face, Solid, SolidPreset } from "../schema";
import { icosahedron } from "./icosahedron";
import { subdivide } from "./geodesic";
import { octahedron, tetrahedron } from "./platonic";
import type { RawMesh } from "./mesh";

/** Build the raw unit-sphere mesh for a preset. */
export const rawSolid = (preset: SolidPreset): RawMesh => {
  switch (preset) {
    case "icosahedron":
      return icosahedron();
    case "geodesic-ico-2v":
      return subdivide(icosahedron());
    case "octahedron":
      return octahedron();
    case "tetrahedron":
      return tetrahedron();
    default:
      throw new Error(
        `Solid preset "${preset}" is not implemented yet (Phase 5).`,
      );
  }
};

/** Presets currently buildable by `generateSolid`. */
export const IMPLEMENTED_SOLID_PRESETS = [
  "icosahedron",
  "geodesic-ico-2v",
  "octahedron",
  "tetrahedron",
] as const satisfies readonly SolidPreset[];

/**
 * Representative edge length of a preset's mesh on the unit sphere (radius 1),
 * averaged over all faces. Geodesic solids have a couple of distinct edge
 * lengths; the mean is a stable "one edge" proxy for the radius↔edge UI.
 */
const unitEdgeLengthCache = new Map<SolidPreset, number>();
export const unitEdgeLength = (preset: SolidPreset): number => {
  const cached = unitEdgeLengthCache.get(preset);
  if (cached !== undefined) return cached;
  const mesh = rawSolid(preset);
  let sum = 0;
  let count = 0;
  for (const f of mesh.faces) {
    const a = mesh.vertices[f.a]!;
    const b = mesh.vertices[f.b]!;
    const c = mesh.vertices[f.c]!;
    sum += vlen(sub(b, a)) + vlen(sub(c, b)) + vlen(sub(a, c));
    count += 3;
  }
  const edge = count > 0 ? sum / count : 0;
  unitEdgeLengthCache.set(preset, edge);
  return edge;
};

/** Mean physical edge length (mm) of a preset's faces at a given sphere radius. */
export const edgeLengthForRadius = (preset: SolidPreset, radius: number): number =>
  unitEdgeLength(preset) * radius;

/** Sphere radius (mm) that yields the given mean face edge length (mm). */
export const radiusForEdgeLength = (preset: SolidPreset, edge: number): number => {
  const u = unitEdgeLength(preset);
  return u > 0 ? edge / u : 0;
};

const classifyTriangle = (a: Vec3, b: Vec3, c: Vec3): string => {
  const e0 = vlen(sub(b, a));
  const e1 = vlen(sub(c, b));
  const e2 = vlen(sub(a, c));
  const max = Math.max(e0, e1, e2);
  const min = Math.min(e0, e1, e2);
  return (max - min) / max < 1e-6 ? "equilateral" : "isosceles";
};

/** Convert a raw unit-sphere mesh into a schema Solid scaled to `radius`. */
export const meshToSolid = (
  mesh: RawMesh,
  radius: number,
  preset: SolidPreset,
): Solid => {
  const faces: Face[] = mesh.faces.map((f, i) => {
    const a = scale(mesh.vertices[f.a]!, radius);
    const b = scale(mesh.vertices[f.b]!, radius);
    const c = scale(mesh.vertices[f.c]!, radius);
    return {
      id: `face-${i}`,
      type: classifyTriangle(a, b, c),
      vertices: [a, b, c],
      normal: triangleNormal(a, b, c),
      orientation: 0,
      region: f.region,
    };
  });

  return {
    preset,
    radius,
    faces,
    disabledFaceIds: faces.filter((f) => f.region === "bottom").map((f) => f.id),
  };
};

/**
 * Generate a Solid for a preset with the default cap removed (bottom region):
 * - icosahedron      -> 20 faces, bottom 5 disabled (15 active)
 * - geodesic-ico-2v  -> 80 faces, bottom 20 disabled (60 active)
 */
export const generateSolid = (preset: SolidPreset, radius: number): Solid =>
  meshToSolid(rawSolid(preset), radius, preset);
