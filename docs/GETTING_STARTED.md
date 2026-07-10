# はじめに / Getting started

Glowbe を手元で動かす手順です。環境変数は [`ENV.md`](ENV.md)、開発時の注意は [`DEV.md`](DEV.md) を参照してください。

---

## 1. レイアウトコンパイル（任意）

同梱済みの `assets/compiled/` と `firmware/esp32/include/generated/` があれば、再コンパイルなしでランタイム・ファームをビルドできます。

```bash
npx tsx tools/layout-compile.ts config/layouts/presets/icosahedron-15.layout.json
npx tsx tools/layout-compile.ts config/layouts/presets/geodesic-2v-60.layout.json
```

→ `assets/compiled/<layout-id>.*` と `firmware/esp32/include/generated/<layout-id>/glowbe_layout.h`

## 2. ファームウェア

```bash
cd firmware/esp32 && uv sync
cp include/wifi_config.h.example include/wifi_config.h
# wifi_config.h を編集
uv run pio run -e 15panels -t upload    # 15panels
uv run pio run -e 60panels -t upload    # 60panels
```

虹色テスト（Wi-Fi なし）: `15panels-rainbow` / `60panels-rainbow` — 詳細は [`firmware/esp32/README.md`](../firmware/esp32/README.md)

## 3. ランタイム

```bash
cp config.example.toml config.toml
# 必要なら [server] bind などを編集

cd runtime && cargo run -- ../config.toml
```

- 初回起動時、`assets/devices.json` が無ければ **デモ用 15 / 60 panels** 入りで自動作成される（`devices.json.example` と同内容）。以降は Studio または JSON 編集で管理（Git 管理外）。
- UDP **49152** — FRAME 送信
- HTTP（`config.toml` の `[server] bind`、例 **8748**）— `GET /api/v1/state`
- UDP **49153** — ESP から STATUS 受信

接続先は各デバイスの `mdnsHostname`（`_glowbe._udp`）または `espIp`。

## 4. Web（Glowbe Studio）

```bash
cd web && npm install && npm run dev
```

既定では `http://127.0.0.1:8748` へプロキシします（`web/.env.development`）。

## 5. メディアクリップ（任意）

ランタイムに `demo/expanding-rings` などのビルトインデモが同梱されています（Studio のクリップ一覧）。追加ファイルなしで Loop 再生できます。

```bash
cargo run --manifest-path runtime/Cargo.toml -- \
  convert-image /path/to/equirectangular.png clip-id config.toml
```

Studio の Loop タブ、または `POST /api/v1/loop/select` で再生します。

## 6. ベンチマーク

[`BENCHMARK.md`](BENCHMARK.md) — 15panels / 60panels で 60 fps × 5 分の目安。

## 要件

- Node 20+
- Rust toolchain
- PlatformIO（`uv` 推奨）
