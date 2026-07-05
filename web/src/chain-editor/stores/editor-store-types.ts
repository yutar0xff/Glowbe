/** Placeholder — chain profile editor does not use Dockview. */
export type DockviewApi = null;
import type {
  ColorSettings,
  FaceLayout,
  LedPlacement,
  Rig,
  SolidPreset,
} from "@glowbe/core";
import type { FrameSource } from "@/chain-editor/frame-source";

export interface SourceMeta {
  kind: FrameSource["kind"];
  name: string;
  frameCount: number;
  isVideo: boolean;
  fps: number;
}

export interface EditorState {
  rig: Rig;
  leds: LedPlacement[];
  layoutRevision: number;

  source: SourceMeta | null;
  isPlaying: boolean;
  time: number;
  duration: number;

  dockApi: DockviewApi | null;
  error: string | null;

  /** 3D preview chrome (sphere + LED views). */
  showViewerAxes: boolean;
  showSolidOutline: boolean;
  /** Authoring: discrete LED preview culls normals away from camera. */
  hideBackfaceDiscrete: boolean;
  /** Device workspace: rig preview culling (independent from authoring). */
  hideBackfaceDeviceRig: boolean;
  /** Instanced LED preview: approximate physical dot diameter (mm) on the sphere. */
  ledPreviewDiameterMm: number;
  /** Bilinear UV + image-sequence crossfade (same path as device `ledColors`). */
  playbackSmoothing: boolean;
  setShowViewerAxes: (v: boolean) => void;
  setShowSolidOutline: (v: boolean) => void;
  setHideBackfaceDiscrete: (v: boolean) => void;
  setHideBackfaceDeviceRig: (v: boolean) => void;
  setLedPreviewDiameterMm: (mm: number) => void;
  setPlaybackSmoothing: (v: boolean) => void;

  /** Wiring / rig 3D hover → outline highlight (null = none). */
  highlightedFaceId: string | null;
  setHighlightedFace: (id: string | null) => void;

  /** Color management (preview). Brightness maps to device FRAME only. */
  color: ColorSettings;
  hasOverrides: boolean;
  /** Active paint color for the LED editing view, as [r,g,b] 0..255. */
  paintColor: [number, number, number];
  setColor: (patch: Partial<ColorSettings>) => void;
  setPaintColor: (rgb: [number, number, number]) => void;
  paintLed: (globalIndex: number, rgb: [number, number, number] | null) => void;
  clearOverrides: () => void;

  setDockApi: (api: DockviewApi | null) => void;
  loadFiles: (files: FileList | File[]) => Promise<void>;
  togglePlay: () => void;
  seek: (time: number) => void;
  setFps: (fps: number) => void;
  tick: (time: number) => void;

  /**
   * Faces selected in Face Layout / Wiring (order = pick order; last = primary
   * for chain / MCU actions). In 3D views use Ctrl/Cmd+click to add/remove faces.
   */
  selectedFaceIds: string[];
  /** Replace selection with one face, or toggle membership (additive). */
  selectFace: (faceId: string, mode: "replace" | "toggle") => void;
  clearFaceSelection: () => void;

  setSolidPreset: (preset: SolidPreset) => void;
  setRadius: (radiusMm: number) => void;
  setEdgeLength: (edgeMm: number) => void;
  updateLayout: (patch: Partial<FaceLayout>) => void;

  /** Per-pin Din→Dout face chains (each row = one GPIO / parallel line). */
  wirePinChains: string[][];
  /** GPIO number per row (same length as `wirePinChains`). */
  wirePinGpio: number[];
  wireReversed: string[];
  wireConfigured: boolean;
  /** Per-face 120° in-plane rotation steps (see `FaceConnection.rotation` in @glowbe/core). */
  wireFaceRotations: Record<string, number>;
  setWireFaceRotation: (faceId: string, rotation: 0 | 1 | 2) => void;
  /** Advance corner rotation 0° → 120° → 240° → 0° for one face. */
  cycleWireFaceRotation: (faceId: string) => void;
  /** Table cell waiting for a face pick on the 3D view (pin row, hop column). */
  wiringAssignmentTarget: { pinIndex: number; colIndex: number } | null;
  setWiringAssignmentTarget: (t: { pinIndex: number; colIndex: number } | null) => void;
  /**
   * Plain 3D face clicks append to this pin row (Din→Dout). Mutually exclusive with
   * `wiringAssignmentTarget`. Ctrl/⌘+click still toggles selection.
   */
  wiringWalkPinIndex: number | null;
  setWiringWalkPin: (pinIndex: number | null) => void;
  appendWalkPinFace: (faceId: string) => void;
  /** Highlights one GPIO row’s chain in 3D (strip arrows when no row checks). */
  wiringFocusedPinIndex: number | null;
  setWiringFocusedPin: (pinIndex: number | null) => void;
  setWirePinRowCount: (n: number) => void;
  /** GPIO rows checked in the MCU table (sorted); drives row tint + 3D chain colors. */
  wiringCheckedPinIndices: number[];
  /** Toggle row check + set wiring focus to this row (table row or checkbox). */
  wiringTableRowClick: (pinIndex: number) => void;
  assignWiringCellFace: (pinIndex: number, colIndex: number, faceId: string) => void;
  removeWireChainCellAndCompact: (pinIndex: number, colIndex: number) => void;
  appendWirePinColumn: () => void;
  /** Append a new empty GPIO row and start Walk on it. */
  appendWirePinRow: () => void;
  /** Remove all GPIO rows that are checked in the MCU table. */
  removeWiringCheckedRows: () => void;
  /** Move one GPIO row to a new index (chains + pins + checks + focus). */
  moveWirePinRow: (fromIndex: number, toIndex: number) => void;
  setWirePinGpioRow: (row: number, pinNumber: number) => void;
  toggleFaceReversed: (faceId: string) => void;
  resetWiring: () => void;

  /** Face Attachment: which table cell syncs with 3D pick (null = none). */
  attachmentPreviewCell: { ri: number; ci: number } | null;
  setAttachmentPreviewCell: (c: { ri: number; ci: number } | null) => void;

  /** Export rig + wiring as `glowbe-layout.json` text. */
  exportLayoutJson: () => string;
  /** Load a saved layout file; replaces rig, face layouts, solid, and wiring. */
  importLayoutJson: (input: unknown) => { ok: true } | { ok: false; message: string };
}
