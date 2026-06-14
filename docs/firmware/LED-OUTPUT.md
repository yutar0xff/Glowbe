# LED 出力方式（ESP32 無印 vs ESP32-S3）

Glowbe ファームは **チップ世代で LED 駆動方式を分ける**。無印向けの定石を S3 にそのまま適用しない。

## 正確な表現（他者への説明用）

**ESP32-S3 では I2S ではなく、LCD ペリフェラル（Intel 8080 バス互換 / I8080）を利用した DMA パラレル転送によって、複数データ線への同時出力を行う。**

**ESP32 無印では I2S ペリフェラルを用いた DMA パラレル転送**（NeoPixelBus の `NeoEsp32I2s0X8Ws2812xMethod` 系）で複数データ線を同期送出する。

実装は **Makuna/NeoPixelBus**（`makuna/NeoPixelBus`）。S3 は `NeoEsp32LcdX8Ws2812xMethod` / `NeoEsp32LcdX16Ws2812xMethod`、無印は `NeoEsp32I2s0X8Ws2812xMethod` / `NeoEsp32I2s0X16Ws2812xMethod`（**I2S0 を明示**）。データ線が 8 本を超えるレイアウトでは自動的に X16 側の型を選ぶ（`GLOWBE_DATA_LINES > 8`）。

## 1. 古い認識の否定

従来の **ESP32（無印）** では、I2S ペリフェラルを転用して LED のパラレル出力を実現する手法（archived-Glowbe の I2SClocklessLedDriver 等）が広く使われた。

**ESP32-S3 にそのまま同じ考え方を適用するのは誤り。** 内部バス構成が異なり、S3 では LCD ペリフェラル + DMA が並列出力の正攻法である。

## 2. ハードウェアの真実（S3）

ESP32-S3 で多ピンを低 CPU 負荷で駆動するには、内蔵 **LCD ペリフェラル（8080 系）** を使う。DMA がメモリ上のバッファから LCD ペリフェラルへ転送し、**8〜16 本規模の GPIO から同時にビットストリームを出力**できる。

## 3. ソフトウェア（本リポジトリ）

| ターゲット | PlatformIO env | 実装 | ソース |
|------------|----------------|------|--------|
| **ESP32-S3** | `prototype` | NeoPixelBus **LCD** 並列（`NeoEsp32LcdX8/X16Ws2812xMethod`） | `src/led_driver_s3.cpp` |
| **ESP32 無印** | `prototype-esp32` | NeoPixelBus **I2S0** 並列（`NeoEsp32I2s0X8/X16Ws2812xMethod`） | `src/led_driver_esp32.cpp` |

### データ線とバッファ

- レイアウトの各データ線ごとに `NeoPixelBus<NeoGrbFeature, Method>(count, pin)` を生成し、`Begin()` / `SetPixelColor()` / `Show()` を共通 API で扱う（公式例: `NeoPixel_ESP32_LcdParallel`）。
- UDP フレームの **論理 RGB** は `GLOWBE_LINE_LED_COUNTS` の順に各ストリップへ割り当てる（一次元インデックスと一致）。

### ESP32 無印でチラつきが出る場合

- **UDP**: `main.cpp` で受信キューをドレインし、**完全フレームが揃ったときだけ** LED を更新する。欠落・遅延時は **前フレームを保持**（受信途絶で消灯しない）。
- **プレイアウト遅延（ジッタバッファ）**: `include/glowbe_playout.h` の `GLOWBE_PLAYOUT_LAG_FRAMES`（既定 `2`）で、表示を数フレーム遅らせてバースト吸収する。`0` で無効。`GLOWBE_PLAYOUT_RING_CAP` はバースト用のリング深さ（既定 `8`）。ビルド上書きは `platformio.ini` の `build_flags` に `-D GLOWBE_PLAYOUT_LAG_FRAMES=0` 等。
- **I2S 占有**: I2S0 を LED 用に使うため、同一ペリフェラルを使う I2S オーディオ等とは併用できない。

### ESP32-S3 での併用注意

- **LCD ペリフェラル**を使うため、内蔵 LCD 等と競合しないよう配線・ソフト構成を確認する。

共通: UDP 受信・フレーム組み立ては `main.cpp` + `glowbe_wire.h`。  
ピンと本数は `tools/layout-compile.ts` が `glowbe_layout.h` に生成する。

## ビルド

```bash
# S3（届いたらこちらを本番）
uv run pio run -e prototype -t upload

# 手元の ESP32 無印（プロトタイプ検証）
uv run pio run -e prototype-esp32 -t upload
```

## 参照

- NeoPixelBus 例: `NeoPixel_ESP32_LcdParallel`（S3）
- NeoPixelBus ESP32 I2S 並列: `NeoEsp32I2s0X8Ws2812xMethod` 等（`src/internal/methods/NeoEsp32I2sXMethod.h`）
