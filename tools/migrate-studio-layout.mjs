#!/usr/bin/env node
/**
 * One-shot migrator: glowbe-studio-layout → glowbe-layout v1.
 * Usage: node tools/migrate-studio-layout.mjs <input.json> <output.json> <variant>
 */
import { readFileSync, writeFileSync } from "node:fs";

const [inputPath, outputPath, variant] = process.argv.slice(2);
if (!inputPath || !outputPath || !variant) {
  console.error("Usage: node migrate-studio-layout.mjs <in> <out> <product|prototype>");
  process.exit(2);
}

const src = JSON.parse(readFileSync(inputPath, "utf8"));
if (src.kind !== "glowbe-studio-layout") {
  console.error("Expected kind glowbe-studio-layout");
  process.exit(1);
}

const rig = src.rig;
const wiring = src.wiring ?? {};
const faceLayout = rig.faceLayouts?.[0] ?? {};
const chains = wiring.wirePinChains ?? [];
const gpios = wiring.wirePinGpio ?? [];
const rotations = wiring.wireFaceRotations ?? {};
const reversed = new Set(wiring.wireReversed ?? []);

const slug =
  variant === "product"
    ? "product-geodesic-2v-60"
    : variant === "prototype"
      ? "prototype-icosahedron-15"
      : variant;

const dataLines = chains.map((faceChain, i) => {
  const gpio = gpios[i];
  if (gpio == null) throw new Error(`Missing GPIO for chain ${i}`);
  const faceRotations = {};
  for (const fid of faceChain) {
    if (rotations[fid] != null) faceRotations[fid] = rotations[fid];
  }
  const reversedFaces = faceChain.filter((fid) => reversed.has(fid));
  return { gpio, faceChain, faceRotations, reversedFaces };
});

const out = {
  format: "glowbe-layout",
  version: 1,
  id: slug,
  displayName: rig.meta?.name ?? slug,
  variant,
  geometry: {
    preset: rig.solid?.preset ?? "unknown",
    radiusMm: rig.solid?.radius ?? 0,
    units: rig.meta?.units ?? "mm",
    disabledFaceIds: rig.solid?.disabledFaceIds ?? [],
  },
  face: {
    ledCount: faceLayout.ledCount ?? 0,
    pattern: faceLayout.pattern ?? "zigzag",
    paddingMm: faceLayout.paddingMm ?? faceLayout.padding ?? 0,
    chainMirrorLR: faceLayout.chainMirrorLR ?? true,
    ...(faceLayout.rowSizes ? { rowSizes: faceLayout.rowSizes } : {}),
  },
  wiring: {
    chip: "SK6805",
    colorOrder: "GRB",
    dataLines,
  },
  meta: {
    migratedAt: new Date().toISOString(),
    migratedFrom: `glowbe-studio-layout/${src.fileVersion}`,
    sourceMetaId: rig.meta?.id ?? null,
  },
};

writeFileSync(outputPath, JSON.stringify(out, null, 2) + "\n", "utf8");
console.log(`Wrote ${outputPath} (${out.id}, ${dataLines.length} data lines)`);
