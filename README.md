# Glowbe

サーバ権威型の LED 球体プラットフォーム（v2）。

- 設計（あるべき姿）: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- 実装状況・引き継ぎ（正本）: [`docs/STATUS.md`](docs/STATUS.md)

## リポジトリ構成

| パス | 内容 |
|------|------|
| `runtime/` | Rust 常駐サーバ（Phase 1: ループ出力 + HTTP API） |
| `web/` | Vite + React 制御 UI（未実装） |
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

### 4. ベンチ

[`docs/BENCHMARK.md`](docs/BENCHMARK.md) 参照。最低 **60 fps × 5 分**（プロトタイプ・2.4 GHz）。

## 次の開発ステップ

Phase 1 は UDP E2E 成功扱い。次は Phase 1 の締め（60fps ベンチ記録・残 API）を進め、その後 Phase 2 として **正距円筒の静止画 1 枚 → LED フレーム** の最小パイプラインへ。具体タスクは [`docs/STATUS.md`](docs/STATUS.md) の §7。

## 開発要件

- Node 20+（`layout-compile`）
- Rust toolchain（ランタイム）
- PlatformIO（ファーム）

## ライセンス

TBD
