import type { LedPattern } from "../schema";

/** Barycentric coordinate on a triangle: a*v0 + b*v1 + c*v2, with a+b+c=1. */
export interface Bary {
  a: number;
  b: number;
  c: number;
}

/**
 * Triangular row sizes for a triangular number of LEDs.
 * 15 -> [5,4,3,2,1], 10 -> [4,3,2,1], etc. Returns null if not triangular.
 */
export const triangularRowSizes = (ledCount: number): number[] | null => {
  let n = 0;
  let sum = 0;
  while (sum < ledCount) {
    n += 1;
    sum += n;
  }
  if (sum !== ledCount) return null;
  return Array.from({ length: n }, (_, i) => n - i); // [n, n-1, ..., 1]
};

/**
 * Resolve the effective row sizes for a layout. Explicit `rowSizes` win;
 * otherwise a triangular arrangement is derived from `ledCount`.
 */
export const resolveRowSizes = (
  ledCount: number,
  rowSizes: number[] | undefined,
): number[] => {
  if (rowSizes && rowSizes.length > 0) {
    const sum = rowSizes.reduce((s, n) => s + n, 0);
    if (sum !== ledCount) {
      throw new Error(
        `rowSizes sum (${sum}) does not match ledCount (${ledCount}).`,
      );
    }
    return rowSizes;
  }
  const tri = triangularRowSizes(ledCount);
  if (!tri) {
    throw new Error(
      `ledCount ${ledCount} is not a triangular number; provide rowSizes.`,
    );
  }
  return tri;
};

/** Swap base-corner weights (mirror left↔right on the triangular panel). */
export const mirrorBaryLR = (p: Bary): Bary => ({ a: p.b, b: p.a, c: p.c });

export type GenerateBarycentricOptions = {
  /** Mirror each row along the base edge (v0↔v1). */
  mirrorLR?: boolean;
};

/**
 * Generate per-LED barycentric coordinates for a triangular face, in chain
 * order from Din. Row 0 sits along the base edge (v0-v1); the apex is v2.
 *
 * - parallel-rows / triangular-rows: every row runs v0 -> v1.
 * - zigzag: odd rows are reversed (true serpentine), giving one continuous run.
 * - mirrorLR: flip every row left↔right (base corners swapped).
 */
export const generateBarycentric = (
  rowSizes: number[],
  pattern: LedPattern,
  padding = 0,
  options: GenerateBarycentricOptions = {},
): Bary[] => {
  const mirrorLR = options.mirrorLR === true;
  if (pattern === "spiral" || pattern === "custom") {
    throw new Error(`pattern "${pattern}" is not generated procedurally.`);
  }

  const rows = rowSizes.length;
  const out: Bary[] = [];

  for (let r = 0; r < rows; r++) {
    const c = rows === 1 ? 0 : r / (rows - 1); // height toward the apex
    const k = rowSizes[r]!;
    const rowPts: Bary[] = [];
    for (let j = 0; j < k; j++) {
      const b = k === 1 ? (1 - c) / 2 : (j / (k - 1)) * (1 - c);
      const a = 1 - c - b;
      rowPts.push({ a, b, c });
    }
    if (pattern === "zigzag" && r % 2 === 1) rowPts.reverse();
    if (mirrorLR) {
      for (let i = 0; i < rowPts.length; i++) rowPts[i] = mirrorBaryLR(rowPts[i]!);
    }
    out.push(...rowPts);
  }

  return padding > 0 ? out.map((p) => insetBary(p, padding)) : out;
};

/** Shrink a barycentric point toward the centroid to inset it from the edges. */
const insetBary = (p: Bary, padding: number): Bary => {
  const k = 1 - padding;
  const C = 1 / 3;
  return {
    a: C + k * (p.a - C),
    b: C + k * (p.b - C),
    c: C + k * (p.c - C),
  };
};
