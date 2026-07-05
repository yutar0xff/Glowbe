import { z } from "zod";
import { ColorSettingsSchema, DEFAULT_COLOR_SETTINGS } from "../color";
import { RigSchema, type Rig } from "../schema";
import { wirePinChainsFromRig } from "../wiring";

/** Version of the Studio layout JSON file (rig + wiring + editor UI), not `Rig.meta.schemaVersion`. */
export const STUDIO_LAYOUT_FILE_VERSION = 2;

const rgbTuple = z.tuple([
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
]);

export const StudioLedOverrideSchema = z.object({
  globalIndex: z.number().int().nonnegative(),
  rgb: rgbTuple,
});

export type StudioLedOverride = z.infer<typeof StudioLedOverrideSchema>;

/** Face layout lives in `rig.faceLayouts` (ledCount, pattern, padding, rowSizes, …). */
export const StudioEditorSnapshotSchema = z.object({
  ledPreviewDiameterMm: z.number().min(0.5).max(40),
  showViewerAxes: z.boolean(),
  showSolidOutline: z.boolean(),
  hideBackfaceDiscrete: z.boolean(),
  hideBackfaceDeviceRig: z.boolean(),
  color: ColorSettingsSchema,
  paintColor: rgbTuple,
  ledOverrides: z.array(StudioLedOverrideSchema).default([]),
  /** Bilinear UV sampling + image-sequence crossfade while playing (Studio playback engine). */
  playbackSmoothing: z.boolean().default(true),
});

export type StudioEditorSnapshot = z.infer<typeof StudioEditorSnapshotSchema>;

export const StudioWiringSnapshotSchema = z.object({
  wirePinChains: z.array(z.array(z.string())),
  wirePinGpio: z.array(z.number().int()),
  wireConfigured: z.boolean(),
  wireReversed: z.array(z.string()).default([]),
  wireFaceRotations: z.record(z.string(), z.number().int().min(0).max(2)).default({}),
  wiringCheckedPinIndices: z.array(z.number().int().min(0)).default([]),
});

export type StudioWiringSnapshot = z.infer<typeof StudioWiringSnapshotSchema>;

export const StudioLayoutFileSchema = z.object({
  kind: z.literal("glowbe-studio-layout"),
  fileVersion: z.union([z.literal(1), z.literal(2)]),
  exportedAt: z.string().datetime().optional(),
  rig: RigSchema,
  wiring: StudioWiringSnapshotSchema.optional(),
  editor: StudioEditorSnapshotSchema.optional(),
});

export type StudioLayoutFile = z.infer<typeof StudioLayoutFileSchema>;

export type BuildStudioLayoutInput = {
  rig: Rig;
  wiring: StudioWiringSnapshot;
  editor: StudioEditorSnapshot;
};

export const defaultStudioEditorSnapshot = (): StudioEditorSnapshot => ({
  ledPreviewDiameterMm: 3,
  showViewerAxes: true,
  showSolidOutline: true,
  hideBackfaceDiscrete: true,
  hideBackfaceDeviceRig: true,
  color: DEFAULT_COLOR_SETTINGS,
  paintColor: [255, 80, 0],
  ledOverrides: [],
  playbackSmoothing: true,
});

/** Serialize rig + MCU wiring + Studio UI for save/reload. */
export const buildStudioLayoutFile = (input: BuildStudioLayoutInput): StudioLayoutFile => ({
  kind: "glowbe-studio-layout",
  fileVersion: STUDIO_LAYOUT_FILE_VERSION,
  exportedAt: new Date().toISOString(),
  rig: input.rig,
  wiring: input.wiring,
  editor: input.editor,
});

/** Derive wiring UI fields from a rig when an older file has no `wiring` block. */
export const wiringSnapshotFromRig = (rig: Rig): StudioWiringSnapshot => {
  const { chains, gpio } = wirePinChainsFromRig(rig);
  const wireReversed: string[] = [];
  const wireFaceRotations: Record<string, number> = {};
  for (const part of rig.parts) {
    for (const fc of part.faceConnections ?? []) {
      if (fc.reversed) wireReversed.push(fc.faceId);
      if (fc.rotation) wireFaceRotations[fc.faceId] = fc.rotation;
    }
  }
  const wireConfigured =
    rig.parts.length > 0 &&
    !(rig.parts.length === 1 && rig.parts[0]!.id === "part-unwired-preview");
  return {
    wirePinChains: chains,
    wirePinGpio: gpio,
    wireConfigured,
    wireReversed,
    wireFaceRotations,
    wiringCheckedPinIndices: [],
  };
};

export type ParseStudioLayoutResult =
  | {
      ok: true;
      layout: StudioLayoutFile;
      wiring: StudioWiringSnapshot;
      editor: StudioEditorSnapshot;
    }
  | { ok: false; message: string };

/** Parse and validate a layout JSON file from disk. */
export const parseStudioLayoutFile = (input: unknown): ParseStudioLayoutResult => {
  const parsed = StudioLayoutFileSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") ?? "file";
    return {
      ok: false,
      message: issue?.message ? `${path}: ${issue.message}` : "Invalid layout file.",
    };
  }
  const layout = parsed.data;
  const wiring = layout.wiring ?? wiringSnapshotFromRig(layout.rig);
  const editor = layout.editor ?? defaultStudioEditorSnapshot();
  return { ok: true, layout, wiring, editor };
};
