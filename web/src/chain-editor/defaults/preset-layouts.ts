import type { StudioLayoutFile } from "@glowbe/core";
import { IMPLEMENTED_SOLID_PRESETS } from "@glowbe/core";
import geodesicIco2v from "@/chain-editor/defaults/layouts/geodesic-ico-2v.json";
import icosahedron from "@/chain-editor/defaults/layouts/icosahedron.json";
import octahedron from "@/chain-editor/defaults/layouts/octahedron.json";
import tetrahedron from "@/chain-editor/defaults/layouts/tetrahedron.json";
import { isImplementedSolidPreset } from "@/chain-editor/defaults/build-preset-default-rig";

export type ImplementedSolidPreset = (typeof IMPLEMENTED_SOLID_PRESETS)[number];

const PRESET_LAYOUT_FILES: Record<ImplementedSolidPreset, StudioLayoutFile> = {
  icosahedron: icosahedron as unknown as StudioLayoutFile,
  "geodesic-ico-2v": geodesicIco2v as unknown as StudioLayoutFile,
  octahedron: octahedron as unknown as StudioLayoutFile,
  tetrahedron: tetrahedron as unknown as StudioLayoutFile,
};

export function getPresetDefaultLayoutFile(
  preset: ImplementedSolidPreset,
): StudioLayoutFile {
  return PRESET_LAYOUT_FILES[preset];
}

export { isImplementedSolidPreset };
