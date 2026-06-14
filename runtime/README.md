# Glowbe Runtime

Phase 1: 60 fps ループ出力 + Glowbe Wire UDP + HTTP 状態 API。

## ビルド

```bash
# 要: Rust toolchain + C linker (build-essential / gcc)
cargo build --release
```

## 実行

リポジトリルートで `config.toml` を用意:

```bash
cp ../config.example.toml ../config.toml
# device.esp_ip を ESP の IP にするか、省略して mDNS（`_glowbe._udp`）
cargo run -- ../config.toml
```

任意 `[assets].compiled_dir` / `[assets].sequences_dir` で `assets/compiled` と `assets/sequences` の場所を指定可能（リポジトリ外デプロイ）。

## Phase 2: 静止画 → 1フレームシーケンス

```bash
# リポジトリルートから
cargo run --manifest-path runtime/Cargo.toml -- \
  convert-image /path/to/equirectangular.png sequence-id config.toml
```

出力: `assets/sequences/<sequence-id>/manifest.json` と `frames.bin`。生成後は runtime 起動中に `POST /api/v1/loop/select` で選択できる。

## エンドポイント

| 用途 | ポート |
|------|--------|
| FRAME 送信 | UDP 49152 → ESP |
| STATUS 受信 | UDP 49153 ← ESP |
| `GET /api/v1/state` | HTTP 8080 |
| `GET /health` | HTTP 8080（出力ループ停止時 503） |
| `POST /api/v1/mode` | HTTP 8080（`idle` / `loop` / `ripple`） |
| `POST /api/v1/loop/select` | HTTP 8080（生成済みシーケンス選択） |
| `GET /api/v1/sequences` | HTTP 8080（生成済みシーケンス一覧） |
| `GET /api/v1/layout/uv` | HTTP 8080（LED UV マップ） |
| `GET /api/v1/ws` | WebSocket 8080（`state` 約 1s、`ping`/`pong`、`ripple` UV 波紋を送出フレームに合成、`subscribe_preview` で JPEG `preview_frame`） |

`/api/v1/state` の JSON は camelCase（`frameLoopStaleMs`, `layoutMismatch`, `framesSent` 等）。

## モジュール

| ファイル | 役割 |
|----------|------|
| `config.rs` | `config.toml` 読み込み（`esp_ip` 任意、`[assets]`） |
| `wire.rs` | FRAME エンコード / STATUS パース（20 バイト拡張） |
| `pattern.rs` | ループ用テストパターン（論理 RGB） |
| `metrics.rs` | ホットパス用 atomics（fps、tick 鮮度） |
| `discover.rs` | mDNS `_glowbe._udp` |
| `output.rs` | フレームループ（送信失敗耐性・再接続）+ STATUS |
| `api.rs` | axum HTTP |
| `media.rs` | 正距円筒画像→シーケンス変換 / シーケンス読み込み |
| `state.rs` | `SharedApp`（metrics + RwLock 状態） |
