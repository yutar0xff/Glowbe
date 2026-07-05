import type { Vec2, Vec3 } from "../math/vec";

/**
 * Equirectangular projection for 2:1 media (width = 2 × height).
 *
 * Matches Three.js `SphereGeometry` (default phi/theta) and canvas row 0 = north:
 *   x = -cos(phi) * sin(theta),  y = cos(theta),  z = sin(phi) * sin(theta)
 *   u = phi / (2π),  phi = atan2(z, -x) in [0, 2π)
 *   v = theta / π,   theta = acos(y/r),  v = 0 north pole, v = 1 south pole
 */
export const dirToUv = (p: Vec3): Vec2 => {
  const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
  if (r === 0) return { x: 0.5, y: 0.5 };

  const x = p.x / r;
  const y = p.y / r;
  const z = p.z / r;

  const theta = Math.acos(Math.max(-1, Math.min(1, y)));
  const sinTheta = Math.sin(theta);

  let u = 0.5;
  if (sinTheta > 1e-8) {
    let phi = Math.atan2(z, -x);
    if (phi < 0) phi += 2 * Math.PI;
    u = phi / (2 * Math.PI);
  }

  return { x: u, y: theta / Math.PI };
};

/** Inverse: equirectangular UV -> unit direction (Three.js sphere parametrization). */
export const uvToDir = (uv: Vec2): Vec3 => {
  const phi = uv.x * 2 * Math.PI;
  const theta = uv.y * Math.PI;
  const sinTheta = Math.sin(theta);
  return {
    x: -Math.cos(phi) * sinTheta,
    y: Math.cos(theta),
    z: Math.sin(phi) * sinTheta,
  };
};
