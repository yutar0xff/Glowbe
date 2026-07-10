# LED 出力方式（ESP32）

Glowbe ファームウェアは **ESP32（無印）** 上で、NeoPixelBus の **I2S0 並列**転送により複数の WS2812 系データ線を同時駆動する。

## 方式

| PlatformIO env | Layout | Method | ソース |
|----------------|--------|--------|--------|
| `15panels` | `icosahedron-15` (5 lines) | `NeoEsp32I2s0X8Ws2812xMethod` | `src/led_driver.cpp` |
| `60panels` | `geodesic-2v-60` (10 lines) | `NeoEsp32I2s0X16Ws2812xMethod` | 同上 |

I2S0 ペリフェラル + DMA で、8〜16 本規模の GPIO から同時にビットストリームを出力する。CPU 負荷を抑えつつマルチライン出力を実現する定番構成。

## 色順

ランタイム → UDP のペイロードは **論理 RGB**（R, G, B）。ファームは `NeoGrbFeature` でストリップ RAM に書き込む（SK6805 等 GRB 系）。

## 輝度上限（電流キャップ）

`include/glowbe_brightness.h` で、全白フレーム時の電流を頭打ちにするグローバル係数 `kGlowbeLedBrightness`（0–255）をコンパイル時に決める。

- LED 白: **16 mA/個**
- 上限電流: `firmware/esp32/glowbe.firmware.env` の **`GLOWBE_MAX_CURRENT_MA`**（ビルド時自動読み込み、既定 3200 mA）
- 式: `scale = min(255, 255 × maxMa / (GLOWBE_LED_COUNT × 16))`

ランタイムの `masterBrightness` はこの係数にさらに乗算される。

## ビルド例

```bash
cd firmware/esp32
uv sync
uv run pio run -e 15panels -t upload
uv run pio run -e 60panels -t upload
```

レイアウトヘッダは `include/generated/<layout-id>/glowbe_layout.h`。各 env の `-I include/generated/...` で選択する。
