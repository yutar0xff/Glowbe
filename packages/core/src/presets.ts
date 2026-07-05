import { generateSolid } from "./geometry/solids";
import type { FaceLayout, Rig } from "./schema";
import { RIG_SCHEMA_VERSION } from "./schema";

/**
 * Default layout for a triangular panel: 15 LEDs in rows of [5,4,3,2,1] chained
 * from Din at the base toward the apex (current prototype hardware).
 */
export const triangleLayout = (
  overrides: Partial<FaceLayout> = {},
): FaceLayout => ({
  faceType: "triangle",
  ledCount: 15,
  pattern: "triangular-rows",
  rowSizes: [5, 4, 3, 2, 1],
  padding: 0,
  chainEntry: 0,
  chainMirrorLR: false,
  ...overrides,
});

/**
 * 15panels: icosahedron with the south cap (5 faces) removed -> 15 panels,
 * 15 LEDs each = 225 LEDs.
 */
export const rig15Panels = (radius = 100): Rig => ({
  meta: {
    id: "icosahedron-15",
    name: "Glowbe 15 panels (Icosahedron)",
    schemaVersion: RIG_SCHEMA_VERSION,
    units: "mm",
  },
  solid: generateSolid("icosahedron", radius),
  faceLayouts: [triangleLayout()],
  parts: [],
  channels: [],
});

/**
 * 60panels: geodesic V2 icosahedron with the bottom 20 faces removed ->
 * 60 panels, 21 LEDs each = 1260 LEDs (product hardware).
 */
export const rig60Panels = (radius = 150): Rig => ({
  meta: {
    id: "geodesic-2v-60",
    name: "Glowbe 60 panels (Geodesic 2V)",
    schemaVersion: RIG_SCHEMA_VERSION,
    units: "mm",
  },
  solid: generateSolid("geodesic-ico-2v", radius),
  faceLayouts: [triangleLayout()],
  parts: [],
  channels: [],
});
