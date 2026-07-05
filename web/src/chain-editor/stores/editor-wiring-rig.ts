import {
  DEFAULT_PINS,
  buildWiringFromChains,
  resolveRig,
  type LedPlacement,
  type Rig,
} from "@glowbe/core";
import { buildPresetDefaultRig } from "@/chain-editor/defaults/build-preset-default-rig";

/**
 * Studio default solid: **icosahedron** preset — same skeleton as bundled
 * `icosahedron.json` before `applyDefaultLayoutOnce` replaces it from the preset file.
 */
export const defaultEditorRig = (): Rig => {
  return buildPresetDefaultRig("icosahedron");
};

export const resolveRigSafe = (
  rig: Rig,
): { leds: LedPlacement[]; error: string | null } => {
  try {
    return { leds: resolveRig(rig), error: null };
  } catch (e) {
    return { leds: [], error: e instanceof Error ? e.message : String(e) };
  }
};

export const initialWirePinChains: string[][] = [];
export const initialWirePinGpio: number[] = [];

export const chainsHaveAnyFace = (chains: string[][]): boolean =>
  chains.some((row) => row.some((id) => id.length > 0));

const UNWIRED_PREVIEW_PART_ID = "part-unwired-preview";

export const applyWiringToRig = (
  rig: Rig,
  chains: string[][],
  gpio: number[],
  reversed: string[],
  faceRotations: Record<string, number>,
  configured: boolean,
): Rig => {
  if (!configured) {
    const reversedSet = new Set(reversed);
    const clampRot = (faceId: string): 0 | 1 | 2 => {
      const r = Math.round(faceRotations[faceId] ?? 0) % 3;
      const n = ((r % 3) + 3) % 3;
      return n as 0 | 1 | 2;
    };
    const faceIds = rig.solid.faces
      .filter((f) => !rig.solid.disabledFaceIds.includes(f.id))
      .map((f) => f.id);
    if (faceIds.length === 0) {
      return { ...rig, parts: [], channels: [] };
    }
    return {
      ...rig,
      parts: [
        {
          id: UNWIRED_PREVIEW_PART_ID,
          faceIds,
          faceConnections: faceIds.map((faceId) => ({
            faceId,
            reversed: reversedSet.has(faceId),
            rotation: clampRot(faceId),
          })),
        },
      ],
      channels: [
        {
          index: 0,
          pin: gpio[0] ?? DEFAULT_PINS[0] ?? -1,
          partIds: [UNWIRED_PREVIEW_PART_ID],
        },
      ],
    };
  }
  const rowChains = chains.map((row) => row.filter((id) => id.length > 0));
  return {
    ...rig,
    ...buildWiringFromChains({
      chains: rowChains,
      pins: gpio,
      reversed,
      faceRotations,
    }),
  };
};

export const initialEditorRig = applyWiringToRig(
  defaultEditorRig(),
  initialWirePinChains,
  initialWirePinGpio,
  [],
  {},
  false,
);

export const initialEditorLeds = resolveRigSafe(initialEditorRig).leds;

/** Remap a GPIO row index after moving that row from `fromIndex` to `toIndex`. */
export function remapRowIndexAfterMove(
  fromIndex: number,
  toIndex: number,
  i: number,
): number {
  if (i === fromIndex) return toIndex;
  if (fromIndex < toIndex) {
    if (i > fromIndex && i <= toIndex) return i - 1;
  } else if (i >= toIndex && i < fromIndex) {
    return i + 1;
  }
  return i;
}
