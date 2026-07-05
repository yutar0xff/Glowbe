

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Face } from "@glowbe/core";
import type { ThreeEvent } from "@react-three/fiber";

function FacePickMesh({
  face,
  pickEnabled = true,
  onPointerDown,
  onPointerOver,
  onPointerOut,
}: {
  face: Face;
  pickEnabled?: boolean;
  onPointerDown: (faceId: string, e: ThreeEvent<PointerEvent>) => void;
  onPointerOver?: (faceId: string) => void;
  onPointerOut?: () => void;
}) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const v = face.vertices;
    if (v.length < 3) return g;
    const a = v[0]!;
    const b = v[1]!;
    const c = v[2]!;
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z],
        3,
      ),
    );
    g.setIndex([0, 1, 2]);
    return g;
  }, [face]);

  useEffect(
    () => () => {
      geometry.dispose();
    },
    [geometry],
  );

  return (
    <mesh
      geometry={geometry}
      frustumCulled={false}
      userData={{ glowbeFacePick: true }}
      onPointerDown={(e) => {
        if (!pickEnabled) return;
        e.stopPropagation();
        onPointerDown(face.id, e);
      }}
      onPointerOver={(e) => {
        if (!pickEnabled) return;
        e.stopPropagation();
        onPointerOver?.(face.id);
      }}
      onPointerOut={(e) => {
        if (!pickEnabled) return;
        e.stopPropagation();
        onPointerOut?.();
      }}
    >
      <meshBasicMaterial
        transparent
        opacity={0.001}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

/** Invisible pick targets (double-sided) over each active face. Parent should scale by 1/norm. */
export function FacePickMeshes({
  faces,
  pickEnabled = true,
  onFacePointerDown,
  onFacePointerOver,
  onFacePointerOut,
}: {
  faces: Face[];
  pickEnabled?: boolean;
  onFacePointerDown: (faceId: string, e: ThreeEvent<PointerEvent>) => void;
  onFacePointerOver?: (faceId: string) => void;
  onFacePointerOut?: () => void;
}) {
  return (
    <group>
      {faces.map((face) => (
        <FacePickMesh
          key={face.id}
          face={face}
          pickEnabled={pickEnabled}
          onPointerDown={onFacePointerDown}
          onPointerOver={onFacePointerOver}
          onPointerOut={onFacePointerOut}
        />
      ))}
    </group>
  );
}
