import type { SolidPreset } from '@glowbe/core'

/** Solid geometry presets exposed in the chain profile editor UI. */
export const EDITOR_SOLID_PRESETS = ['icosahedron', 'geodesic-ico-2v'] as const satisfies readonly SolidPreset[]

export type EditorSolidPreset = (typeof EDITOR_SOLID_PRESETS)[number]

export const EDITOR_SOLID_PRESET_LABELS: Record<EditorSolidPreset, string> = {
  icosahedron: 'Icosahedron (15-panel dome)',
  'geodesic-ico-2v': 'Geodesic 2V (60-panel dome)',
}
