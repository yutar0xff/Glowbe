# LED 出力方式（ESP32 無印 vs ESP32-S3）

Glowbe ファームは **チップ世代で LED 駆動方式を分ける**。無印向けの定石を S3 にそのまま適用しない。

## 正確な表現（他者への説明用）

**ESP32-S3 では I2S ではなく、LCD ペリフェラル（Intel 8080 バス互換 / I8080）を利用した DMA パラレル転送によって、複数データ線への同時出力を行う。**

実装ではレジスタを直叩きせず、S3 の LCD ペリフェラル（または RMT）に対応した **FastLED**（`FASTLED_USES_ESP32S3_I2S`）が内部で DMA 転送を担う。ライブラリのマクロ名に `I2S` とあるが、**S3 上の実体は無印時代の「I2S ハックによるパラレル出力」とは別アーキテクチャ**である。

## 1. 古い認識の否定

従来の **ESP32（無印）** では、I2S ペリフェラルを転用して LED のパラレル出力を実現する手法（archived-Glowbe の I2SClocklessLedDriver 等）が広く使われた。

**ESP32-S3 にそのまま同じ考え方を適用するのは誤り。** 内部バス構成が異なり、S3 では LCD ペリフェラル + DMA が並列出力の正攻法である。

## 2. ハードウェアの真実（S3）

ESP32-S3 で多ピンを低 CPU 負荷で駆動するには、内蔵 **LCD ペリフェラル（8080 系）** を使う。DMA がメモリ上のバッファから LCD ペリフェラルへ転送し、**8〜16 本規模の GPIO から同時にビットストリームを出力**できる。

## 3. ソフトウェア（本リポジトリ）

| ターゲット | PlatformIO env | 実装 | ソース |
|------------|----------------|------|--------|
| **ESP32-S3** | `prototype` | LCD + DMA パラレル（FastLED `FASTLED_USES_ESP32S3_I2S`） | `src/led_driver_s3.cpp` |
| **ESP32 無印** | `prototype-esp32` | **通常の RMT**（データ線ごと 1 チャンネル） | `src/led_driver_esp32.cpp` |

### ESP32 無印でチラつきが出る場合

- **時間ディザー**: `FastLED.setDither(0)`（本リポジトリで `glowbe_led_init` に設定済み）
- **UDP**: `main.cpp` で受信キューをドレインし、**最新の完了フレーム**を 1 回だけ `show()` する
- **補足**: FastLED 3.10 系は ESP32 で `FASTLED_ALLOW_INTERRUPTS=0` をビルド拒否するため、割り込み抑止マクロは使わない（Wi-Fi 共存はドレイン＋単回 `show` と電源で調整）

共通: UDP 受信・フレーム組み立ては `main.cpp` + `glowbe_wire.h`。  
配線マクロは `tools/layout-compile.ts` が `glowbe_layout.h` に生成する。

## ビルド

```bash
# S3（届いたらこちらを本番）
uv run pio run -e prototype -t upload

# 手元の ESP32 無印（プロトタイプ検証）
uv run pio run -e prototype-esp32 -t upload
```

## S3 開発時の注意（FastLED ドキュメントより）

- フラッシュ直後は **setup に短い delay** を入れると再書き込みしやすい場合がある
- シリアル `printf` が DMA と干渉する報告がある — 本番パスでは最小限に

## 参照

- FastLED 例: `Esp32S3I2SDemo`（`FASTLED_USES_ESP32S3_I2S`）
- 内包ドライバ: `I2SClockLessLedDriveresp32s3`（LCD HAL / `esp_lcd`）
