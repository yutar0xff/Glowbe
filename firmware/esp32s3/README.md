# Glowbe ESP32 / ESP32-S3 ファーム

プロトタイプレイアウト: `prototype-icosahedron-15`（225 LED、5 線）

## セットアップ

```bash
npx tsx tools/layout-compile.ts config/layouts/prototype.layout.json
cd firmware/esp32s3
uv sync
cp include/wifi_config.h.example include/wifi_config.h  # 2.4 GHz SSID を設定
```

## ビルド / フラッシュ

| ボード | env |
|--------|-----|
| ESP32-S3 | `prototype` |
| ESP32 無印 | `prototype-esp32` |

```bash
uv run pio run -e prototype-esp32 -t upload
uv run pio device monitor
```

## 動作

- **UDP FRAME 受信:** ワイヤ RGB を LED に適用
- **ESP32 無印 (`prototype-esp32`):** FastLED **I2S-parallel**（`FASTLED_ESP32_I2S`、DMA バッファ数は `platformio.ini` 参照）
- **初回フレーム受信前の 3 秒無受信:** 待機テストパターン（50ms、正回転）
- **初回フレーム受信後のリンク切れ:** 最後の表示を残さず黒へフォールバック
- ポート **49152**（[`protocol/udp-wire.md`](../../protocol/udp-wire.md)）

```bash
# Phase 1 推奨: Rust ランタイム
cd runtime && cargo run -- ../config.toml

# または単体ベンチ
node tools/bench-udp.mjs <serial-monitorのIP> 60
```

LED 駆動の詳細: [`docs/firmware/LED-OUTPUT.md`](../../docs/firmware/LED-OUTPUT.md)
