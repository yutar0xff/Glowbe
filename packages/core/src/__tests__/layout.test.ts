import { describe, expect, it } from "vitest";
import {
  generateBarycentric,
  resolveRowSizes,
  triangularRowSizes,
} from "../layout/face-layout";

describe("triangularRowSizes", () => {
  it("returns descending rows for triangular numbers", () => {
    expect(triangularRowSizes(15)).toEqual([5, 4, 3, 2, 1]);
    expect(triangularRowSizes(10)).toEqual([4, 3, 2, 1]);
    expect(triangularRowSizes(1)).toEqual([1]);
  });

  it("returns null for non-triangular counts", () => {
    expect(triangularRowSizes(7)).toBeNull();
    expect(triangularRowSizes(20)).toBeNull();
  });
});

describe("resolveRowSizes", () => {
  it("derives triangular rows when none are given", () => {
    expect(resolveRowSizes(15, undefined)).toEqual([5, 4, 3, 2, 1]);
  });

  it("accepts explicit rows that sum to ledCount", () => {
    expect(resolveRowSizes(15, [5, 4, 3, 2, 1])).toEqual([5, 4, 3, 2, 1]);
  });

  it("throws on a row-sum mismatch", () => {
    expect(() => resolveRowSizes(15, [5, 4, 3])).toThrow();
  });
});

describe("generateBarycentric", () => {
  const rows = [5, 4, 3, 2, 1];

  it("produces one valid barycentric coord per LED", () => {
    const pts = generateBarycentric(rows, "triangular-rows");
    expect(pts).toHaveLength(15);
    for (const p of pts) {
      expect(p.a + p.b + p.c).toBeCloseTo(1, 6);
      for (const v of [p.a, p.b, p.c]) {
        expect(v).toBeGreaterThanOrEqual(-1e-9);
        expect(v).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it("zigzag reverses odd rows but keeps the same point set", () => {
    const straight = generateBarycentric(rows, "triangular-rows");
    const zig = generateBarycentric(rows, "zigzag");
    expect(zig).toHaveLength(straight.length);
    // Row 0 (first 5) is unchanged; row 1 (next 4) is reversed.
    expect(zig.slice(0, 5)).toEqual(straight.slice(0, 5));
    expect(zig.slice(5, 9)).toEqual(straight.slice(5, 9).reverse());
  });

  it("rejects procedural generation of custom/spiral", () => {
    expect(() => generateBarycentric(rows, "custom")).toThrow();
  });

  it("mirrorLR swaps base corners on each row", () => {
    const base = generateBarycentric(rows, "triangular-rows");
    const mirrored = generateBarycentric(rows, "triangular-rows", 0, { mirrorLR: true });
    expect(mirrored).toHaveLength(base.length);
    for (let i = 0; i < base.length; i++) {
      expect(mirrored[i]!.a).toBeCloseTo(base[i]!.b, 6);
      expect(mirrored[i]!.b).toBeCloseTo(base[i]!.a, 6);
      expect(mirrored[i]!.c).toBeCloseTo(base[i]!.c, 6);
    }
  });

  it("padding insets every LED toward the centroid", () => {
    const plain = generateBarycentric(rows, "triangular-rows");
    const padded = generateBarycentric(rows, "triangular-rows", 0.2);
    expect(padded).toHaveLength(plain.length);
    const C = 1 / 3;
    const distToCenter = (p: { a: number; b: number; c: number }) =>
      Math.abs(p.a - C) + Math.abs(p.b - C) + Math.abs(p.c - C);
    // Corner LED (apex, c=1) must move strictly closer to the centroid.
    const apexPlain = plain[plain.length - 1]!;
    const apexPadded = padded[padded.length - 1]!;
    expect(distToCenter(apexPadded)).toBeLessThan(distToCenter(apexPlain));
    for (const p of padded) expect(p.a + p.b + p.c).toBeCloseTo(1, 6);
  });
});
