import { add, scale } from "./math/vec";
import type { Vec3 } from "./math/vec";
import { dirToUv } from "./mapping/uv";
import { generateBarycentric, resolveRowSizes } from "./layout/face-layout";
import type { Bary } from "./layout/face-layout";
import { faceInradius, paddingMmToFraction } from "./layout/face-metrics";
import type { Face, FaceLayout, LedPlacement, Rig } from "./schema";

/** Choose the layout for a face: exact id > exact type > "triangle" wildcard. */
export const findFaceLayout = (
  face: Face,
  layouts: FaceLayout[],
): FaceLayout | undefined => {
  return (
    layouts.find((l) => l.faceType === face.id) ??
    layouts.find((l) => l.faceType === face.type) ??
    (face.vertices.length === 3
      ? layouts.find((l) => l.faceType === "triangle")
      : undefined)
  );
};

const baryToPoint = (bary: Bary, verts: Vec3[]): Vec3 => {
  const a = verts[0]!;
  const b = verts[1]!;
  const c = verts[2]!;
  return add(add(scale(a, bary.a), scale(b, bary.b)), scale(c, bary.c));
};

/** Which mesh corners map to bary (a,b,c) after 120° in-plane attachment steps. */
const cycleTriangleVerticesForRotation = (verts: readonly Vec3[], steps: number): Vec3[] => {
  if (verts.length !== 3) return [...verts];
  const s = ((steps % 3) + 3) % 3;
  const v0 = verts[0]!;
  const v1 = verts[1]!;
  const v2 = verts[2]!;
  if (s === 0) return [v0, v1, v2];
  if (s === 1) return [v1, v2, v0];
  return [v2, v0, v1];
};

interface WireEntry {
  faceId: string;
  reversed: boolean;
  channel: number;
  /** 120° steps: which corner cycle of `face.vertices` to use when mapping bary→3D. */
  rotation: number;
}

/** Compute the wiring traversal order (which face, on which channel, flipped?). */
const wireOrder = (rig: Rig, activeIds: Set<string>): WireEntry[] => {
  const entries: WireEntry[] = [];

  if (rig.channels.length > 0) {
    const partsById = new Map(rig.parts.map((p) => [p.id, p]));
    for (const ch of [...rig.channels].sort((x, y) => x.index - y.index)) {
      for (const partId of ch.partIds) {
        const part = partsById.get(partId);
        if (!part) continue;
        const conns =
          part.faceConnections ??
          part.faceIds.map((id) => ({
            faceId: id,
            reversed: false,
            rotation: 0 as const,
          }));
        for (const conn of conns) {
          if (activeIds.has(conn.faceId)) {
            entries.push({
              faceId: conn.faceId,
              reversed: conn.reversed,
              channel: ch.index,
              rotation: conn.rotation ?? 0,
            });
          }
        }
      }
    }
    return entries;
  }

  // No wiring defined: everything on channel 0, in solid face order.
  for (const face of rig.solid.faces) {
    if (activeIds.has(face.id)) {
      entries.push({ faceId: face.id, reversed: false, channel: 0, rotation: 0 });
    }
  }
  return entries;
};

/**
 * Resolve a Rig into one `LedPlacement` per physical LED, with 3D position,
 * outward normal, equirectangular UV (for sampling 2:1 media), and physical
 * address (channel + chain index).
 */
export const resolveRig = (rig: Rig): LedPlacement[] => {
  const facesById = new Map(rig.solid.faces.map((f) => [f.id, f]));
  const activeIds = new Set(
    rig.solid.faces
      .map((f) => f.id)
      .filter((id) => !rig.solid.disabledFaceIds.includes(id)),
  );

  const placements: LedPlacement[] = [];
  const chainCounters = new Map<number, number>();
  let globalIndex = 0;

  for (const entry of wireOrder(rig, activeIds)) {
    const face = facesById.get(entry.faceId);
    if (!face) continue;

    const layout = findFaceLayout(face, rig.faceLayouts);
    if (!layout) {
      throw new Error(
        `No FaceLayout matches face "${face.id}" (type "${face.type}").`,
      );
    }

    const rowSizes = resolveRowSizes(layout.ledCount, layout.rowSizes);
    const padFraction =
      layout.paddingMm != null
        ? paddingMmToFraction(layout.paddingMm, faceInradius(face.vertices))
        : layout.padding;
    const bary = generateBarycentric(rowSizes, layout.pattern, padFraction, {
      mirrorLR: layout.chainMirrorLR,
    });
    const verts = cycleTriangleVerticesForRotation(face.vertices, entry.rotation);
    let seq = bary;
    if (entry.reversed) seq = [...seq].reverse();

    for (const b of seq) {
      const chainIndex = chainCounters.get(entry.channel) ?? 0;
      chainCounters.set(entry.channel, chainIndex + 1);
      const position = baryToPoint(b, verts);
      placements.push({
        globalIndex: globalIndex++,
        position,
        normal: face.normal,
        uv: dirToUv(position),
        address: { channel: entry.channel, chainIndex },
        faceId: face.id,
      });
    }
  }

  return placements;
};

/** Count active (enabled) faces in a Rig. */
export const activeFaceCount = (rig: Rig): number =>
  rig.solid.faces.filter((f) => !rig.solid.disabledFaceIds.includes(f.id))
    .length;
