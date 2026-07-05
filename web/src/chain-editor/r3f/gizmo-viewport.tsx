

import { Canvas, useFrame } from "@react-three/fiber";
import type { MutableRefObject } from "react";
import { useMemo, useRef } from "react";
import * as THREE from "three";

const AXIS_LEN = 0.55;
const HALF = AXIS_LEN * 0.5;

/** Cylinder along +Y; rotate so +Y aligns with unit direction `dir`. */
const axisMesh = (dir: THREE.Vector3, color: number) => {
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.clone().normalize(),
  );
  const p = dir.clone().normalize().multiplyScalar(HALF);
  return { q, p, color };
};

const X = axisMesh(new THREE.Vector3(1, 0, 0), 0xff3355);
const Y = axisMesh(new THREE.Vector3(0, 1, 0), 0x33ff66);
const Z = axisMesh(new THREE.Vector3(0, 0, 1), 0x3388ff);

/** Runs inside the main Canvas; copies the default camera orientation each frame. */
export function MainCameraQuaternionSync({
  target,
}: {
  target: MutableRefObject<THREE.Quaternion>;
}) {
  useFrame(({ camera }) => {
    target.current.copy(camera.quaternion);
  });
  return null;
}

function MiniAxes({ quaternionRef }: { quaternionRef: MutableRefObject<THREE.Quaternion> }) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const g = groupRef.current;
    if (g) g.quaternion.copy(quaternionRef.current).invert();
  });

  const bar = (spec: typeof X) => (
    <mesh quaternion={spec.q} position={spec.p}>
      <cylinderGeometry args={[0.04, 0.04, AXIS_LEN, 8]} />
      <meshBasicMaterial color={spec.color} toneMapped={false} />
    </mesh>
  );

  return (
    <group ref={groupRef}>
      <ambientLight intensity={1} />
      {bar(X)}
      {bar(Y)}
      {bar(Z)}
    </group>
  );
}

/**
 * Small secondary WebGL canvas (overlay). Does not call `gl.render()` on the
 * main canvas — that breaks R3F and can blank the main scene.
 */
export function OrientationGizmoMiniCanvas({
  quaternionRef,
}: {
  quaternionRef: MutableRefObject<THREE.Quaternion>;
}) {
  const bg = useMemo(() => new THREE.Color(0x0c0c10), []);

  return (
    <Canvas
      orthographic
      camera={{ position: [0, 0, 3], zoom: 70 }}
      gl={{ alpha: false, antialias: true }}
      style={{ width: "100%", height: "100%", touchAction: "none" }}
      onCreated={({ scene }) => {
        scene.background = bg;
      }}
    >
      <MiniAxes quaternionRef={quaternionRef} />
    </Canvas>
  );
}
