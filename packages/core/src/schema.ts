import { z } from "zod";

/** Current Rig schema version. Bump + add a migration when the shape changes. */
export const RIG_SCHEMA_VERSION = 1;

export const Vec2Schema = z.object({ x: z.number(), y: z.number() });
export const Vec3Schema = z.object({ x: z.number(), y: z.number(), z: z.number() });

export const SolidPresetSchema = z.enum([
  "icosahedron",
  "geodesic-ico-2v",
  "tetrahedron",
  "cube",
  "octahedron",
  "dodecahedron",
  "combo-cube",
  "custom",
]);
export type SolidPreset = z.infer<typeof SolidPresetSchema>;

/** Which region of the solid a face belongs to (used for default cap removal). */
export const FaceRegionSchema = z.enum(["top", "middle", "bottom"]);
export type FaceRegion = z.infer<typeof FaceRegionSchema>;

export const FaceSchema = z.object({
  id: z.string(),
  /** Geometric type of the face (drives default LED layout selection). */
  type: z.string(),
  /** 3D positions of the face's corners, in order, scaled to the solid radius. */
  vertices: z.array(Vec3Schema).min(3),
  /** Outward normal of the face. */
  normal: Vec3Schema,
  /** In-plane rotation of the LED grid, in radians. */
  orientation: z.number().default(0),
  region: FaceRegionSchema.optional(),
});
export type Face = z.infer<typeof FaceSchema>;

export const LedPatternSchema = z.enum([
  "triangular-rows",
  "zigzag",
  "parallel-rows",
  "spiral",
  "custom",
]);
export type LedPattern = z.infer<typeof LedPatternSchema>;

export const FaceLayoutSchema = z.object({
  /**
   * Matches `Face.id` (exact), `Face.type`, or the wildcard `"triangle"` for any
   * 3-vertex face. Resolution prefers the most specific match.
   */
  faceType: z.string(),
  ledCount: z.number().int().positive(),
  pattern: LedPatternSchema,
  /** LED count per row, in chain order from Din. e.g. [5,4,3,2,1] for 15. */
  rowSizes: z.array(z.number().int().positive()).optional(),
  /**
   * Inset of the LED grid from the face edges, as a fraction of the face size
   * (0 = touch the edges, ~0.4 = tightly clustered at the center). Shrinks the
   * placement triangle toward its centroid.
   */
  padding: z.number().min(0).max(0.45).default(0),
  /**
   * Physical inset from the face edges in millimeters. When set, it takes
   * precedence over `padding`: at resolve time it is converted to a centroid
   * fraction using each face's inradius (`paddingMm / inradius`). Lets the user
   * specify spacing in real-world units that follow the chosen sphere size.
   */
  paddingMm: z.number().nonnegative().optional(),
  /** Explicit per-LED barycentric/2D positions for pattern "custom". */
  positions: z.array(Vec2Schema).optional(),
  /** Corner index where the data line enters the face. */
  chainEntry: z.number().int().min(0).max(2).default(0),
  /**
   * Mirror the in-face chain left↔right along the panel base (swap base-corner
   * weights in barycentric coords). Independent of wiring `reversed` (Din↔Dout).
   */
  chainMirrorLR: z.boolean().default(false),
});
export type FaceLayout = z.infer<typeof FaceLayoutSchema>;

export const FaceConnectionSchema = z.object({
  faceId: z.string(),
  /** Reverse the chain traversal direction within the face. */
  reversed: z.boolean().default(false),
  /** 120-degree rotation steps applied to the in-face grid (triangles). */
  rotation: z.number().int().min(0).max(2).default(0),
});
export type FaceConnection = z.infer<typeof FaceConnectionSchema>;

export const PartSchema = z.object({
  id: z.string(),
  faceIds: z.array(z.string()).min(1),
  /** Optional per-face traversal overrides; defaults to faceIds order. */
  faceConnections: z.array(FaceConnectionSchema).optional(),
});
export type Part = z.infer<typeof PartSchema>;

export const ChannelSchema = z.object({
  /** 0-based parallel line index (0..9 for the 10-line hardware plan). */
  index: z.number().int().min(0).max(9),
  /** ESP32 GPIO pin driving this line. */
  pin: z.number().int(),
  /** Parts wired in series on this line, in chain order. */
  partIds: z.array(z.string()),
});
export type Channel = z.infer<typeof ChannelSchema>;

export const SolidSchema = z.object({
  preset: SolidPresetSchema,
  /** Sphere radius in millimeters. */
  radius: z.number().positive(),
  faces: z.array(FaceSchema),
  /** Faces that are physically absent (e.g. the removed south cap). */
  disabledFaceIds: z.array(z.string()).default([]),
});
export type Solid = z.infer<typeof SolidSchema>;

export const RigMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  schemaVersion: z.number().int().default(RIG_SCHEMA_VERSION),
  units: z.literal("mm").default("mm"),
});
export type RigMeta = z.infer<typeof RigMetaSchema>;

export const RigSchema = z.object({
  meta: RigMetaSchema,
  solid: SolidSchema,
  faceLayouts: z.array(FaceLayoutSchema).min(1),
  parts: z.array(PartSchema).default([]),
  channels: z.array(ChannelSchema).default([]),
});
export type Rig = z.infer<typeof RigSchema>;

/** Computed output of resolving a Rig: one entry per physical LED. */
export const LedPlacementSchema = z.object({
  globalIndex: z.number().int().nonnegative(),
  position: Vec3Schema,
  normal: Vec3Schema,
  uv: Vec2Schema,
  address: z.object({
    channel: z.number().int().nonnegative(),
    chainIndex: z.number().int().nonnegative(),
  }),
  faceId: z.string(),
});
export type LedPlacement = z.infer<typeof LedPlacementSchema>;

/** Parse + validate an unknown value as a Rig (throws on invalid input). */
export const parseRig = (input: unknown): Rig => RigSchema.parse(input);
