# Hardware

PCB and 3D print files for Glowbe rigs.

**License:** [CERN-OHL-P-2.0](../LICENSE.hardware) (see also [LICENSES.md](../LICENSES.md)).

## Safety / electrical hazards

Glowbe hardware can draw **large currents** when many LEDs are on. Improper power supplies, thin wires, or poor distribution can cause **overheating or fire**.

- Read the [Zenn build guide — design trade-offs & limitations](https://zenn.dev/yutar0xff/articles/5795aef5f19e7f#設計時に考慮したこと・しきれなかったこと必読) before ordering boards or soldering.
- Use a supply rated for your target current; the author’s 60-panel build uses **5 V / 4 A** with firmware limiting peak draw (default **3.2 A** via `GLOWBE_MAX_CURRENT_MA`).
- PCB layouts and assembly notes in this repo are **not professionally reviewed**. Build and operate **at your own risk**.

## Layout variants

| Variant | Layout id | PCB | 3D print |
|---------|-----------|-----|----------|
| 15panels | `icosahedron-15` | [`pcb/icosahedron-15-revA/`](pcb/icosahedron-15-revA/) | [`mechanical/icosahedron-15/`](mechanical/icosahedron-15/) — one file |
| 60panels | `geodesic-2v-60` | [`pcb/geodesic-2v-60-revA/`](pcb/geodesic-2v-60-revA/) | [`mechanical/geodesic-2v-60/`](mechanical/geodesic-2v-60/) — one file |

## PCB (EasyEDA)

Designs were created with **EasyEDA v2.2.47**.

For now, only **`.eprj` project files** are tracked in Git. Export Gerber, BOM, and assembly outputs locally when you order boards; they are not committed yet.

| Rev | Source file |
|-----|-------------|
| `icosahedron-15-revA` | [`source/Glowbe-15panels.eprj`](pcb/icosahedron-15-revA/source/Glowbe-15panels.eprj) |
| `geodesic-2v-60-revA` | [`source/Glowbe-60panels.eprj`](pcb/geodesic-2v-60-revA/source/Glowbe-60panels.eprj) |

Open a project in EasyEDA (same major version when possible), then use **Fabrication → Gerber** (or your fab’s export flow) before upload to JLCPCB, PCBWay, etc.

## Mechanical

Place **one** print file per variant (`.stl`, `.3mf`, or similar):

```
mechanical/icosahedron-15/
mechanical/geodesic-2v-60/
```

Note material, layer height, and infill in the directory README when you add a model.

## Related docs

- [System design §12](../docs/ARCHITECTURE.md#12-ハードウェア)
- [LED wiring](../config/layouts/README.md)
- [Firmware flash](../firmware/esp32/README.md)
