

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { LedPlacement } from "@glowbe/core";
import { getPlayback } from "../playback";

export function LedInstancedCloud({
  leds,
  norm,
  hideBackface,
  pointScale,
}: {
  leds: LedPlacement[];
  norm: number;
  hideBackface: boolean;
  pointScale: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const color = useMemo(() => new THREE.Color(), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const toCam = useMemo(() => new THREE.Vector3(), []);
  const ledPos = useMemo(() => new THREE.Vector3(), []);
  const geometry = useMemo(() => new THREE.SphereGeometry(1, 12, 12), []);
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ toneMapped: false }),
    [],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const cam = state.camera.position;
    const pb = getPlayback();
    const buf = pb.ledColors;

    for (let i = 0; i < leds.length; i++) {
      const l = leds[i]!;
      const x = l.position.x / norm;
      const y = l.position.y / norm;
      const z = l.position.z / norm;
      let sc = pointScale;
      if (hideBackface) {
        ledPos.set(x, y, z);
        toCam.subVectors(cam, ledPos);
        const len = toCam.length();
        if (len > 1e-6) toCam.multiplyScalar(1 / len);
        const nd =
          l.normal.x * toCam.x + l.normal.y * toCam.y + l.normal.z * toCam.z;
        if (nd <= 0.02) sc = 0;
      }
      dummy.position.set(x, y, z);
      dummy.scale.setScalar(sc);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      const o = l.globalIndex * 3;
      color.setRGB(
        (buf[o] ?? 0) / 255,
        (buf[o + 1] ?? 0) / 255,
        (buf[o + 2] ?? 0) / 255,
        THREE.SRGBColorSpace,
      );
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[geometry, material, leds.length]} frustumCulled={false} />
  );
}
