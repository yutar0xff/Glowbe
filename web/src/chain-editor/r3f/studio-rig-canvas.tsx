

import { Canvas } from "@react-three/fiber";
import { TrackballControls } from "@react-three/drei";
import { useMemo, type ComponentProps, type MutableRefObject, type ReactNode } from "react";
import * as THREE from "three";
import {
  MainCameraQuaternionSync,
  OrientationGizmoMiniCanvas,
} from "./gizmo-viewport";

/** Default clear color for rig / solid previews (most views). */
export const STUDIO_RIG_PREVIEW_BG = "#08080a";

export type StudioRigCamera = {
  position: [number, number, number];
  fov: number;
};

const DEFAULT_CAMERA: StudioRigCamera = {
  position: [0, 0, 3],
  fov: 50,
};

type CanvasPointerMissed = NonNullable<ComponentProps<typeof Canvas>["onPointerMissed"]>;

export type StudioRigCanvasProps = {
  camQuatRef: MutableRefObject<THREE.Quaternion>;
  /** Merged onto defaults (`[0,0,3]`, fov 50). */
  camera?: Partial<StudioRigCamera>;
  className?: string;
  /** Scene background; default `STUDIO_RIG_PREVIEW_BG`. */
  background?: string;
  showAxes?: boolean;
  trackballMinDistance?: number;
  trackballMaxDistance?: number;
  onPointerMissed?: CanvasPointerMissed;
  children: ReactNode;
};

/**
 * Shared R3F shell: Canvas, camera quaternion sync, background, optional world
 * axes, trackball, and top-right orientation gizmo.
 */
export function StudioRigCanvas({
  camQuatRef,
  camera: cameraPartial,
  className = "h-full w-full",
  background = STUDIO_RIG_PREVIEW_BG,
  showAxes = false,
  trackballMinDistance = 1.4,
  trackballMaxDistance = 8,
  onPointerMissed,
  children,
}: StudioRigCanvasProps) {
  const camera = { ...DEFAULT_CAMERA, ...cameraPartial };
  const axesObject = useMemo(() => new THREE.AxesHelper(1.25), []);

  return (
    <>
      <Canvas
        className={className}
        camera={{ position: camera.position, fov: camera.fov }}
        onPointerMissed={onPointerMissed}
      >
        <MainCameraQuaternionSync target={camQuatRef} />
        <color attach="background" args={[background]} />
        {showAxes ? <primitive object={axesObject} /> : null}
        {children}
        <TrackballControls
          noPan
          rotateSpeed={3}
          zoomSpeed={1.2}
          minDistance={trackballMinDistance}
          maxDistance={trackballMaxDistance}
        />
      </Canvas>
      <div className="pointer-events-none absolute right-2 top-2 z-10 h-[72px] w-[72px]">
        <OrientationGizmoMiniCanvas quaternionRef={camQuatRef} />
      </div>
    </>
  );
}
