# Glowbe ESP32 / ESP32-S3 firmware

Layouts are compiled from `config/layouts/*.layout.json`. Headers live under **`include/generated/<layout-id>/glowbe_layout.h`** (not in `include/` root). Each PlatformIO environment prepends the matching `-I include/generated/...` so `#include "glowbe_layout.h"` resolves correctly.

| Layout id | LEDs | Data lines | Typical env |
|-----------|------|------------|-------------|
| `prototype-icosahedron-15` | 225 | 5 | `prototype`, `prototype-esp32` |
| `product-geodesic-2v-60` | 1260 | 10 | `product`, `product-esp32` |
| `product-geodesic-2v-60-s3-dev` | 1260 | 10 | `product-s3-dev`, `product-s3-dev-rainbow` |

## Setup

```bash
cd ../..   # repo root
npx tsx tools/layout-compile.ts config/layouts/prototype.layout.json
npx tsx tools/layout-compile.ts config/layouts/product.layout.json
cd firmware/esp32s3
uv sync
cp include/wifi_config.h.example include/wifi_config.h   # set 2.4 GHz SSID
```

## Build / flash

| Board | PlatformIO env |
|-------|----------------|
| ESP32-S3 | `prototype`, `product`, `product-s3-dev` |
| ESP32 (classic) | `prototype-esp32`, `product-esp32` |
| Wi-Fi なし虹色テスト | `*-rainbow`（`test/rainbow/`） |

```bash
uv run pio run -e prototype-esp32 -t upload
uv run pio run -e product-esp32 -t upload
uv run pio run -e product-s3-dev -t upload
uv run pio run -e product-s3-dev-rainbow -t upload
uv run pio device monitor
```

**Rule:** Flash firmware built with the **same** `glowbe_layout.h` (layout id + hash) that the runtime uses (`config.toml` `[device] layout_id` or `POST /api/v1/device/layout`). Otherwise `layout_mismatch` will appear in state and frames may be ignored.

## NeoPixelBus (parallel strips)

- **ESP32-S3 (`prototype` / `product`):** NeoPixelBus **LCD** multi-channel (`NeoEsp32LcdX8Ws2812xMethod`; more than 8 lines uses **X16**). See [Makuna/NeoPixelBus](https://github.com/Makuna/NeoPixelBus) for method constraints.
- **ESP32 classic (`prototype-esp32` / `product-esp32`):** **I2S0** parallel (`NeoEsp32I2s0X8Ws2812xMethod`; more than 8 lines uses **`NeoEsp32I2s0X16Ws2812xMethod`**). Product (10 strips) selects the X16 template.
- **One `NeoPixelBus` instance per GPIO** in [`src/led_driver_esp32.cpp`](src/led_driver_esp32.cpp) / S3 variant. Shared logic in [`include/led_driver_parallel.h`](include/led_driver_parallel.h): logical RGB is split by `GLOWBE_LINE_LED_COUNTS[]`; all lines use `GLOWBE_MAX_LINE_LEDS` with black padding on shorter chains.
- **SK6805 vs WS2812x:** layout JSON may specify `SK6805`; the sketch uses `NeoGrbFeature` with `Ws2812xMethod`. Bit timing is usually close enough for bring-up—verify colors and white on real hardware; switch to a SK6812-oriented feature class if needed.

## Glowbe Wire UDP (FRAME)

- **MTU:** keep each chunk ≤ **1440** RGB bytes so `16 + chunk` fits in one Ethernet frame (no IP fragmentation). Match runtime `MAX_CHUNK_PAYLOAD` and firmware `kMaxChunkPayload`.
- Port **49152** by default ([`protocol/udp-wire.md`](../../protocol/udp-wire.md)).
- Large layouts use **multiple datagrams per frame** (`chunk_count` = ceil(`led_count * 3` / **1440**)). Wi-Fi reordering is handled by chunk index; missing chunks keep the previous full frame.
- ESP `FrameAssembler` currently holds up to **4096** RGB bytes (~**1365** LEDs). Product at **1260** LEDs fits; larger layouts need firmware changes.

## Behaviour

- After boot, the firmware clears LEDs once, then updates only after a **complete** frame is assembled (partial frames keep the last image).
- **UDP recv** runs on **Core 0**, **LED show** on **Core 1** (`glowbe_stream_workers.cpp`), connected by a static FreeRTOS frame queue (`glowbe_frame_queue.h`, depth 3). `bringUp()` opens UDP once after Wi-Fi; avoid double `listen` at boot. Serial `diag` reports `applied=` (LED updates) vs `frames=` (complete UDP frames).
- **Static frames:** runtime skips UDP when RGB is unchanged; firmware skips `Show()` when a received frame matches the last projection. Serial `fps_x10` falls to **0** within about one second when no complete frames arrive (it is not `target_fps`).
- **Mode / scene change:** runtime re-sends several identical frames after a mode or tone change; firmware drops stale `frame_id` chunks and clears the playout ring when RGB content changes.
- **Link economy (idle):** after a static black frame is sent, runtime emits **LINK** `economy` and the ESP enables **Wi-Fi modem sleep** (`WiFi.setSleep(true)`). Leaving idle sends **LINK** `active` before frames. Association stays up; wake latency is typically ~100–300 ms. Serial diag shows `economy` when active. Override timeout with `-D GLOWBE_LINK_ECONOMY_AFTER_MS=2500` in `build_flags`.
- **Link loss:** last frame is held (no auto blackout). Black from runtime `idle` mode is a valid full frame.
- **Playout:** small jitter buffer by default (`glowbe_playout.h`); override with e.g. `-D GLOWBE_PLAYOUT_LAG_FRAMES=0` in `build_flags`.

More LED path notes: [`docs/firmware/LED-OUTPUT.md`](../../docs/firmware/LED-OUTPUT.md).
