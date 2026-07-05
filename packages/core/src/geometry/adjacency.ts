import { centroid, length } from "../math/vec";
import type { Vec3 } from "../math/vec";
import type { Face, Rig } from "../schema";
import { dirToUv } from "../mapping/uv";

const VERT_DECIMALS = 3;

const roundKey = (v: Vec3): string =>
  `${v.x.toFixed(VERT_DECIMALS)},${v.y.toFixed(VERT_DECIMALS)},${v.z.toFixed(VERT_DECIMALS)}`;

/** Undirected edge key for matching across faces (vertex order normalized). */
const edgeKey = (a: Vec3, b: Vec3): string => {
  const ka = roundKey(a);
  const kb = roundKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
};

/**
 * Build adjacency among triangular faces: two faces are adjacent if they share
 * an edge (two vertices within rounding tolerance).
 */
export const buildFaceAdjacency = (faces: Face[]): Map<string, Set<string>> => {
  const edgeToFaces = new Map<string, Set<string>>();
  for (const f of faces) {
    const v = f.vertices;
    if (v.length < 3) continue;
    const a = v[0]!;
    const b = v[1]!;
    const c = v[2]!;
    const edges = [
      edgeKey(a, b),
      edgeKey(b, c),
      edgeKey(c, a),
    ];
    for (const ek of edges) {
      let set = edgeToFaces.get(ek);
      if (!set) {
        set = new Set();
        edgeToFaces.set(ek, set);
      }
      set.add(f.id);
    }
  }

  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    let sa = adj.get(a);
    if (!sa) {
      sa = new Set();
      adj.set(a, sa);
    }
    sa.add(b);
    let sb = adj.get(b);
    if (!sb) {
      sb = new Set();
      adj.set(b, sb);
    }
    sb.add(a);
  };

  for (const set of edgeToFaces.values()) {
    if (set.size !== 2) continue;
    const [x, y] = [...set];
    if (x && y) link(x, y);
  }

  return adj;
};

/** Active (non-disabled) face ids in solid order. */
export const activeFaces = (rig: Rig): Face[] =>
  rig.solid.faces.filter((f) => !rig.solid.disabledFaceIds.includes(f.id));

/** Adjacency restricted to active faces. */
export const activeFaceAdjacency = (rig: Rig): Map<string, Set<string>> => {
  const active = new Set(activeFaces(rig).map((f) => f.id));
  const full = buildFaceAdjacency(rig.solid.faces);
  const out = new Map<string, Set<string>>();
  for (const id of active) {
    const nbr = full.get(id);
    if (!nbr) continue;
    const filtered = new Set([...nbr].filter((x) => active.has(x)));
    if (filtered.size > 0) out.set(id, filtered);
  }
  return out;
};

/** Unit direction of face centroid (from origin through centroid). */
export const faceCentroidDir = (face: Face): Vec3 => {
  const c = centroid(face.vertices);
  const r = length(c);
  if (r < 1e-12) return { x: 0, y: 1, z: 0 };
  return { x: c.x / r, y: c.y / r, z: c.z / r };
};

/** Equirectangular UV of the face centroid (same convention as `dirToUv`). */
export const faceCentroidUv = (face: Face) => dirToUv(faceCentroidDir(face));
