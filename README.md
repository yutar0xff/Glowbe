# Glowbe

サーバ権威型の LED 球体プラットフォーム（v2）。

- 設計（あるべき姿）: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- 実装状況・引き継ぎ（正本）: [`docs/STATUS.md`](docs/STATUS.md)

## リポジトリ構成

| パス | 内容 |
|------|------|
| `runtime/` | Rust 常駐サーバ（Phase 1: ループ出力 + HTTP API） |
| `web/` | Vite + React ダッシュボード（Phase 1.5: 状態表示 + `idle`/`loop` 切替） |
| `firmware/esp32s3/` | ESP32-S3 ファーム |
| `config/layouts/` | LED レイアウト（`glowbe-layout` v1） |
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
- HTTP **8080** — `GET /api/v1/state`（`fpsOut`, `fpsRx`, `frameLoopStaleMs`, `layoutMismatch` 等）
- `GET /health` — 出力ループが 1s 以上止まっていると **503**
- ESP から STATUS **49153** を受信（20 バイト推奨、`layout_hash` 含む）

### 4. Web ダッシュボード（Phase 1.5）

```bash
cd web && npm install
npm run dev
```

既定では Vite dev server が `/api` と `/health` を `http://127.0.0.1:8080` にプロキシします。別ホストの場合は `GLOWBE_RUNTIME_URL=http://<runtime-host>:8080 npm run dev`、またはビルド時に `VITE_GLOWBE_API_BASE` を設定します。

### 5. 静止画からシーケンス生成（Phase 2）

```bash
cargo run --manifest-path runtime/Cargo.toml -- \
  convert-image /path/to/equirectangular.png sequence-id config.toml
```

生成後、runtime 起動中に `POST /api/v1/loop/select` で `sequenceId` を選択すると loop モードで再生します。

### 6. ベンチ

[`docs/BENCHMARK.md`](docs/BENCHMARK.md) 参照。最低 **60 fps × 5 分**（プロトタイプ・2.4 GHz）。

## 次の開発ステップ

Phase 2 の最小パイプライン（正距円筒静止画 → 1フレームシーケンス → `loop/select` 再生）まで実装済み。次は 60fps ベンチ記録、Web からのシーケンス選択 UI、`GET /api/v1/sequences` / アップロード API へ進む。具体タスクは [`docs/STATUS.md`](docs/STATUS.md) の §7。

## 開発要件

- Node 20+（`layout-compile` / `web`）
- Rust toolchain（ランタイム）
- PlatformIO（ファーム）

## ライセンス

TBD
