#!/usr/bin/env npx tsx
/**
 * Compile glowbe-layout v1 → UV map, binary meta, and firmware header.
 *
 * Usage:
 *   npx tsx tools/layout-compile.ts config/layouts/presets/icosahedron-15.layout.json
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileGlowbeLayout } from "./layout-build-lib.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

function main(): void {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: npx tsx tools/layout-compile.ts <layout.json>");
    process.exit(2);
  }

  const layout = JSON.parse(readFileSync(input, "utf8"));
  const result = compileGlowbeLayout(layout, { repoRoot: REPO });

  console.log(
    `Compiled ${result.layoutId}: ${result.ledCount} LEDs, ${result.dataLineCount} data lines`,
  );
  console.log(`  GPIO: ${result.gpios.join(", ")}`);
  console.log(`  per line: ${result.ledsPerLine.join(", ")}`);
  console.log(`  → assets/compiled/${result.layoutId}.*`);
  console.log(
    `  → firmware/esp32/include/generated/${result.layoutId}/glowbe_layout.h`,
  );
}

main();
