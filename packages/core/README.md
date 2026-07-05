# @glowbe/core

The **single source of truth** for device geometry and LED layout (the "Rig").

- Zod schemas + inferred TypeScript types for the Rig (see
  [`../../docs/data-model.md`](../../docs/data-model.md)).
- Polyhedron geometry generators (icosahedron, geodesic 2V, …).
- LED placement math: in-face patterns (zigzag/parallel) → per-LED 3D position,
  normal, equirectangular UV, and physical address.
- Calibration export + firmware header codegen helpers.

Consumed by `apps/studio` (editing + preview) and `tools` (firmware codegen).
**Do not duplicate these types elsewhere.**

> Not yet implemented — created during Phase 0. See `../../docs/roadmap.md`.
