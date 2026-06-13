# Glowbe v2 — システムアーキテクチャ

> **ステータス:** レビュー用ドラフト（2026-06-13）  
> **範囲:** 設計のみ（本ドキュメントは「あるべき姿」を記述し、実装の進捗は追わない）  
> **実装状況の正本:** [`STATUS.md`](STATUS.md)（Phase / API / モードごとの 設計・実装・検証）  
> **旧版:** `archived-glowbe` を置き換える

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
11. [ESP32-S3 ファームウェア](#11-esp32-s3-ファームウェア)
12. [ハードウェア / PCB](#12-ハードウェア--pcb)
13. [LED レイアウト](#13-led-レイアウト)
14. [プレビュー経路](#14-プレビュー経路)
15. [クロスプラットフォーム運用](#15-クロスプラットフォーム運用)
16. [パフォーマンスモデル（2.4 GHz・60 fps 以上）](#16-パフォーマンスモデル24-ghz60-fps-以上)
17. [セキュリティ（完全オープン）](#17-セキュリティ完全オープン)
18. [観測・運用](#18-観測運用)
19. [段階的ロードマップ](#19-段階的ロードマップ)
20. [archived-glowbe との関係](#20-archived-glowbe-との関係)

---

## 1. 概要

Glowbe v2 は **サーバ権威型のリアルタイム LED 球体プラットフォーム**である。アニメーションフレームは **常駐ランタイム**（自宅 Ubuntu Server、展示用 Windows など）で合成され、**自前 UDP プロトコル**で **ESP32-S3** へ送られる。スマホ・PC のブラウザは **設定・操作・プレビュー**に使い、タブを閉じても再生は止まらない。

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
                                               │ ESP32-S3 + LED リグ │
                                               │ Wi-Fi 2.4 GHz のみ   │
                                               └─────────────────────┘
```

**リポジトリ:** GitHub `Glowbe`（新規）。旧版は `archived-glowbe`。  
**モノレポに含めるもの:** ランタイム、Web、**ESP ファーム**、**PCB**。

---

## 2. 確定した設計方針

| 項目 | 決定内容 |
|------|----------|
| LED レイアウト | **`glowbe-layout` v1** — [`config/layouts/product.layout.json`](../config/layouts/product.layout.json)（製品）、[`prototype.layout.json`](../config/layouts/prototype.layout.json)（プロトタイプ）。今後変更あり得る |
| ピクセル転送 | **完全自前 UDP**（Art-Net・TouchDesigner 連携は採用しない） |
| メディア | **正距円筒図法（equirectangular）** の画像・動画・コマ送りをアップロード → **サーバで LED フレーム列へ変換・保存** → ループ再生等で利用（TouchDesigner 連携なし） |
| Wi-Fi | **2.4 GHz のみ**（ESP 側）。**最低 60 fps** |
| ランタイム | **Rust** |
| Web | **Vite + React** |
| 認証 | **完全オープン** |
| クライアントマイク | **後回し** |
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
| G5 | モード: ループ再生、インタラクティブ（リップル）、サーバマイク、**デジタル時計**（`clock_digital`）、**アナログ時計**（`clock_analog`） |
| G6 | 正距円筒メディアのアップロードとサーバ側アニメーション資産化 |
| G7 | Web：UV プレビュー、タブ型統合ボード、プレビュー配信 |

### 非目標（v1）

| ID | 内容 |
|----|------|
| NG1 | archived-glowbe とのプロトコル・ファーム互換 |
| NG2 | 外部ツール（TouchDesigner 等）からのライブ取り込み |
| NG3 | クラウドピクセル中継 |
| NG4 | ブラウザ内タイムラインオーサリング（旧 Studio 相当） |
| NG5 | 認証 |
| NG6 | クライアント（端末）マイク |

### 設計原則

1. **単一ライター:** ESP へ届くフレームはランタイムのみが生成する。
2. **3 プレーン分離:** 制御 / ピクセル / プレビュー。
3. **メディアはサーバで前処理:** ブラウザはアップロードとパラメータのみ。重い変換は常駐プロセス。
4. **レイアウトはデータ駆動:** `glowbe-layout` v1 → コンパイル済みテーブル。
5. **LED 出力はチップ世代で分ける:** ESP32-S3 は **LCD（I8080）+ DMA マルチピン並列**、ESP32 無印プロトは **RMT 1 線 1 チャンネル**（§11、[`firmware/LED-OUTPUT.md`](firmware/LED-OUTPUT.md)）。

---

## 4. システムコンテキスト

### 4.1 登場者

| 役割 | 責務 |
|------|------|
| **glowbe-runtime** | マスタークロック、モード合成、メディア変換ジョブ、資産保存、UDP 送信、プレビュー |
| **Web クライアント** | 操作 UI、メディアアップロード、UV タップ、プレビュー表示 |
| **ESP32-S3** | UDP 受信、フレーム再構成、マルチライン LED 駆動 |
| **オペレータ** | ランタイム起動、USB フラッシュ、展示ネットワーク |

### 4.2 典型構成（自宅）

```
                    ┌─────────────────────────────────────┐
   Wi-Fi 2.4 GHz    │  Ubuntu Server（有線 LAN 推奨）      │
                    │  glowbe-runtime :8080  制御/プレビュー │
                    │                 :49152 UDP ピクセル    │
                    │  assets/         メディア・ループ保存    │
                    └──────────────┬──────────────────────┘
                                   │
              ┌────────────────────┴────────────────────┐
              ▼                                         ▼
        [スマホ / PC ブラウザ]                    [ESP32-S3 球体]
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
│ ESP32-S3 — 受信・マルチライン出力                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. モノレポ構成

```
Glowbe/
├── docs/
│   ├── ARCHITECTURE.md          # 本書（設計の正本）
│   ├── STATUS.md                # 実装状況・引き継ぎの正本
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
├── runtime/                     # Rust（Phase 1: loop 出力 + 状態 API）
├── web/                         # Vite + React（未着手）
├── firmware/esp32s3/
├── hardware/pcb/                # 未追加
├── tools/
│   ├── migrate-studio-layout.mjs
│   ├── layout-compile.ts        # レイアウト → コンパイル成果物 + ファームヘッダ
│   ├── bench-udp.mjs
│   └── listen-status.mjs
├── assets/
│   ├── uploads/                 # 生メディア（gitignore）
│   ├── sequences/               # 変換済みフレーム列（gitignore）
│   └── compiled/                # レイアウトバイナリ（コミット対象）
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
  2. アクティブモード（loop / interactive / mic / clock_digital / clock_analog）
  3. IDLE（フェードアウトまたは最終フレーム保持）
```

### 6.4 設定（`config.toml`）

**現在の実装が読むキー**（Phase 1。正本は [`config.example.toml`](../config.example.toml) / `runtime/src/config.rs`）:

```toml
[device]
esp_ip = "192.168.0.42"
layout_id = "prototype-icosahedron-15"

[output]
udp_port = 49152
status_port = 49153   # ESP → ランタイム STATUS 受信（既定 49153）
target_fps = 60

[modes]
default = "loop"

[server]
bind = "0.0.0.0:8080"
```

**将来構成（設計目標。未実装キーを含む）** — Phase 2 以降で `config.rs` に追加予定:

```toml
[device]
board_rev = "A"                 # 未実装

[assets]                        # 未実装（Phase 2 メディア）
uploads = "assets/uploads"
sequences = "assets/sequences"

[preview]                       # 未実装（プレビュー）
enabled = true
fps = 12
width = 480

[clock]                         # 未実装（Phase 4 時計モード）
timezone = "Asia/Tokyo"
```

> 注: `runtime/src/config.rs` は未知キーを無視するため、将来構成キーを書いても起動は通るが効果は無い。実装状況は [`STATUS.md`](../docs/STATUS.md) を参照。

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
    → assets/sequences/<id>/ にフレーム列保存
         （生 RGB バイナリ、または .glowseq コンテナ）
    → メタデータ JSON（fps、フレーム数、解像度、作成日時）
```

- 変換は **リアルタイム再生とは別スレッド/プロセス**で行い、フレームループをブロックしない。
- 完了後 Web から **ループモードで選択可能**にする。

### 7.3 サンプリング

- コンパイル済みレイアウトの **各 LED の UV 座標**（正距円筒上の u,v）から双線形補間で RGB を取得。
- archived-glowbe の球面→UV マッピング思想を Rust に移植（コードコピーではなく再実装）。

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

WebSocket: リップルイベント、プレビューフレーム、`state` 通知。

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

### 9.3 サーバマイク（`mic`）

- サーバ接続マイクのエネルギー・帯域で視覚化。

### 9.4 デジタル時計（`clock_digital`）

- サーバのローカル時刻（`config.toml` の `timezone`）を **7 セグ / ドットマトリクス風** または **UV 上の数字描画**で表示。
- 常時表示用。ループと排他切替。

### 9.5 アナログ時計（`clock_analog`）

- 時・分（任意で秒）針を球面 UV 上に描画。
- 針はベクトル描画または事前定義スプライトで毎 tick 更新。

### 9.6 将来モード

| モード | 概要 |
|--------|------|
| `mic_client` | 端末マイク（後回し） |
| `schedule` | 時刻でモード・シーケンス切替 |
| `ai_voice` | 外部 AI API 連携 |

### 9.7 モード切替 API

```json
POST /api/v1/mode
{ "mode": "loop" | "interactive" | "mic" | "clock_digital" | "clock_analog" | "idle" }
```

---

## 10. Web クライアント（Vite + React）

### 10.1 タブ構成

| タブ | 内容 |
|------|------|
| **ダッシュボード** | モード、fps、ESP、レイアウト id |
| **メディア** | 正距円筒画像・動画・コマ送りアップロード、変換進捗、シーケンス一覧 |
| **ループ** | 変換済みシーケンスの選択・再生 |
| **インタラクティブ** | UV マップ、タップでリップル |
| **時計** | デジタル/アナログ切替、タイムゾーン表示 |
| **オーディオ** | サーバマイクモード |
| **デバイス** | ESP ステータス |
| **設定** | サーバ URL、プレビュー品質 |

### 10.2 プレビュー

- ランタイムから `preview_frame`（間引き JPEG）を WS で受信。
- メディアタブでは変換前の **正距円筒プレビュー**も表示可能（静的画像サムネ）。

---

## 11. ESP32-S3 ファームウェア

### 11.1 マルチピン駆動（チップ世代で方式を分ける）

詳細: [`firmware/LED-OUTPUT.md`](firmware/LED-OUTPUT.md)

**ESP32-S3（製品・本番）:** I2S ペリフェラルのハック（無印時代の定石）ではなく、**LCD ペリフェラル（Intel 8080 / I8080）+ DMA** によるパラレル転送で複数データ線を同時出力する。実装は FastLED `FASTLED_USES_ESP32S3_I2S`（内部は `esp_lcd` / LCD HAL）。マクロ名の `I2S` は歴史的命名であり、無印の I2S 並列とは別物。

**ESP32 無印（手元プロトタイプ）:** データ線ごとに **通常の RMT**（FastLED WS2812 コントローラ 1 本 1 チャンネル）。archived-glowbe の I2S パラレルは使わない。

| ターゲット | PlatformIO env | 方式 |
|------------|----------------|------|
| ESP32-S3 | `prototype` | LCD + DMA マルチピン並列 |
| ESP32 無印 | `prototype-esp32` | RMT per line |

**設計方針:**

- `glowbe-layout` の `wiring.dataLines[]` 1 エントリ = 1 本のデータ線。
- 製品: **10 GPIO**（13,14,16,17,18,19,21,22,23,25）。プロトタイプ: **5 本**。
- チップ **SK6805**、**GRB**（レイアウト JSON で固定）。
- フレーム完了後、**全ラインを可能な限り同時にラッチ**して体感のちらつきを抑える。

### 11.2 モジュール構成

スパイク: [`firmware/esp32s3/`](../firmware/esp32s3/)（`src/main.cpp` — FastLED + UDP）。

```
main
├── glowbe_wire.h         # FRAME パーサ・再構成
├── glowbe_layout.h       # layout-compile 自動生成
├── led_driver_s3.cpp     # S3: LCD DMA parallel
├── led_driver_esp32.cpp  # 無印: RMT per line
├── main.cpp              # Wi-Fi + UDP + LED ドライバ
└── http_status.cpp       # 将来
```

### 11.3 その他

- **Wi-Fi 2.4 GHz STA のみ**、PSRAM 推奨。
- プロビジョニングはホスト USB ツール（Web からは行わない）。

---

## 12. ハードウェア / PCB

```
hardware/pcb/glowbe-revA/
```

| PCB rev | レイアウト id |
|---------|----------------|
| A（製品） | `product-geodesic-2v-60` |
| —（プロト） | `prototype-icosahedron-15` |

データ線は **GPIO 直結 + レベルシフタ**（PCB 設計に従う）。I2S 専用ピンに依存しない配線を推奨。

---

## 13. LED レイアウト

詳細: [`config/layouts/README.md`](../config/layouts/README.md)

| 用途 | ファイル | `id` |
|------|----------|------|
| 製品 | `config/layouts/product.layout.json` | `product-geodesic-2v-60` |
| プロトタイプ | `config/layouts/prototype.layout.json` | `prototype-icosahedron-15` |

### 形式 `glowbe-layout` v1

- 旧 `glowbe-studio-layout` から移行済み（`tools/migrate-studio-layout.mjs`）。
- **配線・面テンプレート・幾何プリセット ID** を保持。頂点列は含めない（コンパイル時に展開）。
- スキーマ: `protocol/glowbe-layout.schema.json`

### 製品版概要

- プリセット `geodesic-ico-2v`、半径 50 mm、**10 データ線**、面あたり 21 LED（zigzag）。

### プロトタイプ概要

- プリセット `icosahedron`、**5 データ線**、面あたり 15 LED（`rowSizes` あり）。
- **コンパイル済み:** 225 LED（各線 45）。`npx tsx tools/layout-compile.ts config/layouts/prototype.layout.json`

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
| ESP 再構成 + **LED 出力**（S3: LCD+DMA 並列 / 無印プロト: RMT） | ベンチで計測 |

メディア変換ジョブは **オフライン** のためリアルタイム fps の対象外。

---

## 17. セキュリティ（完全オープン）

LAN 到達者が制御・UDP 送信可能。展示は閉じた AP を運用で推奨。アップロードはサイズ・拡張子制限。

---

## 18. 観測・運用

`/api/v1/state`、構造化ログ、ESP `STATUS`、メディアジョブ進捗。

---

## 19. 段階的ロードマップ

| Phase | 内容 | 状態 |
|-------|------|------|
| **0** | プロトコル文書、プロトタイプ layout-compile（225 LED）、ESP スパイクファーム、UDP ベンチツール | 完了 |
| **1** | Rust ランタイム、ループ E2E、**60 fps ベンチ合格** | UDP E2E 成功扱い。API/ドキュメント締め中 |
| **2** | メディアパイプライン（正距円筒→シーケンス） | 次: 静止画1枚→LEDフレームから |
| **3** | インタラクティブ（リップル） | 未着手 |
| **4** | サーバマイク、デジタル/アナログ時計 | 未着手 |
| **5** | クライアントマイク、OTA、展示 runbook | 未着手 |

---

## 20. archived-glowbe との関係

| 旧 | 新 |
|----|-----|
| ブラウザ中心 | **Rust ランタイム中心** |
| GU チャンク UDP | **Glowbe Wire UDP v1** |
| 無印 I2S パラレル | **S3: LCD+DMA 並列 / 無印プロト: RMT** |
| Studio オーサリング | **サーバメディア変換 + 薄い Web UI** |
| TouchDesigner / Relay | **廃止** |

コードマージは行わない。幾何・UV の **参照のみ**。

---

## 用語集

| 用語 | 意味 |
|------|------|
| 正距円筒図法 | Equirectangular。横長 2:1 が球面全体のテクスチャ |
| glowbe-layout | LED 配線・幾何プリセットの JSON 形式 v1 |
| シーケンス | メディア変換後の LED フレーム列（`assets/sequences/`） |
| RMT | ESP32 のリモートコントロール周辺機器。WS2812 系のビットバンギングに利用（無印プロトの LED 出力） |
| LCD / I8080 | ESP32-S3 内蔵の LCD ペリフェラル（Intel 8080 バス互換）。DMA で複数 GPIO へ同時ビットストリーム出力し、S3 本番の LED 並列駆動に使う（詳細は `docs/firmware/LED-OUTPUT.md`） |
| DMA パラレル | DMA がメモリ上のバッファを LCD ペリフェラルへ転送し、複数データ線を低 CPU 負荷で同時駆動する方式 |

---

*以上*
