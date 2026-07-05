import { normalize, vec3 } from "../math/vec";
import type { RawMesh } from "./mesh";

/**
 * Pole-oriented octahedron: top/bottom vertices + a 4-vertex equator ring.
 * All faces are tagged "middle" (no default cap removal for this exploratory
 * solid). 6 vertices, 8 equilateral faces.
 */
export const octahedron = (): RawMesh => {
  const deg = (d: number) => (d * Math.PI) / 180;
  const vertices = [vec3(0, 1, 0)];
  for (let i = 0; i < 4; i++) {
    const lon = deg(90 * i);
    vertices.push(vec3(Math.cos(lon), 0, Math.sin(lon)));
  }
  vertices.push(vec3(0, -1, 0));

  const E = (i: number) => 1 + (i % 4);
  const faces: RawMesh["faces"] = [];
  for (let i = 0; i < 4; i++) {
    faces.push({ a: 0, b: E(i), c: E(i + 1), region: "middle" });
    faces.push({ a: 5, b: E(i + 1), c: E(i), region: "middle" });
  }
  return { vertices: vertices.map(normalize), faces };
};

/** Regular tetrahedron: 4 vertices, 4 equilateral faces (all "middle"). */
export const tetrahedron = (): RawMesh => {
  const vertices = [
    vec3(1, 1, 1),
    vec3(1, -1, -1),
    vec3(-1, 1, -1),
    vec3(-1, -1, 1),
  ];
  const faces: RawMesh["faces"] = [
    { a: 0, b: 1, c: 2, region: "middle" },
    { a: 0, b: 2, c: 3, region: "middle" },
    { a: 0, b: 3, c: 1, region: "middle" },
    { a: 1, b: 3, c: 2, region: "middle" },
  ];
  return { vertices: vertices.map(normalize), faces };
};
