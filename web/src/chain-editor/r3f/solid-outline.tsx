

import { useEffect, useMemo } from "react";
import type { Face, Rig } from "@glowbe/core";
import * as THREE from "three";

const HOVER_OUTLINE = "#e2e8f0";
const MONO_HIGHLIGHT = "#fbbf24";

function pushFaceEdges(positions: number[], v: Face["vertices"]) {
  if (v.length < 3) return;
  const a = v[0]!;
  const b = v[1]!;
  const c = v[2]!;
  const push = (p: typeof a, q: typeof b) => {
    positions.push(p.x, p.y, p.z, q.x, q.y, q.z);
  };
  push(a, b);
  push(b, c);
  push(c, a);
}

/** Wireframe edges of active (non-disabled) triangular faces. */
export function SolidOutline({
  rig,
  highlightFaceId,
  highlightFaceIds,
  coloredHighlights,
}: {
  rig: Rig;
  /** Hover / single-face accent. */
  highlightFaceId?: string | null;
  /** Single-color batch (ignored for fill when `coloredHighlights` is non-empty). */
  highlightFaceIds?: readonly string[] | null;
  /** Per-face outline colors (e.g. checked GPIO rows in wiring). */
  coloredHighlights?: ReadonlyMap<string, string> | null;
}) {
  const { baseGeometry, monoHighlightGeometry, colorLayers, hoverGeometry } = useMemo(() => {
    const disabled = new Set(rig.solid.disabledFaceIds);
    const facesById = new Map(rig.solid.faces.map((f) => [f.id, f]));

    const coloredKeys = new Set(coloredHighlights?.keys() ?? []);
    const hasColored = coloredKeys.size > 0;

    const monoIds = new Set<string>();
    if (!hasColored) {
      if (highlightFaceId) monoIds.add(highlightFaceId);
      for (const id of highlightFaceIds ?? []) monoIds.add(id);
    }

    const baseExclude = new Set<string>();
    if (hasColored) {
      for (const k of coloredKeys) baseExclude.add(k);
    } else {
      for (const id of monoIds) baseExclude.add(id);
    }
    if (highlightFaceId) baseExclude.add(highlightFaceId);

    const basePos: number[] = [];
    for (const face of rig.solid.faces) {
      if (disabled.has(face.id)) continue;
      if (baseExclude.has(face.id)) continue;
      pushFaceEdges(basePos, face.vertices);
    }

    const mk = (positions: number[]) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      return geo;
    };

    let monoHi: THREE.BufferGeometry | null = null;
    if (!hasColored && monoIds.size > 0) {
      const monoPos: number[] = [];
      for (const id of monoIds) {
        const f = facesById.get(id);
        if (!f || disabled.has(id)) continue;
        pushFaceEdges(monoPos, f.vertices);
      }
      monoHi = monoPos.length > 0 ? mk(monoPos) : null;
    }

    const colorLayersOut: { color: string; geometry: THREE.BufferGeometry }[] = [];
    if (hasColored && coloredHighlights) {
      const byColor = new Map<string, string[]>();
      for (const [fid, color] of coloredHighlights) {
        const f = facesById.get(fid);
        if (!f || disabled.has(fid)) continue;
        if (!byColor.has(color)) byColor.set(color, []);
        byColor.get(color)!.push(fid);
      }
      for (const [color, ids] of byColor) {
        const pos: number[] = [];
        for (const fid of ids) {
          const f = facesById.get(fid);
          if (!f) continue;
          pushFaceEdges(pos, f.vertices);
        }
        if (pos.length > 0) colorLayersOut.push({ color, geometry: mk(pos) });
      }
    }

    let hoverGeo: THREE.BufferGeometry | null = null;
    if (highlightFaceId) {
      const f = facesById.get(highlightFaceId);
      if (f && !disabled.has(highlightFaceId)) {
        const hp: number[] = [];
        pushFaceEdges(hp, f.vertices);
        hoverGeo = mk(hp);
      }
    }

    return {
      baseGeometry: mk(basePos),
      monoHighlightGeometry: monoHi,
      colorLayers: colorLayersOut,
      hoverGeometry: hoverGeo,
    };
  }, [rig, highlightFaceId, highlightFaceIds, coloredHighlights]);

  useEffect(
    () => () => {
      baseGeometry.dispose();
      monoHighlightGeometry?.dispose();
      hoverGeometry?.dispose();
      for (const { geometry } of colorLayers) geometry.dispose();
    },
    [baseGeometry, monoHighlightGeometry, hoverGeometry, colorLayers],
  );

  return (
    <group>
      <lineSegments geometry={baseGeometry} renderOrder={0}>
        <lineBasicMaterial color="#6b7280" transparent opacity={0.85} depthTest />
      </lineSegments>
      {monoHighlightGeometry && (
        <lineSegments geometry={monoHighlightGeometry} renderOrder={8}>
          <lineBasicMaterial
            color={MONO_HIGHLIGHT}
            transparent
            opacity={1}
            depthTest={false}
            depthWrite={false}
          />
        </lineSegments>
      )}
      {colorLayers.map(({ color, geometry }, i) => (
        <lineSegments key={`${color}-${i}`} geometry={geometry} renderOrder={8}>
          <lineBasicMaterial
            color={new THREE.Color(color)}
            transparent
            opacity={1}
            depthTest={false}
            depthWrite={false}
          />
        </lineSegments>
      ))}
      {hoverGeometry && (
        <lineSegments geometry={hoverGeometry} renderOrder={9}>
          <lineBasicMaterial
            color={HOVER_OUTLINE}
            transparent
            opacity={1}
            depthTest={false}
            depthWrite={false}
          />
        </lineSegments>
      )}
    </group>
  );
}
