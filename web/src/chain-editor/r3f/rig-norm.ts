import type { LedPlacement, Rig } from "@glowbe/core";

export function rigVertexNorm(rig: Rig): number {
  let max = 1;
  for (const f of rig.solid.faces) {
    for (const v of f.vertices) {
      max = Math.max(max, Math.hypot(v.x, v.y, v.z));
    }
  }
  return max;
}

export function rigLedNorm(rig: Rig, leds: LedPlacement[]): number {
  let m = rigVertexNorm(rig);
  for (const l of leds) {
    m = Math.max(m, Math.hypot(l.position.x, l.position.y, l.position.z));
  }
  return m;
}
