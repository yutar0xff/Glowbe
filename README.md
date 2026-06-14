# Glowbe

サーバ権威型の LED 球体プラットフォーム（v2）。

- 設計（あるべき姿）: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- 実装状況・引き継ぎ（正本）: [`docs/STATUS.md`](docs/STATUS.md)
- 環境変数: [`docs/ENV.md`](docs/ENV.md)

## リポジトリ構成

| パス | 内容 |
|------|------|
| `runtime/` | Rust 常駐サーバ（Phase 1: ループ出力 + HTTP API） |
| `web/` | Vite + React（`/` ステータス、`/mode` で Idle トグル + 各モード、`/mode/loop`・`/mode/interactive`、英語 UI） |
| `firmware/esp32s3/` | ESP32-S3 ファーム |
| `config/layouts/` | LED レイアウト（`glowbe-layout` v1） |
| `docs/DEV.md` | 開発時の注意（ランタイム+Web、ESP、ポート） |
| `docs/ENV.md` | 環境変数（Web / systemd） |
| `protocol/` | UDP・API・シーケンス仕様 |
| `tools/` | レイアウトコンパイル等 |

旧版: [archived-glowbe](https://github.com/yutar0xff/archived-glowbe)

## クイックスタート（プロトタイプ）

### 1. レイアウトコンパイル

```bash
npx tsx tools/layout-compile.ts config/layouts/prototype.layout.json
```

→ `assets/compiled/prototype-icosahedron-15.*`、`firmware/esp32s3/include/glowbe_layout.h`

### 2. ファーム（スパイク）

```bash
cd firmware/esp32s3 && uv sync
cp include/wifi_config.h.example include/wifi_config.h
# wifi_config.h を編集
uv run pio run -e prototype -t upload
```

### 3. ランタイム（Phase 1）

```bash
cp config.example.toml config.toml
# 手動 IP: device.esp_ip = "..."（シリアル diag の ip=...）
# または esp_ip を省略して mDNS（同一 LAN、ESP が _glowbe._udp を広告）

cd runtime && cargo run -- ../config.toml
```

- UDP **49152** で FRAME 送信（60 fps、**論理 RGB**）
- HTTP **`config.toml` の `[server] bind` ポート**（既定例 **8748**）— `GET /api/v1/state`（`fpsOut`, `fpsRx`, `frameLoopStaleMs`, `layoutMismatch` 等）
- `GET /health` — 出力ループが 1s 以上止まっていると **503**
- ESP から STATUS **49153** を受信（20 バイト推奨、`layout_hash` 含む）

### 4. Web ダッシュボード（Phase 1.5）

```bash
cd web && npm install
npm run dev
```

- 環境変数: [`docs/ENV.md`](docs/ENV.md) · 開発の注意: [`docs/DEV.md`](docs/DEV.md)

既定では `web/.env.development` の `GLOWBE_RUNTIME_URL`（`http://127.0.0.1:8748`）へプロキシします。上書きは `web/.env.development.local` か、一時的に `GLOWBE_RUNTIME_URL=... npm run dev`。静的ビルドで別オリジンへ API がある場合はビルド時に `VITE_GLOWBE_API_BASE`（[`docs/ENV.md`](docs/ENV.md)）。

### 5. 静止画からシーケンス生成（Phase 2）

```bash
cargo run --manifest-path runtime/Cargo.toml -- \
  convert-image /path/to/equirectangular.png sequence-id config.toml
```

生成後、runtime 起動中に Web ダッシュボードの Sequences から選択するか、`POST /api/v1/loop/select` で `sequenceId` を選択すると loop モードで再生します。

### 6. ベンチ

[`docs/BENCHMARK.md`](docs/BENCHMARK.md) 参照。最低 **60 fps × 5 分**（プロトタイプ・2.4 GHz）。

## 次の開発ステップ

Phase 2: 正距円筒 **単一画像** および **ZIP 連番**（最大 3600 フレーム）→ シーケンス、REST **`/api/v1/media/*`**、**`displayName`**（変換時指定 + **`PATCH /api/v1/sequences/:id`**）、Studio の **UV 散布プレビュー** と WS **`getLayoutUv` / `layoutUv`**。次は **動画** 変換・進捗のより細かい割合・60fps ベンチ記録。具体タスクは [`docs/STATUS.md`](docs/STATUS.md) の §7。

## 開発要件

- Node 20+（`layout-compile` / `web`）
- Rust toolchain（ランタイム）
- PlatformIO（ファーム）

## ライセンス

TBD
