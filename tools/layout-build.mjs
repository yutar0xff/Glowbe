#!/usr/bin/env node
/**
 * Runtime IPC entry: read JSON from stdin, compile layout, write stdout result.
 *
 * Input: { layout: GlowbeLayout, repoRoot: string }
 * Output: { ok: true, ...CompileResult } | { ok: false, error: string }
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));

async function main() {
  const raw = readFileSync(0, "utf8");
  let req;
  try {
    req = JSON.parse(raw);
  } catch {
    process.stdout.write(JSON.stringify({ ok: false, error: "invalid JSON stdin" }));
    process.exit(1);
    return;
  }

  try {
    const { compileGlowbeLayout } = await import("./layout-build-lib.ts");
    const repoRoot = req.repoRoot ?? join(__dir, "..");
    const result = compileGlowbeLayout(req.layout, { repoRoot });
    process.stdout.write(JSON.stringify({ ok: true, ...result }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stdout.write(JSON.stringify({ ok: false, error: msg }));
    process.exit(1);
  }
}

main();
