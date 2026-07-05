/**
 * glowbe-layout v1 → compiled artifacts (meta, ledmap, bin, firmware header).
 * Shared by CLI, runtime IPC, and tests.
 */
import {
  buildWiringFromChains,
  generateSolid,
  resolveRig,
  wirePinChainsFromRig,
  type FaceLayout,
  type Rig,
} from "../packages/core/src/index.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type GlowbeLayout = {
  format: "glowbe-layout";
  version: 1;
  id: string;
  displayName: string;
  variant: string;
  geometry: {
    preset: string;
    radiusMm: number;
    units: "mm";
    disabledFaceIds: string[];
  };
  face: {
    ledCount: number;
    pattern: FaceLayout["pattern"];
    paddingMm: number;
    chainMirrorLR: boolean;
    rowSizes?: number[];
  };
  wiring: {
    chip: string;
    colorOrder: string;
    dataLines: Array<{
      gpio: number;
      faceChain: string[];
      faceRotations: Record<string, number>;
      reversedFaces: string[];
    }>;
  };
};

export type CompileOutputPaths = {
  repoRoot: string;
  compiledDir?: string;
  firmwareGeneratedDir?: string;
};

export type CompileResult = {
  layoutId: string;
  layoutHash: number;
  ledCount: number;
  dataLineCount: number;
  gpios: number[];
  ledsPerLine: number[];
};

export function assertGlowbeLayout(raw: unknown): GlowbeLayout {
  const layout = raw as GlowbeLayout;
  if (layout?.format !== "glowbe-layout" || layout.version !== 1) {
    throw new Error("Expected glowbe-layout version 1");
  }
  if (!layout.id || layout.id.includes("/") || layout.id.includes("\\")) {
    throw new Error("layout id must be non-empty and path-safe");
  }
  return layout;
}

export function layoutToRig(layout: GlowbeLayout): Rig {
  const solid = generateSolid(
    layout.geometry.preset as Parameters<typeof generateSolid>[0],
    layout.geometry.radiusMm,
  );
  solid.disabledFaceIds = [...layout.geometry.disabledFaceIds];

  const faceLayout: FaceLayout = {
    faceType: "triangle",
    ledCount: layout.face.ledCount,
    pattern: layout.face.pattern,
    paddingMm: layout.face.paddingMm,
    padding: 0,
    chainEntry: 0,
    chainMirrorLR: layout.face.chainMirrorLR,
    ...(layout.face.rowSizes ? { rowSizes: layout.face.rowSizes } : {}),
  };

  const chains = layout.wiring.dataLines.map((d) => d.faceChain);
  const pins = layout.wiring.dataLines.map((d) => d.gpio);
  const reversed = layout.wiring.dataLines.flatMap((d) => d.reversedFaces);
  const faceRotations = Object.assign(
    {},
    ...layout.wiring.dataLines.map((d) => d.faceRotations),
  );

  const { parts, channels } = buildWiringFromChains({
    chains,
    pins,
    reversed,
    faceRotations,
  });

  return {
    meta: {
      id: layout.id,
      name: layout.displayName,
      schemaVersion: 1,
      units: "mm",
    },
    solid,
    faceLayouts: [faceLayout],
    parts,
    channels,
  };
}

/** Build glowbe-layout v1 from a resolved Rig (editor save path). */
export function rigToGlowbeLayout(
  rig: Rig,
  opts: { variant: string; chip?: string; colorOrder?: string },
): GlowbeLayout {
  const faceLayout = rig.faceLayouts[0];
  if (!faceLayout) {
    throw new Error("Rig must have at least one face layout");
  }

  const { chains, gpio } = wirePinChainsFromRig(rig);
  const partById = new Map(rig.parts.map((p) => [p.id, p]));
  const channelByIndex = new Map(rig.channels.map((c) => [c.index, c]));

  const dataLines = chains.map((faceChain, chIndex) => {
    const ch = channelByIndex.get(chIndex);
    const faceRotations: Record<string, number> = {};
    const reversedFaces: string[] = [];
    if (ch) {
      for (const partId of ch.partIds) {
        const part = partById.get(partId);
        if (!part) continue;
        for (const conn of part.faceConnections ?? []) {
          if (conn.rotation != null && conn.rotation !== 0) {
            faceRotations[conn.faceId] = conn.rotation;
          }
          if (conn.reversed) {
            reversedFaces.push(conn.faceId);
          }
        }
      }
    }
    return {
      gpio: gpio[chIndex] ?? -1,
      faceChain,
      faceRotations,
      reversedFaces,
    };
  });

  return {
    format: "glowbe-layout",
    version: 1,
    id: rig.meta.id,
    displayName: rig.meta.name,
    variant: opts.variant,
    geometry: {
      preset: rig.solid.preset,
      radiusMm: rig.solid.radius,
      units: "mm",
      disabledFaceIds: [...rig.solid.disabledFaceIds],
    },
    face: {
      ledCount: faceLayout.ledCount,
      pattern: faceLayout.pattern,
      paddingMm: faceLayout.paddingMm ?? 0,
      chainMirrorLR: faceLayout.chainMirrorLR ?? false,
      ...(faceLayout.rowSizes ? { rowSizes: faceLayout.rowSizes } : {}),
    },
    wiring: {
      chip: opts.chip ?? "SK6805",
      colorOrder: opts.colorOrder ?? "GRB",
      dataLines,
    },
  };
}

function writeBin(path: string, gpios: number[], ledsPerLine: number[]): void {
  const ledCount = ledsPerLine.reduce((a, b) => a + b, 0);
  const n = gpios.length;
  const buf = Buffer.alloc(8 + n + n * 2);
  buf.write("GBLD", 0, "ascii");
  buf.writeUInt8(1, 4);
  buf.writeUInt16LE(ledCount, 5);
  buf.writeUInt8(n, 7);
  for (let i = 0; i < n; i++) buf.writeUInt8(gpios[i]!, 8 + i);
  const off = 8 + n;
  for (let i = 0; i < n; i++) buf.writeUInt16LE(ledsPerLine[i]!, off + i * 2);
  writeFileSync(path, buf);
}

/** FNV-1a 32-bit — must match runtime `meta.layoutHash` for mismatch detection. */
export function fnv1aLayoutHash(
  layout: GlowbeLayout,
  gpios: number[],
  ledsPerLine: number[],
): number {
  const canonical = JSON.stringify({
    id: layout.id,
    gpios,
    ledsPerLine,
    chip: layout.wiring.chip,
    colorOrder: layout.wiring.colorOrder,
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function writeHeader(
  path: string,
  layoutId: string,
  gpios: number[],
  ledsPerLine: number[],
  layoutHash: number,
): void {
  const ledCount = ledsPerLine.reduce((a, b) => a + b, 0);
  const maxLineLeds = Math.max(...ledsPerLine, 0);
  const h = layoutHash >>> 0;
  const hex8 = h.toString(16).padStart(8, "0");
  const lines = [
    "// Auto-generated by tools/layout-build-lib.ts — do not edit.",
    `#pragma once`,
    `#define GLOWBE_LAYOUT_ID "${layoutId}"`,
    `#define GLOWBE_LAYOUT_HASH ((uint32_t)0x${hex8}u)`,
    `#define GLOWBE_LED_COUNT ${ledCount}`,
    `#define GLOWBE_DATA_LINES ${gpios.length}`,
    `#define GLOWBE_MAX_LINE_LEDS ${maxLineLeds}`,
    `static const uint8_t GLOWBE_GPIO_PINS[${gpios.length}] = { ${gpios.join(", ")} };`,
    `static const uint16_t GLOWBE_LINE_LED_COUNTS[${gpios.length}] = { ${ledsPerLine.join(", ")} };`,
    "",
    "// NeoPixelBus parallel: all lines driven at GLOWBE_MAX_LINE_LEDS (shorter chains pad black).",
    "// Logical index order matches GLOWBE_LINE_LED_COUNTS (same as 1D UDP).",
    `// Parallel width: ${gpios.length > 8 ? "X16 (>8 lines)" : "X8 (≤8 lines)"}`,
  ];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join("\n"), "utf8");
}

/** Compile layout JSON into meta, ledmap, bin, and optional firmware header. */
export function compileGlowbeLayout(
  layoutInput: GlowbeLayout | unknown,
  paths: CompileOutputPaths,
): CompileResult {
  const layout = assertGlowbeLayout(layoutInput);
  const rig = layoutToRig(layout);
  const placements = resolveRig(rig);

  const ledsPerLine = layout.wiring.dataLines.map((_, ch) =>
    placements.filter((p) => p.address.channel === ch).length,
  );
  const gpios = layout.wiring.dataLines.map((d) => d.gpio);
  const lineGlobalOffset: number[] = [];
  let acc = 0;
  for (const n of ledsPerLine) {
    lineGlobalOffset.push(acc);
    acc += n;
  }

  const compiledDir =
    paths.compiledDir ?? `${paths.repoRoot}/assets/compiled`;
  const fwGen =
    paths.firmwareGeneratedDir ??
    `${paths.repoRoot}/firmware/esp32/include/generated/${layout.id}`;

  mkdirSync(compiledDir, { recursive: true });
  mkdirSync(fwGen, { recursive: true });

  const layoutHash = fnv1aLayoutHash(layout, gpios, ledsPerLine);
  const id = layout.id;
  const meta = {
    layoutId: id,
    layoutHash,
    displayName: layout.displayName,
    variant: layout.variant,
    ledCount: placements.length,
    dataLineCount: gpios.length,
    gpios,
    ledsPerLine,
    lineGlobalOffset,
    chip: layout.wiring.chip,
    colorOrder: layout.wiring.colorOrder,
  };

  const ledmap = placements.map((p) => ({
    i: p.globalIndex,
    u: Math.round(p.uv.x * 1e6) / 1e6,
    v: Math.round(p.uv.y * 1e6) / 1e6,
    channel: p.address.channel,
    chainIndex: p.address.chainIndex,
  }));

  writeFileSync(`${compiledDir}/${id}.meta.json`, JSON.stringify(meta, null, 2) + "\n");
  writeFileSync(
    `${compiledDir}/${id}.ledmap.json`,
    JSON.stringify({ layoutId: id, leds: ledmap }, null, 2) + "\n",
  );
  writeBin(`${compiledDir}/${id}.bin`, gpios, ledsPerLine);
  writeHeader(`${fwGen}/glowbe_layout.h`, id, gpios, ledsPerLine, layoutHash);

  return {
    layoutId: id,
    layoutHash,
    ledCount: placements.length,
    dataLineCount: gpios.length,
    gpios,
    ledsPerLine,
  };
}
