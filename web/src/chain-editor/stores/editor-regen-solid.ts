import { DEFAULT_PINS, activeFaceIds, generateSolid, type Rig, type SolidPreset } from "@glowbe/core";
import { applyWiringToRig, chainsHaveAnyFace } from "./editor-wiring-rig";

export type RegenSolidSnapshot = {
  rig: Rig;
  wirePinChains: string[][];
  wirePinGpio: number[];
  wireReversed: string[];
  selectedFaceIds: string[];
  wireFaceRotations: Record<string, number>;
  wiringCheckedPinIndices: number[];
  wiringFocusedPinIndex: number | null;
  attachmentPreviewCell: { ri: number; ci: number } | null;
};

/**
 * Rebuild solid geometry at a new radius/preset while pruning wiring to faces that
 * still exist on the new solid. Caller applies `rig` + `patch` via `applyRig`.
 */
export function computeRegenSolid(
  snapshot: RegenSolidSnapshot,
  preset: SolidPreset,
  radius: number,
): {
  rig: Rig;
  patch: {
    wirePinChains: string[][];
    wirePinGpio: number[];
    wireReversed: string[];
    selectedFaceIds: string[];
    wireConfigured: boolean;
    wiringCheckedPinIndices: number[];
    wiringFocusedPinIndex: number | null;
    wiringAssignmentTarget: null;
    wiringWalkPinIndex: null;
    wireFaceRotations: Record<string, number>;
    attachmentPreviewCell: { ri: number; ci: number } | null;
  };
} {
  const base: Rig = { ...snapshot.rig, solid: generateSolid(preset, radius) };
  const order = activeFaceIds(base);
  const reversed = snapshot.wireReversed.filter((id) => order.includes(id));
  const selectedFaceIds = snapshot.selectedFaceIds.filter((id) => order.includes(id));
  const faceSet = new Set(order);
  const newChains = snapshot.wirePinChains.map((row) =>
    row.map((id) => (id && faceSet.has(id) ? id : "")),
  );
  const newGpio = snapshot.wirePinGpio.slice(0, newChains.length);
  while (newGpio.length < newChains.length) {
    newGpio.push(DEFAULT_PINS[newGpio.length] ?? -1);
  }
  const wiringCheckedPinIndices = snapshot.wiringCheckedPinIndices.filter(
    (i) => i >= 0 && i < newChains.length,
  );
  const wiringFocusedPinIndex =
    snapshot.wiringFocusedPinIndex != null && snapshot.wiringFocusedPinIndex < newChains.length
      ? snapshot.wiringFocusedPinIndex
      : null;
  const newRot: Record<string, number> = Object.fromEntries(
    Object.entries(snapshot.wireFaceRotations).filter(([id]) => faceSet.has(id)),
  );
  const wireConfigured = chainsHaveAnyFace(newChains);
  const rig = applyWiringToRig(base, newChains, newGpio, reversed, newRot, wireConfigured);
  const ap = snapshot.attachmentPreviewCell;
  let nextAttachment: { ri: number; ci: number } | null = ap;
  if (ap) {
    const row = newChains[ap.ri];
    if (!row || ap.ci >= row.length || !(row[ap.ci]?.length)) nextAttachment = null;
  }
  return {
    rig,
    patch: {
      wirePinChains: newChains,
      wirePinGpio: newGpio,
      wireReversed: reversed,
      selectedFaceIds,
      wireConfigured,
      wiringCheckedPinIndices,
      wiringFocusedPinIndex,
      wiringAssignmentTarget: null,
      wiringWalkPinIndex: null,
      wireFaceRotations: newRot,
      attachmentPreviewCell: nextAttachment,
    },
  };
}
