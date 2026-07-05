import { length, sub } from "../math/vec";
import type { Vec3 } from "../math/vec";

/** The three edge lengths of a triangular face (in the face's units, e.g. mm). */
export const faceEdgeLengths = (verts: Vec3[]): [number, number, number] => {
  const a = verts[0]!;
  const b = verts[1]!;
  const c = verts[2]!;
  return [length(sub(b, a)), length(sub(c, b)), length(sub(a, c))];
};

/** Mean edge length of a triangular face. */
export const faceEdgeLength = (verts: Vec3[]): number => {
  const [e0, e1, e2] = faceEdgeLengths(verts);
  return (e0 + e1 + e2) / 3;
};

/** Planar area of a triangle via Heron's formula. */
export const faceArea = (verts: Vec3[]): number => {
  const [a, b, c] = faceEdgeLengths(verts);
  const s = (a + b + c) / 2;
  return Math.sqrt(Math.max(0, s * (s - a) * (s - b) * (s - c)));
};

/**
 * Inradius of a triangular face (radius of the inscribed circle) = area / s,
 * where s is the semiperimeter. For an equilateral triangle this equals
 * edge / (2·√3) and is the distance from the centroid to each edge — which is
 * exactly how far the centroid-inset moves an LED away from the edges.
 */
export const faceInradius = (verts: Vec3[]): number => {
  const [a, b, c] = faceEdgeLengths(verts);
  const s = (a + b + c) / 2;
  if (s <= 0) return 0;
  return faceArea(verts) / s;
};

/**
 * Convert an edge-relative padding in physical units (e.g. mm) into the
 * centroid-inset fraction (0..0.45) used by the barycentric generator.
 * fraction = paddingMm / inradius, clamped to keep at least the apex LED valid.
 */
export const paddingMmToFraction = (paddingMm: number, inradius: number): number => {
  if (inradius <= 0 || paddingMm <= 0) return 0;
  const f = paddingMm / inradius;
  return f < 0 ? 0 : f > 0.45 ? 0.45 : f;
};
