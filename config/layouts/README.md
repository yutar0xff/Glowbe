# LED layouts (`glowbe-layout` v1)

Canonical wiring and geometry definitions for runtime and firmware.

## Storage

| Kind | Source JSON | Compiled output | Git |
|------|-------------|-----------------|-----|
| Preset | `config/layouts/presets/<id>.layout.json` | `assets/compiled/<id>.*` + `firmware/esp32/include/generated/<id>/` | Yes (source + preset compiled) |
| User (custom chain profile) | `assets/layouts/user/<id>.layout.json` | Same paths as presets | No (`assets/layouts/user/` is gitignored) |

Schema: [`protocol/glowbe-layout.schema.json`](../../protocol/glowbe-layout.schema.json)

## Presets (git)

| File | `id` |
|------|------|
| [`presets/geodesic-2v-60.layout.json`](presets/geodesic-2v-60.layout.json) | `geodesic-2v-60` |
| [`presets/icosahedron-15.layout.json`](presets/icosahedron-15.layout.json) | `icosahedron-15` |

Custom profiles are created in Studio via **Chain profile → Create new** and saved on first **Save**.

## Format (summary)

```json
{
  "format": "glowbe-layout",
  "version": 1,
  "id": "geodesic-2v-60",
  "variant": "geodesic-2v-60",
  "geometry": { "preset": "geodesic-ico-2v", "radiusMm": 50, "disabledFaceIds": [] },
  "face": { "ledCount": 21, "pattern": "zigzag", "paddingMm": 2.1 },
  "wiring": {
    "chip": "SK6805",
    "colorOrder": "GRB",
    "dataLines": [{ "gpio": 13, "faceChain": ["face-24"], "faceRotations": {}, "reversedFaces": [] }]
  }
}
```

Face vertex coordinates are derived at compile time from `geometry.preset` and `disabledFaceIds`.

## Compile / save

**Studio save** writes source JSON and compiled artifacts in one step (no separate compile action for operators).

Developer / CI:

```bash
npx tsx tools/layout-compile.ts config/layouts/presets/icosahedron-15.layout.json
npx tsx tools/layout-compile.ts config/layouts/presets/geodesic-2v-60.layout.json
```

Runtime uses `npx tsx tools/layout-build.mjs` (stdin IPC) on `PUT /api/v1/layouts/{id}/source`.

## Import from archived studio format

```bash
node tools/migrate-studio-layout.mjs <studio.json> <out.layout.json> geodesic-2v-60|icosahedron-15
```

Or `POST /api/v1/layouts/import` from Studio.

## Firmware

Each PlatformIO env prepends `-I include/generated/<layout-id>` so `#include "glowbe_layout.h"` resolves to the matching profile. Reflash after changing a device’s chain profile.
