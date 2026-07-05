import type { Vec3 } from "../math/vec";
import type { FaceRegion } from "../schema";

/** A triangular face referencing vertex indices, tagged with its solid region. */
export interface RawFace {
  a: number;
  b: number;
  c: number;
  region: FaceRegion;
}

/** A raw polyhedron mesh on the unit sphere (vertices normalized). */
export interface RawMesh {
  vertices: Vec3[];
  faces: RawFace[];
}
