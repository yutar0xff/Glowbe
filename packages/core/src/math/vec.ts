/** Minimal vector math. Pure, dependency-free, no Three.js types in the API. */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const add = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});

export const sub = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});

export const scale = (a: Vec3, s: number): Vec3 => ({
  x: a.x * s,
  y: a.y * s,
  z: a.z * s,
});

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export const length = (a: Vec3): number => Math.sqrt(dot(a, a));

export const normalize = (a: Vec3): Vec3 => {
  const len = length(a);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  return scale(a, 1 / len);
};

export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 =>
  add(scale(a, 1 - t), scale(b, t));

/** Centroid (average) of a set of points. */
export const centroid = (points: Vec3[]): Vec3 => {
  const sum = points.reduce(add, vec3(0, 0, 0));
  return scale(sum, 1 / Math.max(points.length, 1));
};

/**
 * Outward triangle normal. Flipped so it points away from the solid's center
 * (assumed to be the origin), which makes face orientation independent of
 * vertex winding order.
 */
export const triangleNormal = (a: Vec3, b: Vec3, c: Vec3): Vec3 => {
  const n = normalize(cross(sub(b, a), sub(c, a)));
  const facing = centroid([a, b, c]);
  return dot(n, facing) < 0 ? scale(n, -1) : n;
};
