import {
  buildStudioLayoutFile,
  parseStudioLayoutFile,
  type StudioEditorSnapshot,
  type StudioWiringSnapshot,
} from "@glowbe/core";
import { getPlayback } from "@/chain-editor/playback";
import { applyWiringToRig } from "./editor-wiring-rig";
import type { EditorState } from "./editor-store-types";
import type { ApplyRig, EditorStoreGet, EditorStoreSet } from "./editor-store-rig-core";

export type ImportLayoutResult = { ok: true } | { ok: false; message: string };

export function createEditorLayoutSlice(
  _set: EditorStoreSet,
  get: EditorStoreGet,
  applyRig: ApplyRig,
): Pick<EditorState, "exportLayoutJson" | "importLayoutJson"> {
  return {
    exportLayoutJson: () => {
      const s = get();
      const pb = getPlayback();
      const wiring: StudioWiringSnapshot = {
        wirePinChains: s.wirePinChains,
        wirePinGpio: s.wirePinGpio,
        wireConfigured: s.wireConfigured,
        wireReversed: s.wireReversed,
        wireFaceRotations: s.wireFaceRotations,
        wiringCheckedPinIndices: s.wiringCheckedPinIndices,
      };
      const editor: StudioEditorSnapshot = {
        ledPreviewDiameterMm: s.ledPreviewDiameterMm,
        showViewerAxes: s.showViewerAxes,
        showSolidOutline: s.showSolidOutline,
        hideBackfaceDiscrete: s.hideBackfaceDiscrete,
        hideBackfaceDeviceRig: s.hideBackfaceDeviceRig,
        playbackSmoothing: s.playbackSmoothing,
        color: s.color,
        paintColor: s.paintColor,
        ledOverrides: pb.listOverrides(),
      };
      const file = buildStudioLayoutFile({ rig: s.rig, wiring, editor });
      return JSON.stringify(file, null, 2);
    },

    importLayoutJson: (input: unknown): ImportLayoutResult => {
      const parsed = parseStudioLayoutFile(input);
      if (!parsed.ok) return parsed;

      const { layout, wiring, editor } = parsed;
      const rigWithWiring = applyWiringToRig(
        layout.rig,
        wiring.wirePinChains,
        wiring.wirePinGpio,
        wiring.wireReversed,
        wiring.wireFaceRotations,
        wiring.wireConfigured,
      );
      const pb = getPlayback();
      const s = get();
      /** First layout load uses file color; later imports keep the session brightness value. */
      const mergedColor =
        s.layoutRevision > 0 ? { ...editor.color, brightness: s.color.brightness } : editor.color;
      pb.setColorSettings(mergedColor);
      pb.applyOverrides(editor.ledOverrides);
      pb.setPlaybackSmoothing(editor.playbackSmoothing);

      applyRig(rigWithWiring, {
        wirePinChains: wiring.wirePinChains.map((row) => [...row]),
        wirePinGpio: [...wiring.wirePinGpio],
        wireConfigured: wiring.wireConfigured,
        wireReversed: [...wiring.wireReversed],
        wireFaceRotations: { ...wiring.wireFaceRotations },
        wiringCheckedPinIndices: [...wiring.wiringCheckedPinIndices],
        ledPreviewDiameterMm: editor.ledPreviewDiameterMm,
        showViewerAxes: editor.showViewerAxes,
        showSolidOutline: editor.showSolidOutline,
        hideBackfaceDiscrete: editor.hideBackfaceDiscrete,
        hideBackfaceDeviceRig: editor.hideBackfaceDeviceRig,
        playbackSmoothing: editor.playbackSmoothing,
        color: mergedColor,
        paintColor: editor.paintColor,
        hasOverrides: pb.hasOverrides(),
        selectedFaceIds: [],
        wiringAssignmentTarget: null,
        wiringWalkPinIndex: null,
        wiringFocusedPinIndex: null,
        attachmentPreviewCell: null,
        error: null,
      });
      return { ok: true };
    },
  };
}
