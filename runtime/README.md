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

任意 `[assets].compiled_dir` / `[assets].sequences_dir` / `[assets].uploads_dir` で `assets/compiled`・`assets/sequences`・`assets/uploads` の場所を指定可能（リポジトリ外デプロイ）。

## Phase 2: 静止画 → 1フレームシーケンス

```bash
# リポジトリルートから
cargo run --manifest-path runtime/Cargo.toml -- \
  convert-image /path/to/equirectangular.png sequence-id config.toml
```

出力: `assets/sequences/<sequence-id>/manifest.json` と `frames.bin`。生成後は runtime 起動中に `POST /api/v1/loop/select` で選択できる。

## デモ: ランダム配置の expanding ring（合成シーケンス）

`icosahedron-15` の ledmap を前提に、Interactive と同じ **expanding ring** 数式で複数パルスを重ねた `frames.bin` を生成する（約 12.5 秒・30fps）。

```bash
# リポジトリルートから（第1引数省略時は id = demo-expanding-rings）
cargo run --manifest-path runtime/Cargo.toml -- gen-demo-expanding-rings demo-expanding-rings config.toml
```

`manifest.source.kind` は `synthetic-expanding-ring-demo`。グリッド用に `source-import.png`（グラデーションのプレースホルダ）も同梱される。

## エンドポイント

| 用途 | ポート |
|------|--------|
| FRAME 送信 | UDP 49152 → ESP |
| STATUS 受信 | UDP 49153 ← ESP |
| `GET /api/v1/state` | HTTP（`config.toml` の `[server] bind`、既定例 8748） |
| `GET /health` | 同上（出力ループ停止時 503） |
| `POST /api/v1/mode` | 同上（`idle` / `loop` / `interactive`） |
| `POST /api/v1/master-tone` | 同上（全モード共通の最終輝度・ガンマ） |
| `POST /api/v1/loop/select` | 同上（生成済みシーケンス選択） |
| `GET /api/v1/sequences` | 同上（一覧・任意 `displayName`） |
| `PATCH /api/v1/sequences/{sequenceId}` | 同上（`displayName` を manifest に反映） |
| `DELETE /api/v1/sequences/{sequenceId}` | 同上（シーケンスディレクトリを物理削除。再生中なら選択解除） |
| `GET /api/v1/sequences/{id}/source-frame/{i}` | 同上（ソースのフレーム i を PNG で返す） |
| `POST /api/v1/media/upload` | 同上（multipart `file`、PNG/JPEG/**ZIP**、本文 ~48MiB まで） |
| `POST /api/v1/media/{uploadId}/convert` | 同上（JSON `layoutId` / `fps` / 任意 `displayName` → 非同期に `up-{uploadId}` シーケンス。ZIP は最大 3600 フレーム） |
| `GET /api/v1/media/{uploadId}` | 同上（`stored` / `running` / `done` / `failed` と `sequenceId`） |
| `GET /api/v1/layout/uv` | 同上（LED UV マップ） |
| `GET /api/v1/ws` | WebSocket 同上（`state` 約 1s、`ping`/`pong`、**`getLayoutUv`** → **`layoutUv`**、`interactive` UV パルスを送出フレームに合成） |

`/api/v1/state` の JSON は camelCase（`frameLoopStaleMs`, `layoutMismatch`, `framesSent` 等）。

## モジュール

| ファイル | 役割 |
|----------|------|
| `config.rs` | `config.toml` 読み込み（`esp_ip` 任意、`[assets]`） |
| `wire.rs` | FRAME エンコード / STATUS パース（20 バイト拡張） |
| `sphere.rs` | 正距円筒 UV →単位球、大円角（リップル波面） |
| `pattern.rs` | ループ用テストパターン（論理 RGB、`ledmap` の UV に基づく色相） |
| `metrics.rs` | ホットパス用 atomics（fps、tick 鮮度） |
| `discover.rs` | mDNS `_glowbe._udp` |
| `output.rs` | フレームループ（送信失敗耐性・再接続）+ STATUS |
| `api.rs` | axum HTTP |
| `media.rs` | 正距円筒画像→シーケンス変換 / シーケンス読み込み |
| `state.rs` | `SharedApp`（metrics + RwLock 状態） |
