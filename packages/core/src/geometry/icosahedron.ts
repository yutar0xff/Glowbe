import { normalize, vec3 } from "../math/vec";
import type { RawMesh } from "./mesh";

/**
 * Pole-oriented icosahedron on the unit sphere: one vertex at the north pole,
 * one at the south pole, and two rings of five. This orientation makes the
 * "south cap" (the 5 faces around the bottom vertex) easy to identify and
 * remove for the prototype.
 *
 * Vertex indices:
 *   0        : north pole
 *   1..5     : upper ring  (latitude +atan(1/2), longitudes 0, 72, 144, ...)
 *   6..10    : lower ring  (latitude -atan(1/2), longitudes 36, 108, 180, ...)
 *   11       : south pole
 */
export const icosahedron = (): RawMesh => {
  const ringY = 1 / Math.sqrt(5);
  const ringR = 2 / Math.sqrt(5);
  const deg = (d: number) => (d * Math.PI) / 180;

  const vertices = [vec3(0, 1, 0)];

  // Upper ring (indices 1..5)
  for (let i = 0; i < 5; i++) {
    const lon = deg(72 * i);
    vertices.push(vec3(ringR * Math.cos(lon), ringY, ringR * Math.sin(lon)));
  }
  // Lower ring (indices 6..10)
  for (let i = 0; i < 5; i++) {
    const lon = deg(36 + 72 * i);
    vertices.push(vec3(ringR * Math.cos(lon), -ringY, ringR * Math.sin(lon)));
  }
  vertices.push(vec3(0, -1, 0)); // south pole (index 11)

  const U = (i: number) => 1 + (i % 5);
  const L = (i: number) => 6 + (i % 5);

  const faces: RawMesh["faces"] = [];

  // Top cap: 5 faces around the north pole.
  for (let i = 0; i < 5; i++) {
    faces.push({ a: 0, b: U(i + 1), c: U(i), region: "top" });
  }
  // Middle band: 10 faces (one down-pointing + one up-pointing per segment).
  for (let i = 0; i < 5; i++) {
    faces.push({ a: U(i), b: U(i + 1), c: L(i), region: "middle" });
    faces.push({ a: L(i), b: U(i + 1), c: L(i + 1), region: "middle" });
  }
  // Bottom cap: 5 faces around the south pole (the prototype removes these).
  for (let i = 0; i < 5; i++) {
    faces.push({ a: 11, b: L(i), c: L(i + 1), region: "bottom" });
  }

  return { vertices: vertices.map(normalize), faces };
};
