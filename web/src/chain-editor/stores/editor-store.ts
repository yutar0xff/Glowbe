import { create } from "zustand";
import { DEFAULT_COLOR_SETTINGS, type LedPattern, type SolidPreset } from "@glowbe/core";
import { getPlayback } from "@/chain-editor/playback";
import { initialEditorLeds, initialEditorRig } from "./editor-wiring-rig";
import { createEditorPlaybackSlice } from "./editor-store-playback-slice";
import { createEditorRigCore } from "./editor-store-rig-core";
import { createEditorRigSlice } from "./editor-store-rig-slice";
import { createEditorLayoutSlice } from "./editor-store-layout-slice";
import { createEditorWiringSlice } from "./editor-store-wiring-slice";
import type { EditorState } from "./editor-store-types";

export type { EditorState, SourceMeta } from "./editor-store-types";
export type { LedPattern, SolidPreset };

/** Zustand editor composed from rig / wiring / playback slices. */
export const useEditorStore = create<EditorState>((set, get) => {
  const { applyRig, regenSolid } = createEditorRigCore(set, get);

  return {
    rig: initialEditorRig,
    leds: initialEditorLeds,
    layoutRevision: 0,
    error: null,

    ...createEditorPlaybackSlice(set, get),
    ...createEditorRigSlice(set, get, applyRig, regenSolid),
    ...createEditorWiringSlice(set, get, applyRig),
    ...createEditorLayoutSlice(set, get, applyRig),
  };
});

if (typeof window !== "undefined") {
  const pb = getPlayback();
  pb.setColorSettings(DEFAULT_COLOR_SETTINGS);
  pb.setLeds(initialEditorLeds);
  pb.setPlaybackSmoothing(useEditorStore.getState().playbackSmoothing);
}
