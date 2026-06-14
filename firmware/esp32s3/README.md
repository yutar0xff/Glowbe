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
- **ESP32-S3 (`prototype`):** NeoPixelBus **LCD 並列**（`NeoEsp32LcdX8Ws2812xMethod` / 8 本超は X16）
- **ESP32 無印 (`prototype-esp32`):** NeoPixelBus **I2S0 並列**（`NeoEsp32I2s0X8Ws2812xMethod` / 8 本超は X16）
- **起動直後:** `setup` で一度消灯し、最初の **完全フレーム** を受信してから表示を開始する。
- **受信途絶:** ファームは **最後に表示したフレームを保持**（リンクタイムアウトで消灯しない）。`idle` モードでランタイムが送る黒フレームはそのまま表示される。
- **プレイアウト:** 既定で数フレームのジッタバッファ（`glowbe_playout.h`）。無効化はファームの `build_flags` に `-D GLOWBE_PLAYOUT_LAG_FRAMES=0`。
- ポート **49152**（[`protocol/udp-wire.md`](../../protocol/udp-wire.md)）

```bash
# Phase 1 推奨: Rust ランタイム
cd runtime && cargo run -- ../config.toml

# または単体ベンチ
node tools/bench-udp.mjs <serial-monitorのIP> 60
```

LED 駆動の詳細: [`docs/firmware/LED-OUTPUT.md`](../../docs/firmware/LED-OUTPUT.md)
