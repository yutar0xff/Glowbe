import type { Channel, FaceConnection, Part, Rig } from "./schema";

/** Default ESP32 (WROOM-32) output pins for the 10 parallel I2S lines. */
export const DEFAULT_PINS = [13, 14, 16, 17, 18, 19, 21, 22, 23, 25];

/** Active face ids of a rig, in solid face order (default chain order). */
export const activeFaceIds = (rig: Rig): string[] =>
  rig.solid.faces
    .map((f) => f.id)
    .filter((id) => !rig.solid.disabledFaceIds.includes(id));

/** Split `n` items into `k` contiguous groups as evenly as possible. */
const evenSplit = <T>(items: T[], k: number): T[][] => {
  const groups: T[][] = [];
  const n = items.length;
  const base = Math.floor(n / k);
  let rem = n % k;
  let i = 0;
  for (let g = 0; g < k; g++) {
    const size = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem -= 1;
    groups.push(items.slice(i, i + size));
    i += size;
  }
  return groups;
};

export interface BuildWiringOptions {
  /** Chain order of faces across the whole device (Din→Dout). */
  faceOrder: string[];
  /** Number of parallel channels (I2S lines) to split the chain across. */
  numChannels: number;
  /** Face ids whose in-face traversal is flipped. */
  reversed?: Iterable<string>;
  pins?: number[];
}

/**
 * Build `parts` + `channels` from an explicit chain order. The ordered faces
 * are split into `numChannels` contiguous runs (one synthetic part per
 * channel), preserving Din→Dout order. Per-face `reversed` flips in-face
 * traversal. Empty channels are still emitted so pins stay stable.
 */
export const buildWiring = (
  options: BuildWiringOptions,
): Pick<Rig, "parts" | "channels"> => {
  const pins = options.pins ?? DEFAULT_PINS;
  const reversed = new Set(options.reversed ?? []);
  const k = Math.max(1, options.numChannels);
  const groups = evenSplit(options.faceOrder, k);

  const parts: Part[] = [];
  const channels: Channel[] = [];
  groups.forEach((faceIds, i) => {
    const partId = `part-${i}`;
    const faceConnections: FaceConnection[] = faceIds.map((faceId) => ({
      faceId,
      reversed: reversed.has(faceId),
      rotation: 0,
    }));
    parts.push({ id: partId, faceIds, faceConnections });
    channels.push({ index: i, pin: pins[i] ?? -1, partIds: faceIds.length ? [partId] : [] });
  });

  return { parts, channels };
};

export interface BuildWiringFromChainsOptions {
  /** One ordered face chain per parallel output (row `i` → channel index `i`). */
  chains: string[][];
  reversed?: Iterable<string>;
  pins?: number[];
  /** Per-face 120° rotation steps (0..2) for triangular in-face grids; see `FaceConnection`. */
  faceRotations?: Readonly<Record<string, number>>;
}

/**
 * Build `parts` + `channels` from explicit per-pin face chains (each row is one
 * I2S line / GPIO). Empty rows still emit an empty channel so indices stay stable.
 */
export const buildWiringFromChains = (
  options: BuildWiringFromChainsOptions,
): Pick<Rig, "parts" | "channels"> => {
  const pins = options.pins ?? DEFAULT_PINS;
  const reversed = new Set(options.reversed ?? []);
  const rotMap = options.faceRotations ?? {};
  const chains = options.chains;
  const parts: Part[] = [];
  const channels: Channel[] = [];

  const clampRot = (faceId: string): 0 | 1 | 2 => {
    const r = Math.round(rotMap[faceId] ?? 0) % 3;
    return (r < 0 ? r + 3 : r) as 0 | 1 | 2;
  };

  chains.forEach((faceIds, i) => {
    const filtered = faceIds.filter((id) => id.length > 0);
    if (filtered.length === 0) {
      channels.push({ index: i, pin: pins[i] ?? -1, partIds: [] });
      return;
    }
    const partId = `part-${i}`;
    parts.push({
      id: partId,
      faceIds: filtered,
      faceConnections: filtered.map((faceId) => ({
        faceId,
        reversed: reversed.has(faceId),
        rotation: clampRot(faceId),
      })),
    });
    channels.push({ index: i, pin: pins[i] ?? -1, partIds: [partId] });
  });

  return { parts, channels };
};

export interface WiringOptions {
  numChannels?: number;
  panelsPerPart?: number;
  pins?: number[];
}

/**
 * Produce a deterministic default wiring: chunk the active faces into parts and
 * fill channels sequentially. This is a structurally valid placeholder for
 * testing/codegen; the real wiring is set physically and edited in Studio.
 */
/** Rebuild MCU table rows from `parts` + `channels` (one chain per channel index). */
export const wirePinChainsFromRig = (
  rig: Rig,
): { chains: string[][]; gpio: number[] } => {
  const channels = [...rig.channels].sort((a, b) => a.index - b.index);
  if (channels.length === 0) {
    return { chains: [[]], gpio: [DEFAULT_PINS[0] ?? -1] };
  }
  const partById = new Map(rig.parts.map((p) => [p.id, p]));
  const chains = channels.map((ch) => {
    const faces: string[] = [];
    for (const partId of ch.partIds) {
      const part = partById.get(partId);
      if (part) faces.push(...part.faceIds);
    }
    return faces;
  });
  const gpio = channels.map((ch) => ch.pin);
  return { chains, gpio };
};

export const autoAssignWiring = (rig: Rig, options: WiringOptions = {}): Rig => {
  const numChannels = options.numChannels ?? 10;
  const panelsPerPart = options.panelsPerPart ?? 6;
  const pins = options.pins ?? DEFAULT_PINS;

  const activeFaceIds = rig.solid.faces
    .map((f) => f.id)
    .filter((id) => !rig.solid.disabledFaceIds.includes(id));

  const parts: Part[] = [];
  for (let i = 0; i < activeFaceIds.length; i += panelsPerPart) {
    parts.push({
      id: `part-${parts.length}`,
      faceIds: activeFaceIds.slice(i, i + panelsPerPart),
    });
  }

  const channels: Channel[] = Array.from({ length: numChannels }, (_, i) => ({
    index: i,
    pin: pins[i] ?? -1,
    partIds: [],
  }));
  parts.forEach((part, i) => {
    channels[i % numChannels]!.partIds.push(part.id);
  });

  return { ...rig, parts, channels };
};
