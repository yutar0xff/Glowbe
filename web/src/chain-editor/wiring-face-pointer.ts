import type { ThreeEvent } from "@react-three/fiber";
import { useEditorStore } from "@/chain-editor/stores/editor-store";

/**
 * Face clicks in 3D wiring: optional table cell assignment, Ctrl/Cmd multi-select,
 * optional walk mode (append face to active pin row), otherwise replace selection.
 * Clicking empty canvas clears selection and row checks (see Canvas onPointerMissed).
 */
export function wiringFacePointerDown(faceId: string, e: ThreeEvent<PointerEvent>) {
  const ne = e.nativeEvent;
  const state = useEditorStore.getState();
  const target = state.wiringAssignmentTarget;
  if (target) {
    ne.preventDefault();
    state.assignWiringCellFace(target.pinIndex, target.colIndex, faceId);
    return;
  }
  const additive = ne.ctrlKey || ne.metaKey;
  if (additive) {
    ne.preventDefault();
    useEditorStore.getState().selectFace(faceId, "toggle");
    return;
  }
  const walkPin = state.wiringWalkPinIndex;
  if (walkPin != null) {
    ne.preventDefault();
    state.appendWalkPinFace(faceId);
    return;
  }
  useEditorStore.getState().selectFace(faceId, "replace");
}
