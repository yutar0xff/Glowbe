# AGENTS.md — @glowbe/core

This package is the **authoritative device model**. Changes here ripple to
Studio and firmware codegen.

- Define everything as **Zod schemas first**, infer TS types from them.
- All Rig types are **versioned** (`meta.schemaVersion`); add a migration when
  the schema changes — never break old saved Rigs.
- Geometry math must be **pure and unit-tested** (no DOM, no Three.js types in
  the public API — return plain `{x,y,z}` / arrays).
- Equirectangular UV convention: `u = (lon+π)/2π`, `v = (π/2 − lat)/π`.
- Ask before changing any exported type signature (it is a cross-cutting break).

See `../../docs/data-model.md` for the schema sketch.
