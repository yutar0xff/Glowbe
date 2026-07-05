

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useEditorStore } from "@/chain-editor/stores/editor-store";
import { useEditorReadOnly } from "@/chain-editor/chain-profile-editor-context";
import { wiringFacePointerDown } from "@/chain-editor/wiring-face-pointer";
import { wiringRowColoredFaceMap } from "@/chain-editor/wiring-helpers";
import { SolidOutline } from "@/chain-editor/r3f/solid-outline";
import { StudioRigCanvas } from "@/chain-editor/r3f/studio-rig-canvas";
import { FacePickMeshes } from "@/chain-editor/r3f/face-pick-meshes";
import { WiringChainLines } from "@/chain-editor/r3f/wiring-chain-lines";
import { rigVertexNorm } from "@/chain-editor/r3f/rig-norm";
import { McuWiringTable } from "@/chain-editor/views/mcu-wiring-table";

/**
 * Device wiring: MCU pin table + interactive 3D rig (chains + outlines; no LED cloud).
 */
export function Wiring3dView() {
  const readOnly = useEditorReadOnly();
  const camQuatRef = useRef(new THREE.Quaternion());
  const rig = useEditorStore((s) => s.rig);
  const layoutRevision = useEditorStore((s) => s.layoutRevision);
  const showOutline = useEditorStore((s) => s.showSolidOutline);
  const highlightedFaceId = useEditorStore((s) => s.highlightedFaceId);
  const setHighlightedFace = useEditorStore((s) => s.setHighlightedFace);
  const clearFaceSelection = useEditorStore((s) => s.clearFaceSelection);
  const wirePinChains = useEditorStore((s) => s.wirePinChains);

  const wiringFocusedPinIndex = useEditorStore((s) => s.wiringFocusedPinIndex);
  const wiringCheckedPinIndices = useEditorStore((s) => s.wiringCheckedPinIndices);
  const chainPreview = wirePinChains;

  const coloredOutlineFaces = useMemo(
    () => wiringRowColoredFaceMap(wiringCheckedPinIndices, chainPreview),
    [wiringCheckedPinIndices, chainPreview],
  );

  const norm = useMemo(() => rigVertexNorm(rig), [rig]);
  const pickFaces = useMemo(
    () => rig.solid.faces.filter((f) => !rig.solid.disabledFaceIds.includes(f.id)),
    [rig],
  );

  return (
    <div className="flex h-full min-h-0 w-full bg-background">
      <div className="flex w-[min(520px,46vw)] shrink-0 flex-col border-r border-border min-h-0">
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <McuWiringTable />
        </div>
      </div>
      <div
        tabIndex={0}
        className="flex min-h-0 min-w-0 flex-1 flex-col outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onKeyDown={(e) => {
          if (e.key === "Escape") clearFaceSelection();
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="relative min-h-0 flex-1">
          <StudioRigCanvas
            camQuatRef={camQuatRef}
            className="absolute inset-0 h-full w-full"
            onPointerMissed={(e) => {
              const btn = (e as { button?: number }).button;
              if (btn != null && btn !== 0) return;
              useEditorStore.getState().clearFaceSelection();
            }}
          >
            <group scale={[1 / norm, 1 / norm, 1 / norm]}>
              {showOutline && (
                <SolidOutline
                  key={layoutRevision}
                  rig={rig}
                  highlightFaceId={highlightedFaceId}
                  coloredHighlights={coloredOutlineFaces ?? undefined}
                />
              )}
              <WiringChainLines
                rig={rig}
                wirePinChains={chainPreview}
                hideBackface={false}
                focusedPinRow={wiringFocusedPinIndex}
                checkedPinRows={wiringCheckedPinIndices}
              />
              <FacePickMeshes
                faces={pickFaces}
                pickEnabled={!readOnly}
                onFacePointerDown={wiringFacePointerDown}
                onFacePointerOver={(id) => setHighlightedFace(id)}
                onFacePointerOut={() => setHighlightedFace(null)}
              />
            </group>
          </StudioRigCanvas>
        </div>
      </div>
    </div>
  );
}
