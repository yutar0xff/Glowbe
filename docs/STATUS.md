# Glowbe — リリース概要

> **役割:** 本リリースに含まれる機能の一覧。  
> 設計: [`ARCHITECTURE.md`](ARCHITECTURE.md) · セットアップ: [`GETTING_STARTED.md`](GETTING_STARTED.md) · API: [`../protocol/control-api.md`](../protocol/control-api.md)

---

## 1. 概要

| 項目 | 内容 |
|------|------|
| ランタイム | ループクリップ・メディア変換・**mate** 顔レンダラ・HTTP/WS API |
| ファーム | ESP32 · UDP 受信 · NeoPixelBus I2S0 並列 · デュアルタスク（受信/表示） |
| Web | **Glowbe Studio** — Loop / Interactive / Idle / Mate · クリップ管理 · Chain profile エディタ |
| レイアウト | **15panels** `icosahedron-15`（225 LED）· **60panels** `geodesic-2v-60`（1260 LED） |
| ハードウェア | `hardware/pcb/` に EasyEDA **v2.2.47** の `.eprj`（Gerber はローカルエクスポート） |

---

## 2. コンポーネント

| コンポーネント | パス |
|----------------|------|
| Rust ランタイム | `runtime/` |
| Web クライアント | `web/` |
| ESP32 ファーム | `firmware/esp32/` |
| レイアウト・コンパイル | `config/layouts/`, `tools/layout-compile.ts`, `packages/core/` |
| プロトコル | `protocol/` |
| 基板 | `hardware/pcb/` |
| ベンチ | `tools/bench-udp.mjs`, [`BENCHMARK.md`](BENCHMARK.md) |

---

## 3. 出力モード

| モード | id | 概要 |
|--------|-----|------|
| Idle | `idle` | 黒フレーム送出 |
| ループ | `loop` | クリップを UV サンプリングして再生 |
| インタラクティブ | `interactive` | WS タップでリップル等 |
| Mate | `mate` | 60panels 向け SDF 顔（[`MATE.md`](MATE.md)） |
| Text | `text` | 球面テキストフロー |
| Audio Visualizer | `audio-visualizer` | PipeWire／タブ ingest → 球面シーン（Radial / Aurora / Orbital / Impact / Bars / Wobbly） |

---

## 4. 主な API

| エンドポイント | 用途 |
|----------------|------|
| `GET /api/v1/state` | 状態・fps・レイアウト |
| `POST /api/v1/mode` | モード切替 |
| `GET/POST /api/v1/layouts/*` | レイアウト catalog・CRUD・コンパイル |
| `GET /api/v1/clips` · `POST /api/v1/loop/select` | クリップ一覧・再生選択 |
| `POST /api/v1/media/*` | 画像/ZIP/動画 → クリップ変換 |
| `GET /api/v1/mate/*` · WS `mate` | 表情・呼吸・ライブ制御 |
| `GET/POST /api/v1/audio/*` | PipeWire 入力・ビジュアライザー |
| `GET /api/v1/ws` | state · interactive · preview · layout UV |

詳細: [`protocol/control-api.md`](../protocol/control-api.md)

---

## 5. プロトコルメモ

- **論理 RGB**（R,G,B）で FRAME 送出。GRB 変換はファームの NeoPixelBus が担当。
- **STATUS** 20 バイト推奨（末尾 `layout_hash`）。不一致時 `layoutMismatch`。
- 欠落フレーム時は前フレーム保持（自動消灯しない）。

---

## 6. セットアップ

[`GETTING_STARTED.md`](GETTING_STARTED.md) を参照。

**運用上の注意:**

- ESP32 ファームは NeoPixelBus I2S0 並列（[`firmware/LED-OUTPUT.md`](firmware/LED-OUTPUT.md)）。
- ピクセルはランタイムのみが生成する（単一ライター原則）。
- Mate は **60panels**（`geodesic-2v-60`）のみ。15panels では提供しない。
