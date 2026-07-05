import type { Rig, SolidPreset } from "@glowbe/core";
import { getPlayback } from "@/chain-editor/playback";
import { resolveRigSafe } from "./editor-wiring-rig";
import { computeRegenSolid } from "./editor-regen-solid";
import type { EditorState } from "./editor-store-types";

export type EditorStoreSet = (
  partial: Partial<EditorState> | ((state: EditorState) => Partial<EditorState>),
) => void;

export type EditorStoreGet = () => EditorState;

export type ApplyRig = (rig: Rig, extra?: Partial<EditorState>) => void;

export type RegenSolid = (preset: SolidPreset, radius: number) => void;

export function createEditorRigCore(set: EditorStoreSet, get: EditorStoreGet): {
  applyRig: ApplyRig;
  regenSolid: RegenSolid;
} {
  const applyRig: ApplyRig = (rig, extra = {}) => {
    const { leds, error } = resolveRigSafe(rig);
    const pb = getPlayback();
    pb.clearOverrides();
    pb.setLeds(leds);
    set((s) => ({
      rig,
      leds,
      error,
      hasOverrides: false,
      layoutRevision: s.layoutRevision + 1,
      ...extra,
    }));
  };

  const regenSolid: RegenSolid = (preset, radius) => {
    const s = get();
    const { rig, patch } = computeRegenSolid(
      {
        rig: s.rig,
        wirePinChains: s.wirePinChains,
        wirePinGpio: s.wirePinGpio,
        wireReversed: s.wireReversed,
        selectedFaceIds: s.selectedFaceIds,
        wireFaceRotations: s.wireFaceRotations,
        wiringCheckedPinIndices: s.wiringCheckedPinIndices,
        wiringFocusedPinIndex: s.wiringFocusedPinIndex,
        attachmentPreviewCell: s.attachmentPreviewCell,
      },
      preset,
      radius,
    );
    applyRig(rig, patch);
  };

  return { applyRig, regenSolid };
}
