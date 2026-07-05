import {
  getPresetDefaultLayoutFile,
  isImplementedSolidPreset,
  type ImplementedSolidPreset,
} from "@/chain-editor/defaults/preset-layouts";
import { useEditorStore } from "@/chain-editor/stores/editor-store";
import type { ImportLayoutResult } from "@/chain-editor/stores/editor-store-layout-slice";

let startupApplied = false;

export type ApplyPresetLayoutOptions = {
  /** Keep current sphere radius (mm) instead of the JSON file value. */
  keepRadiusMm?: number;
};

/** Load bundled default layout for a solid preset. */
export function applyPresetDefaultLayout(
  preset: ImplementedSolidPreset,
  opts?: ApplyPresetLayoutOptions,
): ImportLayoutResult {
  const file = getPresetDefaultLayoutFile(preset);
  let payload: unknown = file;
  if (opts?.keepRadiusMm != null && opts.keepRadiusMm > 0) {
    payload = {
      ...file,
      rig: {
        ...file.rig,
        solid: { ...file.rig.solid, radius: opts.keepRadiusMm },
      },
    };
  }
  return useEditorStore.getState().importLayoutJson(payload);
}

/** Apply default layout for the current solid preset once on startup. */
export function applyDefaultLayoutOnce(): void {
  if (startupApplied || typeof window === "undefined") return;
  startupApplied = true;

  const preset = useEditorStore.getState().rig.solid.preset;
  if (!isImplementedSolidPreset(preset)) return;

  const result = applyPresetDefaultLayout(preset);
  if (!result.ok) {
    useEditorStore.setState({ error: `Default layout (${preset}): ${result.message}` });
  }
}
