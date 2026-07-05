

import { useEffect, useMemo } from "react";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import type { Face, LedPattern, LedPlacement, Rig } from "@glowbe/core";

function faceEdgeGeometry(face: Face): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const v = face.vertices;
  if (v.length < 3) return g;
  const a = v[0]!;
  const b = v[1]!;
  const c = v[2]!;
  const pos = new Float32Array([
    a.x, a.y, a.z, b.x, b.y, b.z, b.x, b.y, b.z, c.x, c.y, c.z, c.x, c.y, c.z, a.x, a.y, a.z,
  ]);
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return g;
}

function LedStripPoints({
  positions,
  count,
  color,
}: {
  positions: Float32Array;
  count: number;
  color: string;
}) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions.slice(0, count * 3), 3));
    return g;
  }, [positions, count]);

  useEffect(
    () => () => {
      geo.dispose();
    },
    [geo],
  );

  return (
    <points geometry={geo}>
      <pointsMaterial
        color={new THREE.Color(color)}
        size={0.045}
        sizeAttenuation
        transparent
        opacity={0.92}
        depthWrite={false}
      />
    </points>
  );
}

function stripPathLineColor(pattern: LedPattern | undefined): string {
  if (pattern === "parallel-rows") return "#7dd3fc";
  if (pattern === "triangular-rows") return "#c4b5fd";
  return "#f9a8d4";
}

/**
 * One face: panel wireframe + **Din→Dout polyline** (resolved `chainIndex` order = physical strip,
 * so zigzag / parallel turns appear as the real 3D path) + LED points.
 */
export function AttachmentFaceStrip3d({
  rig,
  faceId,
  channel,
  leds,
  stripPattern,
  lineColor,
  stripRenderKey,
}: {
  rig: Rig;
  faceId: string | null;
  channel: number;
  leds: readonly LedPlacement[];
  /** In-face layout pattern — default line color when `lineColor` omitted. */
  stripPattern?: LedPattern;
  /** Override polyline / points tint (multi-face preview). */
  lineColor?: string;
  /** Force Line remount when orientation / resolve changes (drei Line caches geometry). */
  stripRenderKey: string;
}) {
  const face = useMemo(
    () => (faceId ? rig.solid.faces.find((f) => f.id === faceId) : undefined),
    [rig, faceId],
  );

  const strip = useMemo(() => {
    if (!faceId) return null;
    const list = leds
      .filter((l) => l.faceId === faceId && l.address.channel === channel)
      .sort((a, b) => {
        const d = a.address.chainIndex - b.address.chainIndex;
        if (d !== 0) return d;
        return a.globalIndex - b.globalIndex;
      });
    if (list.length === 0) return null;
    const positions = new Float32Array(list.length * 3);
    const pathPoints = list.map(
      (l) => new THREE.Vector3(l.position.x, l.position.y, l.position.z),
    );
    list.forEach((l, i) => {
      positions[i * 3] = l.position.x;
      positions[i * 3 + 1] = l.position.y;
      positions[i * 3 + 2] = l.position.z;
    });
    return { positions, count: list.length, pathPoints };
  }, [faceId, channel, leds]);

  const edgeGeo = useMemo(() => {
    if (!face) return null;
    return faceEdgeGeometry(face);
  }, [face]);

  const pathColor = lineColor ?? stripPathLineColor(stripPattern);
  const lineColorHex = useMemo(() => new THREE.Color(pathColor).getHex(), [pathColor]);

  useEffect(
    () => () => {
      edgeGeo?.dispose();
    },
    [edgeGeo],
  );

  if (!faceId || !face || !strip || strip.count === 0) {
    return null;
  }

  const { positions, count, pathPoints } = strip;

  return (
    <group>
      {edgeGeo && (
        <lineSegments geometry={edgeGeo}>
          <lineBasicMaterial color="#94a3b8" transparent opacity={0.9} />
        </lineSegments>
      )}
      {pathPoints.length >= 2 && (
        <Line
          key={stripRenderKey}
          points={pathPoints}
          color={lineColorHex}
          lineWidth={2.75}
          depthTest={false}
          depthWrite={false}
          transparent
          opacity={1}
          renderOrder={6}
        />
      )}
      <LedStripPoints positions={positions} count={count} color={pathColor} />
    </group>
  );
}
