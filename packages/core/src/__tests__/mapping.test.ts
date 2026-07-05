import { describe, expect, it } from "vitest";
import { dirToUv, uvToDir } from "../mapping/uv";

describe("equirectangular mapping (Three.js SphereGeometry)", () => {
  it("maps the poles to v=0 (north) and v=1 (south)", () => {
    expect(dirToUv({ x: 0, y: 1, z: 0 }).y).toBeCloseTo(0, 6);
    expect(dirToUv({ x: 0, y: -1, z: 0 }).y).toBeCloseTo(1, 6);
  });

  it("maps the equator to v=0.5", () => {
    expect(dirToUv({ x: 1, y: 0, z: 0 }).y).toBeCloseTo(0.5, 6);
  });

  it("uses phi = atan2(z, -x) for longitude (matches +Z at u=0.25)", () => {
    expect(dirToUv({ x: 1, y: 0, z: 0 }).x).toBeCloseTo(0.5, 6);
    expect(dirToUv({ x: 0, y: 0, z: 1 }).x).toBeCloseTo(0.25, 6);
    expect(dirToUv({ x: 0, y: 0, z: -1 }).x).toBeCloseTo(0.75, 6);
  });

  it("round-trips direction -> uv -> direction", () => {
    const dirs = [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0.3, y: 0.5, z: -0.8 },
      { x: -0.6, y: -0.2, z: 0.4 },
    ];
    for (const d of dirs) {
      const r = Math.hypot(d.x, d.y, d.z);
      const unit = { x: d.x / r, y: d.y / r, z: d.z / r };
      const back = uvToDir(dirToUv(unit));
      expect(back.x).toBeCloseTo(unit.x, 5);
      expect(back.y).toBeCloseTo(unit.y, 5);
      expect(back.z).toBeCloseTo(unit.z, 5);
    }
  });
});
