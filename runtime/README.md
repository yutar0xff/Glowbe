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

任意 `[assets].compiled_dir` で `assets/compiled` の場所を指定可能（リポジトリ外デプロイ）。

## エンドポイント

| 用途 | ポート |
|------|--------|
| FRAME 送信 | UDP 49152 → ESP |
| STATUS 受信 | UDP 49153 ← ESP |
| `GET /api/v1/state` | HTTP 8080 |
| `GET /health` | HTTP 8080（出力ループ停止時 503） |

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
| `state.rs` | `SharedApp`（metrics + RwLock 状態） |
