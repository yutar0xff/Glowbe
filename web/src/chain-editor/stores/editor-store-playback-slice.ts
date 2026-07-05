import { DEFAULT_COLOR_SETTINGS } from "@glowbe/core";
import { createFrameSourceFromFiles } from "@/chain-editor/frame-source";
import { getPlayback } from "@/chain-editor/playback";
import type { EditorState } from "./editor-store-types";
import type { EditorStoreGet, EditorStoreSet } from "./editor-store-rig-core";

export function createEditorPlaybackSlice(
  set: EditorStoreSet,
  get: EditorStoreGet,
): Pick<
  EditorState,
  | "source"
  | "isPlaying"
  | "time"
  | "duration"
  | "dockApi"
  | "showViewerAxes"
  | "showSolidOutline"
  | "hideBackfaceDiscrete"
  | "hideBackfaceDeviceRig"
  | "ledPreviewDiameterMm"
  | "playbackSmoothing"
  | "color"
  | "hasOverrides"
  | "paintColor"
  | "setShowViewerAxes"
  | "setShowSolidOutline"
  | "setHideBackfaceDiscrete"
  | "setHideBackfaceDeviceRig"
  | "setLedPreviewDiameterMm"
  | "setPlaybackSmoothing"
  | "setColor"
  | "setPaintColor"
  | "paintLed"
  | "clearOverrides"
  | "setDockApi"
  | "loadFiles"
  | "togglePlay"
  | "seek"
  | "setFps"
  | "tick"
> {
  return {
    source: null,
    isPlaying: false,
    time: 0,
    duration: 0,
    dockApi: null,

    showViewerAxes: true,
    showSolidOutline: true,
    hideBackfaceDiscrete: true,
    hideBackfaceDeviceRig: true,
    ledPreviewDiameterMm: 3,
    playbackSmoothing: true,

    setShowViewerAxes: (showViewerAxes) => set({ showViewerAxes }),
    setShowSolidOutline: (showSolidOutline) => set({ showSolidOutline }),
    setHideBackfaceDiscrete: (hideBackfaceDiscrete) => set({ hideBackfaceDiscrete }),
    setHideBackfaceDeviceRig: (hideBackfaceDeviceRig) => set({ hideBackfaceDeviceRig }),
    setLedPreviewDiameterMm: (ledPreviewDiameterMm) =>
      set({ ledPreviewDiameterMm: Math.max(0.5, Math.min(40, ledPreviewDiameterMm)) }),

    setPlaybackSmoothing: (playbackSmoothing) => {
      getPlayback().setPlaybackSmoothing(playbackSmoothing);
      set({ playbackSmoothing });
    },

    color: DEFAULT_COLOR_SETTINGS,
    hasOverrides: false,
    paintColor: [255, 80, 0],

    setColor: (patch) => {
      const color = { ...get().color, ...patch };
      getPlayback().setColorSettings(color);
      set({ color });
    },

    setPaintColor: (paintColor) => set({ paintColor }),

    paintLed: (globalIndex, rgb) => {
      const pb = getPlayback();
      pb.setOverride(globalIndex, rgb);
      pb.computeLedColors();
      set({ hasOverrides: pb.hasOverrides() });
    },

    clearOverrides: () => {
      const pb = getPlayback();
      pb.clearOverrides();
      pb.computeLedColors();
      set({ hasOverrides: false });
    },

    setDockApi: (dockApi) => set({ dockApi }),

    loadFiles: async (files) => {
      const source = await createFrameSourceFromFiles(files);
      const pb = getPlayback();
      await pb.setSource(source);
      pb.setPlaying(false);
      set({
        source: {
          kind: source.kind,
          name: source.kind === "none" ? "" : source.name,
          frameCount: pb.frameCount,
          isVideo: pb.isVideo,
          fps: pb.fps,
        },
        duration: pb.duration,
        time: 0,
        isPlaying: false,
      });
    },

    togglePlay: () =>
      set((s) => {
        const isPlaying = !s.isPlaying;
        getPlayback().setPlaying(isPlaying);
        return { isPlaying };
      }),

    seek: (time) => {
      getPlayback().seek(time);
      set({ time });
    },

    setFps: (fps) => {
      const pb = getPlayback();
      pb.setFps(fps);
      set((s) => ({
        duration: pb.duration,
        source: s.source ? { ...s.source, fps, frameCount: pb.frameCount } : null,
      }));
    },

    tick: (time) => set({ time }),
  };
}
