# @glowbe/core

Device geometry and LED layout math (the Rig model).

- Zod schemas and TypeScript types for rigs and face layouts
- Polyhedron generators (icosahedron, geodesic 2V, …)
- LED placement: in-face patterns → 3D position, normal, equirect UV, wiring address
- Layout compile helpers (firmware header export)

Used by `web/` (chain profile editor), `tools/layout-compile.ts`, and the runtime layout build IPC.
