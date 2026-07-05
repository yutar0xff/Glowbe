import { applyPresetDefaultLayout } from "@/chain-editor/apply-default-layout";
import { isImplementedSolidPreset } from "@/chain-editor/defaults/preset-layouts";
import { radiusForEdgeLength, type FaceLayout, type SolidPreset } from "@glowbe/core";
import type { EditorState } from "./editor-store-types";
import type { ApplyRig, EditorStoreGet, EditorStoreSet, RegenSolid } from "./editor-store-rig-core";

export function createEditorRigSlice(
  set: EditorStoreSet,
  get: EditorStoreGet,
  applyRig: ApplyRig,
  regenSolid: RegenSolid,
): Pick<
  EditorState,
  | "highlightedFaceId"
  | "setHighlightedFace"
  | "selectedFaceIds"
  | "selectFace"
  | "clearFaceSelection"
  | "setSolidPreset"
  | "setRadius"
  | "setEdgeLength"
  | "updateLayout"
> {
  return {
    highlightedFaceId: null,
    setHighlightedFace: (highlightedFaceId) => set({ highlightedFaceId }),

    selectedFaceIds: [],
    selectFace: (faceId, mode) => {
      if (mode === "replace") {
        set((s) => {
          if (s.selectedFaceIds.length === 1 && s.selectedFaceIds[0] === faceId) {
            return {};
          }
          return { selectedFaceIds: [faceId] };
        });
        return;
      }
      set((s) => {
        const cur = s.selectedFaceIds;
        const i = cur.indexOf(faceId);
        if (i >= 0) {
          return { selectedFaceIds: cur.filter((id) => id !== faceId) };
        }
        return { selectedFaceIds: [...cur, faceId] };
      });
    },

    clearFaceSelection: () =>
      set({
        selectedFaceIds: [],
        wiringAssignmentTarget: null,
        wiringWalkPinIndex: null,
        wiringFocusedPinIndex: null,
        wiringCheckedPinIndices: [],
      }),

    setSolidPreset: (preset: SolidPreset) => {
      const radius = get().rig.solid.radius;
      if (isImplementedSolidPreset(preset)) {
        const result = applyPresetDefaultLayout(preset, { keepRadiusMm: radius });
        if (result.ok) return;
      }
      regenSolid(preset, radius);
    },

    setRadius: (radiusMm) => {
      if (!(radiusMm > 0)) return;
      regenSolid(get().rig.solid.preset, radiusMm);
    },

    setEdgeLength: (edgeMm) => {
      if (!(edgeMm > 0)) return;
      const preset = get().rig.solid.preset;
      regenSolid(preset, radiusForEdgeLength(preset, edgeMm));
    },

    updateLayout: (patch: Partial<FaceLayout>) => {
      const current = get().rig;
      const layouts = current.faceLayouts.map((l, i) => (i === 0 ? { ...l, ...patch } : l));
      applyRig({ ...current, faceLayouts: layouts });
    },
  };
}
