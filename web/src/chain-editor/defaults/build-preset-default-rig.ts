import {
  RIG_SCHEMA_VERSION,
  generateSolid,
  faceInradius,
  triangleLayout,
  type Rig,
  type SolidPreset,
} from "@glowbe/core";
import { IMPLEMENTED_SOLID_PRESETS } from "@glowbe/core";

/** Default sphere radius (mm) when generating preset layout JSON files. */
export const PRESET_DEFAULT_RADIUS_MM: Record<
  (typeof IMPLEMENTED_SOLID_PRESETS)[number],
  number
> = {
  icosahedron: 100,
  "geodesic-ico-2v": 150,
  octahedron: 120,
  tetrahedron: 120,
};

const PRESET_DISPLAY_NAME: Record<(typeof IMPLEMENTED_SOLID_PRESETS)[number], string> = {
  icosahedron: "Icosahedron (15 panels)",
  "geodesic-ico-2v": "Geodesic 2V (60 panels)",
  octahedron: "Octahedron (8 panels)",
  tetrahedron: "Tetrahedron (4 panels)",
};

/** Rig skeleton for a preset (unwired preview), matching Studio code defaults. */
export function buildPresetDefaultRig(preset: (typeof IMPLEMENTED_SOLID_PRESETS)[number]): Rig {
  const radius = PRESET_DEFAULT_RADIUS_MM[preset];
  const solid = generateSolid(preset, radius);
  const face = solid.faces.find((f) => !solid.disabledFaceIds.includes(f.id));
  const ir = face ? faceInradius(face.vertices) : 0;
  const paddingMm = Math.round(ir * 0.35 * 10) / 10;
  return {
    meta: {
      id: `glowbe-default-${preset}`,
      name: `Glowbe default — ${PRESET_DISPLAY_NAME[preset]}`,
      schemaVersion: RIG_SCHEMA_VERSION,
      units: "mm",
    },
    solid,
    faceLayouts: [triangleLayout({ paddingMm })],
    parts: [],
    channels: [],
  };
}

export function isImplementedSolidPreset(
  preset: SolidPreset,
): preset is (typeof IMPLEMENTED_SOLID_PRESETS)[number] {
  return (IMPLEMENTED_SOLID_PRESETS as readonly string[]).includes(preset);
}
