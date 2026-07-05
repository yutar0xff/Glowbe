import { add, normalize, scale } from "../math/vec";
import type { Vec3 } from "../math/vec";
import type { RawFace, RawMesh } from "./mesh";

/**
 * Subdivide each triangular face into 4 (frequency 2V) and project the new
 * vertices onto the unit sphere. Applied once to an icosahedron this yields the
 * geodesic V2 icosahedron: 42 vertices, 80 faces. Each sub-face inherits its
 * parent's region, so the 5 bottom-cap faces become 20 bottom faces (the
 * "bottom 20" removed for the product).
 */
export const subdivide = (mesh: RawMesh): RawMesh => {
  const vertices: Vec3[] = mesh.vertices.map((v) => ({ ...v }));
  const faces: RawFace[] = [];

  // Cache midpoints by undirected edge so shared edges aren't duplicated.
  const midpointCache = new Map<string, number>();
  const edgeKey = (i: number, j: number) => (i < j ? `${i}_${j}` : `${j}_${i}`);

  const midpoint = (i: number, j: number): number => {
    const key = edgeKey(i, j);
    const cached = midpointCache.get(key);
    if (cached !== undefined) return cached;
    const vi = vertices[i]!;
    const vj = vertices[j]!;
    const mid = normalize(scale(add(vi, vj), 0.5));
    const index = vertices.push(mid) - 1;
    midpointCache.set(key, index);
    return index;
  };

  for (const f of mesh.faces) {
    const ab = midpoint(f.a, f.b);
    const bc = midpoint(f.b, f.c);
    const ca = midpoint(f.c, f.a);
    const region = f.region;
    faces.push({ a: f.a, b: ab, c: ca, region });
    faces.push({ a: ab, b: f.b, c: bc, region });
    faces.push({ a: ca, b: bc, c: f.c, region });
    faces.push({ a: ab, b: bc, c: ca, region });
  }

  return { vertices, faces };
};
