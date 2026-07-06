# Glowbe — システムアーキテクチャ

> **範囲:** システム設計（本ドキュメントは設計を記述する。機能一覧は [`STATUS.md`](STATUS.md)）  

---

## 目次

1. [概要](#1-概要)
2. [確定した設計方針](#2-確定した設計方針)
3. [目標・非目標・原則](#3-目標非目標原則)
4. [システムコンテキスト](#4-システムコンテキスト)
5. [モノレポ構成](#5-モノレポ構成)
6. [ランタイムサーバー（Rust）](#6-ランタイムサーバーrust)
7. [メディアパイプライン（正距円筒図法）](#7-メディアパイプライン正距円筒図法)
8. [通信プロトコル（自前 UDP）](#8-通信プロトコル自前-udp)
9. [サーバーモード（拡張可能）](#9-サーバーモード拡張可能)
10. [Web クライアント（Vite + React）](#10-web-クライアントvite--react)
11. [ESP32 ファームウェア](#11-esp32-ファームウェア)
12. [ハードウェア / PCB](#12-ハードウェア--pcb)
13. [LED レイアウト](#13-led-レイアウト)
14. [プレビュー経路](#14-プレビュー経路)
15. [クロスプラットフォーム運用](#15-クロスプラットフォーム運用)
16. [パフォーマンスモデル（2.4 GHz・60 fps 以上）](#16-パフォーマンスモデル24-ghz60-fps-以上)
17. [セキュリティ（完全オープン）](#17-セキュリティ完全オープン)
18. [観測・運用](#18-観測運用)

---

## 1. 概要

Glowbe は **サーバ権威型のリアルタイム LED 球体プラットフォーム**である。アニメーションフレームは **常駐ランタイム**（自宅 Ubuntu Server、展示用 Windows など）で合成され、**自前 UDP プロトコル**で **ESP32** へ送られる。スマホ・PC のブラウザは **設定・操作・プレビュー**に使い、タブを閉じても再生は止まらない。

```
┌──────────────┐  制御・アップロード・タップ   ┌─────────────────────┐
│ Web クライアント │ ────────────────────────► │ glowbe-runtime      │
│ (Vite+React) │ ◄── プレビュー（WS）───────── │ (Rust・常駐)        │
└──────────────┘                               │ ・モード合成         │
                                               │ ・メディア変換・保存  │
                                               └──────────┬──────────┘
                                                          │ 自前 UDP
                                                          ▼
                                               ┌─────────────────────┐
                                               │ ESP32 + LED リグ │
                                               │ Wi-Fi 2.4 GHz のみ   │
                                               └─────────────────────┘
```

**リポジトリ:** GitHub `Glowbe`。  
**モノレポに含めるもの:** ランタイム、Web、**ESP ファーム**、**PCB**、**3D プリントデータ**。

---

## 2. 確定した設計方針

| 項目 | 決定内容 |
|------|----------|
| LED レイアウト | **`glowbe-layout` v1** — [`geodesic-2v-60`](../config/layouts/presets/geodesic-2v-60.layout.json)（60panels）、[`icosahedron-15`](../config/layouts/presets/icosahedron-15.layout.json)（15panels） |
| ピクセル転送 | **完全自前 UDP**（Art-Net・TouchDesigner 連携は採用しない） |
| メディア | **正距円筒図法（equirectangular）** の画像・動画・コマ送りをアップロード → **サーバで LED フレーム列へ変換・保存** → ループ再生等で利用（TouchDesigner 連携なし） |
| Wi-Fi | **2.4 GHz のみ**（ESP 側）。**最低 60 fps** |
| ランタイム | **Rust** |
| Web | **Vite + React** |
| 認証 | **完全オープン**（LAN 内信頼前提） |
| リポジトリ名 | **Glowbe** |

---

## 3. 目標・非目標・原則

### 目標

| ID | 内容 |
|----|------|
| G1 | ブラウザを閉じてもアニメーションが継続する |
| G2 | Ubuntu Server と展示用 Windows の両方でランタイムが動く |
| G3 | ファーム・PCB を同一リポジトリで版管理する |
| G4 | 自前 UDP で最大パフォーマンス（60 fps 以上を維持） |
| G5 | モード: ループ再生、インタラクティブ、**mate**、**text**、idle |
| G6 | 正距円筒メディアのアップロードとサーバ側アニメーション資産化 |
| G7 | Web：UV プレビュー、タブ型統合ボード、プレビュー配信 |

### 非目標（v1）

| ID | 内容 |
|----|------|
| NG1 | 外部ピクセルプロトコル（Art-Net 等）との互換 |
| NG2 | 外部ツール（TouchDesigner 等）からのライブ取り込み |
| NG3 | クラウドピクセル中継 |
| NG4 | ブラウザ内タイムラインオーサリング（chain profile エディタ以外） |
| NG5 | 認証 |
| NG6 | クライアント（端末）マイク |

### 設計原則

1. **単一ライター:** ESP へ届くフレームはランタイムのみが生成する。
2. **3 プレーン分離:** 制御 / ピクセル / プレビュー。
3. **メディアはサーバで前処理:** ブラウザはアップロードとパラメータのみ。重い変換は常駐プロセス。
4. **レイアウトはデータ駆動:** `glowbe-layout` v1 → コンパイル済みテーブル。
5. **LED 出力:** **NeoPixelBus + I2S0 並列**（§11、[`firmware/LED-OUTPUT.md`](firmware/LED-OUTPUT.md)）。

---

## 4. システムコンテキスト

### 4.1 登場者

| 役割 | 責務 |
|------|------|
| **glowbe-runtime** | マスタークロック、モード合成、メディア変換ジョブ、資産保存、UDP 送信、プレビュー |
| **Web クライアント** | 操作 UI、メディアアップロード、UV タップ、プレビュー表示 |
| **ESP32** | UDP 受信、フレーム再構成、マルチライン LED 駆動 |
| **オペレータ** | ランタイム起動、USB フラッシュ、展示ネットワーク |

### 4.2 典型構成（自宅）

```
                    ┌─────────────────────────────────────┐
   Wi-Fi 2.4 GHz    │  Ubuntu Server（有線 LAN 推奨）      │
                    │  glowbe-runtime :8748  制御/プレビュー │
                    │                 :49152 UDP ピクセル    │
                    │  assets/         メディア・ループ保存    │
                    └──────────────┬──────────────────────┘
                                   │
              ┌────────────────────┴────────────────────┐
              ▼                                         ▼
        [スマホ / PC ブラウザ]                    [ESP32 球体]
```

### 4.3 論理レイヤ

```
┌─────────────────────────────────────────────────────────────┐
│ Web UI（Vite + React）                                       │
├─────────────────────────────────────────────────────────────┤
│ 制御 API — REST + WebSocket                                  │
├─────────────────────────────────────────────────────────────┤
│ メディアジョブ — 正距円筒 → LED フレーム列（オフライン/バッチ）  │
├─────────────────────────────────────────────────────────────┤
│ 合成 — モードプラグイン → 論理 RGB バッファ                     │
├─────────────────────────────────────────────────────────────┤
│ UDP 符号化・送信                                              │
├─────────────────────────────────────────────────────────────┤
│ ESP32 — 受信・マルチライン出力                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. モノレポ構成

```
Glowbe/
├── docs/
│   ├── ARCHITECTURE.md          # 本書（設計の正本）
│   ├── STATUS.md                # リリース機能一覧
│   ├── GETTING_STARTED.md
│   ├── BENCHMARK.md
│   └── firmware/LED-OUTPUT.md
├── config/
│   └── layouts/                 # glowbe-layout v1
├── protocol/
│   ├── glowbe-layout.schema.json
│   ├── udp-wire.md
│   ├── control-api.md
│   ├── glowseq.md
│   └── compiled-layout.md
├── runtime/                     # Rust 常駐サーバ
├── web/                         # Vite + React（Glowbe Studio）
├── firmware/esp32/
├── hardware/                    # PCB・3D プリント（[`hardware/README.md`](../hardware/README.md)）
│   ├── pcb/
│   └── mechanical/
├── packages/core/               # @glowbe/core（幾何・レイアウト）
├── tools/
│   ├── migrate-studio-layout.mjs
│   ├── layout-compile.ts        # レイアウト → コンパイル成果物 + ファームヘッダ
│   ├── bench-udp.mjs
│   └── listen-status.mjs
├── assets/
│   ├── uploads/                 # 生メディア（gitignore）
│   ├── sequences/               # 変換済みフレーム列（gitignore）
│   └── compiled/                # レイアウトバイナリ（コミット対象）
├── .github/workflows/ci.yml     # Rust fmt/clippy/test + Web lint/build
├── config.example.toml
└── README.md
```

> 各コンポーネントの実装/未実装の最新状況は [`STATUS.md`](STATUS.md) を参照（本ツリーは設計上の到達点を示す）。

---

## 6. ランタイムサーバー（Rust）

### 6.1 プロセス構成

| タスク | 役割 |
|--------|------|
| **フレームループ** | 固定周期 tick、モード合成、RGB バッファ |
| **UDP 送信** | 自前プロトコル、ペーシング、統計 |
| **制御サーバ** | HTTP + WebSocket |
| **メディアワーカー** | アップロード受付後、正距円筒→LED シーケンス変換（CPU、ffmpeg 等） |
| **プレビュー** | 縮小・JPEG、WS 配信 |
| **オーディオ** | サーバマイク（cpal） |

### 6.2 マスタークロック

- ループ・時計・インタラクティブ・マイクはすべて **サーバの単調時計**で駆動。
- クライアントの `requestAnimationFrame` は使用しない。

### 6.3 出力の単一化

すべてのピクセルはランタイム内のモードまたは **事前変換済みシーケンス**から生成する。

```
優先度（高 → 低）:
  1. 手動オーバーライド（ブラックアウト / テストパターン）
  2. アクティブモード（loop / interactive / mate / text）
  3. IDLE（フェードアウトまたは最終フレーム保持）
```

### 6.4 設定（`config.toml`）

**`config.toml` の主要キー**（正本: [`config.example.toml`](../config.example.toml) / `runtime/src/config.rs`）:

```toml
[device]
# esp_ip を省略（または空）→ 同一 LAN で mDNS `_glowbe._udp` を探索
esp_ip = "192.168.1.10"
layout_id = "icosahedron-15"

[assets]
# 省略時: リポジトリルートの `assets/compiled` / `assets/sequences`
# compiled_dir = "/var/lib/glowbe/compiled"
# sequences_dir = "/var/lib/glowbe/sequences"

[output]
udp_port = 49152
status_port = 49153   # ESP → ランタイム STATUS 受信（既定 49153）
target_fps = 60

[modes]
default = "loop"

[server]
bind = "0.0.0.0:8748"
```

### 6.5 電力・輝度・ガンマ

- **ファーム:** `kGlowbeLedBrightness` でグローバル輝度を抑える。全白時のブラウンアウトは電源・配線で確保。
- **ランタイム:** `POST /api/v1/master-tone` で全モード共通の輝度・ガンマ（[`protocol/control-api.md`](../protocol/control-api.md)）。

---

## 7. メディアパイプライン（正距円筒図法）

### 7.1 想定入力

| 種類 | 形式 | 備考 |
|------|------|------|
| 静止画 | PNG / JPEG | 2:1 の正距円筒（equirectangular）推奨 |
| 動画 | MP4 / WebM 等 | サーバで ffmpeg デコード |
| コマ送り | ZIP / 連番 PNG | 各フレームが正距円筒 |

アスペクトが 2:1 でない場合は **レターボックスまたはクロップ**（ポリシーを Web UI で選択）。

### 7.2 変換フロー

```
アップロード（Web）
    → assets/uploads/<id>/  に保存
    → ジョブキュー投入
    → レイアウトの LED UV テーブルで各フレームをサンプリング
    → assets/sequences/<id>/ にフレーム列保存（**生 RGB + manifest**。単一 `.glowseq` ファイルは当面採用しない。詳細は [`protocol/glowseq.md`](../protocol/glowseq.md)）
    → メタデータ JSON（fps、フレーム数、解像度、作成日時）
```

- 変換は **リアルタイム再生とは別スレッド/プロセス**で行い、フレームループをブロックしない。
- **ループ再生時の読み取り**も tick 内でディスク I/O を行わない（プリフェッチ／ダブルバッファ）。シーケンス fps と出力 60fps の対応は **最近傍ホールド**を既定とする（[`protocol/glowseq.md`](../protocol/glowseq.md)）。
- 完了後 Web から **ループモードで選択可能**にする。

### 7.3 サンプリング

- コンパイル済みレイアウトの **各 LED の UV 座標**（正距円筒上の u,v）から双線形補間で RGB を取得。
- UV マッピングは `@glowbe/core` とランタイム側で実装。

### 7.4 API（例）

| メソッド | パス | 用途 |
|----------|------|------|
| POST | `/api/v1/media/upload` |  multipart アップロード |
| GET | `/api/v1/media` | 一覧（変換状態含む） |
| GET | `/api/v1/media/:id` | メタデータ |
| POST | `/api/v1/media/:id/convert` | 変換ジョブ開始（fps 等パラメータ） |
| DELETE | `/api/v1/media/:id` | 削除 |

---

## 8. 通信プロトコル（自前 UDP）

ランタイム ↔ ESP 間は **Glowbe Wire Protocol v1**（詳細は `protocol/udp-wire.md` で固定）。

### 8.1 要件

| 要件 | 方針 |
|------|------|
| 60 fps @ 製品 LED 数 | MTU 安全サイズでチャンク分割 |
| 順序 | `chunk_index` / `chunk_count` |
| 識別 | マジック `GB`、メッセージ `FRAME` / `STATUS` |

### 8.2 フレーム（ランタイム → ESP）

```
magic, version, msg_type=FRAME
frame_id (uint32)
led_count (uint16)
chunk_index, chunk_count
payload: RGB 断片
```

全チャンク到着後に LED バッファを更新（ティアリング防止）。

### 8.3 制御プレーン（ランタイム ↔ Web）

| メソッド | パス | 用途 |
|----------|------|------|
| GET | `/api/v1/state` | モード、fps、レイアウト id |
| POST | `/api/v1/mode` | モード切替（下記 §9 参照） |
| POST | `/api/v1/loop/select` | シーケンス ID 選択 |
| GET | `/api/v1/layout/uv` | UV プレビュー用 |

WebSocket: `state` 通知は実装済み。リップルイベントとプレビューフレームは接続・未実装応答のみで、描画処理は後続。

---

## 9. サーバーモード（拡張可能）

```rust
trait Mode {
    fn id(&self) -> &'static str;
    fn tick(&mut self, ctx: &mut ModeContext, dt: Duration, out: &mut [Rgb]);
    fn on_event(&mut self, ctx: &mut ModeContext, event: ControlEvent);
}
```

### 9.1 ループ再生（`loop`）

- `assets/sequences/` の変換済みフレーム列を連続再生。
- メディアパイプライン（§7）の成果物が主な入力源。

### 9.2 インタラクティブ（`interactive`）

- 球面 UV 上のリップル。ブラウザタップ → WebSocket → サーバ上で減衰しながら継続。

### 9.3 Mate（`mate`）

- 60panels（`geodesic-2v-60`）向け SDF 顔レンダラ。詳細 [`MATE.md`](MATE.md)。

### 9.4 Text（`text`）

- 球面 UV 上をテキストが流れるモード。

### 9.5 モード切替 API

```json
POST /api/v1/mode
{ "mode": "loop" | "interactive" | "mate" | "text" | "idle" }
```

---

## 10. Web クライアント（Vite + React）

### 10.1 Studio タブ（Glowbe Studio）

| タブ | 内容 |
|------|------|
| **Loop** | クリップ選択・再生・アップロード |
| **Interactive** | UV マップ・タップでリップル |
| **Mate** | 表情プリセット・呼吸 |
| **Text** | 球面テキスト |
| **Devices** | ESP・レイアウト・Chain profile |

### 10.2 プレビュー

- メディアタブでは変換前の **正距円筒プレビュー**を表示可能（静的画像サムネ）。

---

## 11. ESP32 ファームウェア

### 11.1 マルチピン駆動

詳細: [`firmware/LED-OUTPUT.md`](firmware/LED-OUTPUT.md)

**ESP32:** **NeoPixelBus の I2S0 並列**（`NeoEsp32I2s0X8/X16Ws2812xMethod`）で複数データ線を同一タイミングで送出。DMA 寄りの並列ビットストリームで Wi-Fi 下の安定性を優先する。

| リグ | PlatformIO env | Layout ID | 方式 |
|------|----------------|-----------|------|
| 15panels | `15panels` | `icosahedron-15` | NeoPixelBus I2S0 X8 |
| 60panels | `60panels` | `geodesic-2v-60` | NeoPixelBus I2S0 X16 |

**設計方針:**

- `glowbe-layout` の `wiring.dataLines[]` 1 エントリ = 1 本のデータ線。
- 60panels: **10 GPIO**（13,14,16,17,18,19,21,22,23,25）。15panels: **5 本**。
- チップ **SK6805**、**GRB**（レイアウト JSON で固定）。
- フレーム完了後、**全ラインを可能な限り同時にラッチ**して体感のちらつきを抑える。

### 11.2 モジュール構成

[`firmware/esp32/`](../firmware/esp32/)（`src/main.cpp` — NeoPixelBus + UDP）。

```
main
├── glowbe_wire.h         # FRAME パーサ・再構成
├── include/generated/<layout-id>/glowbe_layout.h   # layout-compile 自動生成（env の -I で選択）
├── led_driver.cpp          # NeoPixelBus I2S0 並列
├── main.cpp              # Wi-Fi + UDP + LED ドライバ
```

### 11.3 その他

- **Wi-Fi 2.4 GHz STA のみ**。
- プロビジョニングはホスト USB ツール（Web からは行わない）。

---

## 12. ハードウェア

詳細: [`hardware/README.md`](../hardware/README.md)

```
hardware/
├── pcb/
│   ├── geodesic-2v-60-revA/     # 60panels — EasyEDA `.eprj`（v2.2.47）
│   └── icosahedron-15-revA/     # 15panels — EasyEDA `.eprj`（v2.2.47）
└── mechanical/
    ├── geodesic-2v-60/          # 60panels 用 3D プリント（1 ファイル）
    └── icosahedron-15/          # 15panels 用 3D プリント（1 ファイル）
```

| 種別 | 15panels | 60panels |
|------|----------|----------|
| Layout id | `icosahedron-15` | `geodesic-2v-60` |
| PCB rev | `icosahedron-15-revA` | `geodesic-2v-60-revA` |
| PCB ソース（Git） | `Glowbe-15panels.eprj` | `Glowbe-60panels.eprj` |
| 3D プリント | `mechanical/icosahedron-15/` に **1 ファイル** | `mechanical/geodesic-2v-60/` に **1 ファイル** |

基板の Gerber / BOM は現時点では Git 管理外。`.eprj` から EasyEDA でエクスポートする。ライセンス: [`LICENSE.hardware`](../LICENSE.hardware)（CERN-OHL-P-2.0）。

データ線は **GPIO 直結 + レベルシフタ**（PCB 設計に従う）。I2S 専用ピンに依存しない配線を推奨。

---

## 13. LED レイアウト

詳細: [`config/layouts/README.md`](../config/layouts/README.md)

| 用途 | ファイル | `id` |
|------|----------|------|
| 60panels | [`config/layouts/presets/geodesic-2v-60.layout.json`](../config/layouts/presets/geodesic-2v-60.layout.json) | `geodesic-2v-60` |
| 15panels | [`config/layouts/presets/icosahedron-15.layout.json`](../config/layouts/presets/icosahedron-15.layout.json) | `icosahedron-15` |

### 形式 `glowbe-layout` v1

- 旧 `glowbe-studio-layout` から移行済み（`tools/migrate-studio-layout.mjs`）。
- **配線・面テンプレート・幾何プリセット ID** を保持。頂点列は含めない（コンパイル時に展開）。
- スキーマ: `protocol/glowbe-layout.schema.json`

### 60panels 概要

- プリセット `geodesic-ico-2v`、半径 50 mm、**10 データ線**、面あたり 21 LED（zigzag）。

### 15panels 概要

- プリセット `icosahedron`、**5 データ線**、面あたり 15 LED（`rowSizes` あり）。
- **コンパイル済み:** 225 LED（各線 45）。`npx tsx tools/layout-compile.ts config/layouts/presets/icosahedron-15.layout.json`

### プロトコル文書

| 文書 | 内容 |
|------|------|
| [`protocol/udp-wire.md`](../protocol/udp-wire.md) | UDP ピクセル v1 |
| [`protocol/control-api.md`](../protocol/control-api.md) | REST / WS |
| [`protocol/glowseq.md`](../protocol/glowseq.md) | 変換済みシーケンス |
| [`protocol/compiled-layout.md`](../protocol/compiled-layout.md) | レイアウト成果物 |
| [`docs/BENCHMARK.md`](BENCHMARK.md) | 60 fps 合格基準 |

---

## 14. プレビュー経路

```
フレームループ
    ├─► UDP ──► ESP（フルレート）
    └─► 間引き JPEG ──► WebSocket ──► ブラウザ
```

ESP 経路とプレビューは分離し、プレビュー負荷で UDP を落とさない。

---

## 15. クロスプラットフォーム運用

- **Ubuntu:** `systemd` + 有線 LAN 推奨。
- **Windows 展示:** `glowbe-runtime.exe`、PowerShell 起動スクリプト。
- **ビルド:** Rust `cargo build --release`、Web `pnpm build`、ファーム `pio run`。

---

## 16. パフォーマンスモデル（2.4 GHz・60 fps 以上）

| 指標 | 値 |
|------|-----|
| 最低 fps | **60**（`fps_rx` で計測） |
| Wi-Fi | **2.4 GHz のみ** |

| 段階 | 目安 |
|------|------|
| モード tick | < 2 ms |
| UDP 送信 | < 2 ms |
| ESP 再構成 + **LED 出力**（S3: NeoPixelBus LCD / 無印プロト: NeoPixelBus I2S0） | ベンチで計測 |

メディア変換ジョブは **オフライン** のためリアルタイム fps の対象外。

---

## 17. セキュリティ（完全オープン）

LAN 到達者が制御・UDP 送信可能。展示は閉じた AP を運用で推奨。アップロードはサイズ・拡張子制限。

---

## 18. 観測・運用

`/api/v1/state`、構造化ログ、ESP `STATUS`、メディアジョブ進捗。

---

## 用語集

| 用語 | 意味 |
|------|------|
| 正距円筒図法 | Equirectangular。横長 2:1 が球面全体のテクスチャ |
| glowbe-layout | LED 配線・幾何プリセットの JSON 形式 v1 |
| シーケンス | メディア変換後の LED フレーム列（`assets/sequences/`） |
| RMT | ESP32 のリモートコントロール周辺機器。WS2812 系のビットバンギングに利用可能。本リポジトリでは NeoPixelBus **I2S0 並列**を既定とする |
| I2S0 並列 | NeoPixelBus `NeoEsp32I2s0X8/X16Ws2812xMethod` による ESP32 マルチライン LED 駆動（詳細は `docs/firmware/LED-OUTPUT.md`） |

---

*以上*
