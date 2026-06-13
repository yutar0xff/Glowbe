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
# device.esp_ip を ESP の IP に（シリアル diag: ip=...）
cargo run -- ../config.toml
```

## エンドポイント

| 用途 | ポート |
|------|--------|
| FRAME 送信 | UDP 49152 → ESP |
| STATUS 受信 | UDP 49153 ← ESP |
| `GET /api/v1/state` | HTTP 8080 |
| `GET /health` | HTTP 8080 |

`/api/v1/state` の JSON フィールドは `layoutId`, `fpsOut`, `fpsRx` など camelCase。

## モジュール

| ファイル | 役割 |
|----------|------|
| `config.rs` | `config.toml` 読み込み |
| `wire.rs` | FRAME エンコード / STATUS パース |
| `pattern.rs` | ループ用テストパターン（GRB） |
| `output.rs` | フレームループ + STATUS リスナ |
| `api.rs` | axum HTTP |
| `state.rs` | 共有ランタイム状態 |
