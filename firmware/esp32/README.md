# Glowbe ESP32 firmware

UDP で RGB フレームを受信し、NeoPixelBus **I2S0 並列**で WS2812 系 LED を駆動します。

| Layout ID | LEDs | Data lines | PlatformIO env |
|-----------|------|------------|----------------|
| `icosahedron-15` | 225 | 5 | `15panels` |
| `geodesic-2v-60` | 1260 | 10 | `60panels` |

## Setup

```bash
cd firmware/esp32
cp include/wifi_config.h.example include/wifi_config.h
cp glowbe.firmware.env.example glowbe.firmware.env
# edit wifi_config.h and glowbe.firmware.env
uv sync
```

`glowbe.firmware.env` は `pio run` / `pio upload` のたびに自動読み込み（シェルで export 済みの変数が優先）。

`uv sync` で PlatformIO と esptool 依存（`intelhex`）を venv に入れます。

Compile layout headers (from repo root):

```bash
npx tsx tools/layout-compile.ts config/layouts/presets/icosahedron-15.layout.json
npx tsx tools/layout-compile.ts config/layouts/presets/geodesic-2v-60.layout.json
```

## Build & flash

```bash
uv run pio run -e 15panels -t upload
uv run pio run -e 60panels -t upload
uv run pio run -e 15panels-rainbow -t upload
uv run pio run -e 60panels-rainbow -t upload
```

Optional: cap all-white current in `glowbe.firmware.env` (default **3200 mA**, **16 mA/LED** white). The file is loaded on every build; override per session with `export GLOWBE_MAX_CURRENT_MA=...` if needed.

See [`docs/ENV.md`](../../docs/ENV.md).

## LED driver

- **I2S0 parallel** (`NeoEsp32I2s0X8Ws2812xMethod`; more than 8 lines uses **X16**). The 60panels layout (10 strips) selects the X16 template.
- Implementation: `src/led_driver.cpp`, shared helpers in `include/led_driver_parallel.h`.
- Logical RGB from the runtime is written as **GRB** on the strip (`NeoGrbFeature`).

See [`docs/firmware/LED-OUTPUT.md`](../../docs/firmware/LED-OUTPUT.md).

## Limits

- ESP `FrameAssembler` currently holds up to **4096** RGB bytes (~**1365** LEDs). The 60panels layout at **1260** LEDs fits; larger layouts need firmware changes.
