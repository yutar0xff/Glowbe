# Glowbe 制御 API v1

ベース URL: `http://<runtime-host>:<port>`（`config.toml` の `[server] bind`。リポジトリ既定例は **8748**）

認証: **なし**（完全オープン）

JSON フィールド名は外部 API として **camelCase** に統一する。

## REST

### `GET /api/v1/state`

```json
{
  "layoutId": "prototype-icosahedron-15",
  "mode": "loop",
  "fpsOut": 60.1,
  "fpsRx": 59.8,
  "espFramesComplete": 216000,
  "espRssi": -55,
  "espDrops": 0,
  "espStatusAddr": "192.168.1.10:49152",
  "outputTargetAddr": "192.168.1.10:49152",
  "ledCount": 225,
  "loopClipId": null,
  "loopSourceFrame": null,
  "loopPlaybackPaused": false,
  "uptimeSec": 3600,
  "frameLoopStaleMs": 12,
  "layoutMismatch": false,
  "framesSent": 216000,
  "masterBrightness": 1,
  "masterGamma": 1,
  "frontYawDeg": 0
}
```

- `masterBrightness`: 全モード共通の最終輝度係数（0–1、1 = 100% が既定）。UDP 直前に各チャンネルへ乗算。Studio UI では 0–100% 表示。ファーム側では layout の LED 総数と 4 A 電源の 80%（3.2 A）・LED 白 15 mA を前提にした上限（`kGlowbeLedBrightness`）を別途適用。
- `masterGamma`: 全モード共通のガンマ補正（約 0.45–3.5、1 が既定）。`out = clamp( ((in/255)×brightness)^(1/gamma) × 255 )`。
- `frontYawDeg`: デバイス正面の yaw（度、−180〜180、0 が既定）。全モードのサンプリング UV の経度 `u` を鉛直軸まわりに回す（`u' = (u + frontYawDeg/360) mod 1`）。`GET /api/v1/layout/uv` と WS `layoutUv` も同じシフトを適用して返すため、2D/3D プレビューとインタラクティブのタップ座標は正面中心に揃う。デバイスごとに `devices.json` へ保存。
- `frameLoopStaleMs`: 直近のフレームループ tick からの経過時間（ms）。出力タスクが停止すると急増する。
- `layoutMismatch`: ESP STATUS の `layout_hash` とランタイムの `meta.layoutHash` が食い違うとき `true`（いずれか欠損時は照合しない）。
- `framesSent`: 完全送信に成功したフレーム数（累計）。
- `outputTargetAddr`: runtime が FRAME を送信している宛先。`espStatusAddr` と IP が違う場合、`config.toml` の `device.esp_ip` が古い可能性が高い。
- `loopSourceFrame`: **`loop` かつメディアクリップのフレームが実際に出力バッファへサンプルできているとき**、そのソース上のフレーム index（0 始まり）。ビルトインデモは procedural（離散ソースフレームを持たず常にデバイス fps で描画）のため常に `null`。テストパターンへフォールバック中や `idle` / `interactive` でも省略または `null`。
- `loopPlaybackPaused`: **`loop` でクリップ選択中**にタイムラインが一時停止のとき `true`（`POST /api/v1/loop/pause`）。それ以外は `false`。
- `espStatusAddr`: ESP STATUS パケットの送信元。

### `POST /api/v1/brightness`（草案・未実装）

```json
{ "value": 128 }
```

グローバル輝度 0–255。実装時はファームまたはランタイムの最終段で適用（[`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §6.5）。

### `POST /api/v1/mode`

```json
{ "mode": "idle" | "loop" | "interactive" | "mate" | "text" }
```

→ 実装済み: **`idle`**（全消灯・**選択クリップ解除**・WS インタラクティブ合成は無視）、**`loop`**（テストパターンまたは選択クリップ）、**`interactive`**（既定は全消灯ベース。WebSocket の **`setSolid`** で全 LED を同一 RGB にしたうえで、インタラクティブ・パルスを UDP 出力に合成。クリップ選択は保持）、**`text`**（任意の文章を球面の周りに流す。パラメータは `POST /api/v1/text/config` で設定）。`200` + 更新後 `state` オブジェクト。その他のモードは `400`。

### `POST /api/v1/loop/select`

```json
{ "clipId": "demo/expanding-rings" }
```

またはメディアクリップ uuid（例 `up-550e8400-e29b-41d4-a716-446655440000`）。`sequenceId` は後方互換の別名として受け付ける。

→ 実装済み: ビルトインデモ id または `assets/clips/<clipId>/` を読み込み、**レイアウト非依存**で loop モード再生（現レイアウトの UV で equirect をサンプル、またはデモ手続き）。失敗時は `400`。

### `POST /api/v1/loop/clear-selection`

ボディ不要。

→ 実装済み: 選択中のクリップを解除し（`loopClipId` を `null`）、出力モードを **`loop`** にする。クリップ無しのテストパターンへ移行する。`200` + 更新後 `state`。

### `POST /api/v1/loop/pause`

```json
{ "paused": true }
```

→ 実装済み: **`loop` かつクリップ選択中**のとき、タイムラインを一時停止（`paused: true`）または再開（`paused: false`）。`idle` / `interactive` では状態のみ更新され、出力の見え方はモードに従う。`200` + 更新後 `state`（`loopPlaybackPaused` を含む）。

### `POST /api/v1/master-tone`

```json
{ "brightness": 1.0, "gamma": 1.0 }
```

→ 実装済み: **全出力モード**で、フレームを UDP に送る直前に適用するマスター補正。`brightness` は 0–1（クランプ、1 = 100%）、`gamma` は約 0.45–3.5（クランプ）。`200` + 更新後 `state` オブジェクト。

### `GET /api/v1/text/config`

`?deviceId=` で対象デバイスを指定（省略時は既定デバイス）。text モードの現在のパラメータを返す。

```json
{
  "content": "Hello, World. This is Glowbe, a spherical display created by Yutar0xff.",
  "textSizeDeg": 130.0,
  "speedDegPerSec": 150.0,
  "centerLatDeg": 15.0,
  "tiltDeg": -20.0,
  "tiltAzimuthDeg": 30.0,
  "fadeStartDeg": 0.0,
  "fadeEndDeg": 120.0,
  "thickness": 1.0,
  "loopIntervalSec": 2.0,
  "bgColor": "#000000",
  "textColor": "#3b82f6"
}
```

### `POST /api/v1/text/config`

`?deviceId=` で対象デバイスを指定。全フィールド省略可の部分更新。1 つでも送ると出力モードを **`text`** に自動切替する。`200` + 更新後 `state` オブジェクト。色が不正な `#rrggbb` の場合は `400`。

| フィールド | 単位 / 型 | 範囲 | 既定 | 説明 |
| --- | --- | --- | --- | --- |
| `content` | string | 最大 256 文字 | `"Hello, World. This is Glowbe, a spherical display created by Yutar0xff."` | 表示文字列（日本語可）。空なら背景色のみ。 |
| `textSizeDeg` | 度 | 10–180 | 130 | 文字の角度高さ。 |
| `speedDegPerSec` | 度/秒 | -360–360 | 150 | flow 速度。符号で流れる向き。 |
| `centerLatDeg` | 度 | -80–80 | 15 | flow 中心緯度（0 = 赤道）。 |
| `tiltDeg` | 度 | -90–0 | -20 | 帯の傾き量 θ（0 = 水平＝極が +Y、-90 = 縦）。 |
| `tiltAzimuthDeg` | 度 | -180–180 | 30 | 傾ける方位角 φ（+X 基準・+Y 軸まわり右ねじ。0 = 正面 +X 方向へ倒す）。帯の極を `n(θ,φ)=(sinθcosφ, cosθ, -sinθsinφ)` に倒す。 |
| `fadeStartDeg` | 度 | 0–180 | 0 | 真裏（0°）からこの角度までは明るさ 0（背景色）。 |
| `fadeEndDeg` | 度 | 0–180 | 120 | この角度で明るさ最大（文字色）。start→end で明るさをグラデーション。 |
| `thickness` | — | 0–6 | 1 | 文字の太さ（リボン被覆のダイレーション量、小数可）。 |
| `loopIntervalSec` | 秒 | 0–30 | 2 | 全文字が流れ切ってから次ループ開始までに挟む空白の長さ。走査速度で角度に換算する。 |
| `bgColor` | `#rrggbb` | — | `#000000` | 背景色。 |
| `textColor` | `#rrggbb` | — | `#3b82f6` | 文字色。 |

→ 実装済み: 各 LED の正面 yaw 適用済み UV から色を生成する。正面（`u=0.5`）を中心に文章が流れ、デバイスの真裏（`u=0.0/1.0` の継ぎ目）から出現・消失する。真裏付近は `fadeStartDeg`〜`fadeEndDeg` の範囲で明るさが 0→最大に線形グラデーションし背景色へフェードする。`frontYawDeg` を変更すると正面・真裏の位置も追従する。文字列が周長（360°）を超える場合は全長をスクロール周期とし、全文字が流れ切ってから先頭が再登場する（自身との重なりは生じない）。`loopIntervalSec` を指定すると全長のあとに空白帯（`loopIntervalSec × |speedDegPerSec|` 度）を挟んでから次ループを開始する。他モードから text へ切り替えた直後は、スクロール原点をリセットして必ず文章の先頭から表示し直す（モード維持のままパラメータを更新した場合はリセットしない）。グリフは同梱 TTF（`assets/text/NotoSansJP.ttf`、`[assets].text_font_path` で変更可）を実行時にラスタライズし、`thickness` でリボン被覆をダイレーションして太らせる。フォント読み込みに失敗した場合は背景色のみを描画する。

### `GET /api/v1/layout/uv`

UV プレビュー用。ランタイムの現在の `layoutId` に対応する `assets/compiled/<layoutId>.ledmap.json` を読み取り、全 LED の UV と配線上の位置を返す。

```json
{
  "layoutId": "prototype-icosahedron-15",
  "ledCount": 225,
  "leds": [
    { "i": 0, "u": 0.574469, "v": 0.630754, "channel": 0, "chainIndex": 0 }
  ]
}
```

→ 実装済み。失敗時は `500` + `{ "error": "..." }`。

### `GET /api/v1/layouts`

`assets/compiled` にある `*.meta.json` を列挙し、利用可能なレイアウトの要約を返す。

```json
[
  {
    "layoutId": "prototype-icosahedron-15",
    "displayName": "Prototype icosahedron (15 faces)",
    "ledCount": 225,
    "variant": "prototype"
  }
]
```

→ 実装済み。ディレクトリ読み取り失敗時は `500` + `{ "error": "..." }`。

### `POST /api/v1/device/layout`

```json
{ "layoutId": "product-geodesic-2v-60" }
```

→ 実装済み: ランタイムの **`layoutId` / `ledCount` / `layoutHash` 期待値**を切り替え、プレビューバッファと UV キャッシュを再確保する。**クリップ選択は維持**（レイアウト非依存のため再変換不要）。`config.toml` は書き換えない。`400` + `{ "error": "..." }`（メタ JSON が無い等）。成功時は `200` + 更新後 `state`。

**注意:** ESP はコンパイル時に埋め込んだ `layout_hash` / `led_count` と一致するフレームのみ受け入れる。Studio のレイアウト選択と実機ファームを揃えること。

### `GET /health`

ヘルスチェック。**プレーンテキスト**。

- 出力ループが直近 **1000ms** 以内に tick していれば `200 OK` + 本文 `ok`。
- それ以外（タスク停止・長時間ブロック等）では `503 Service Unavailable` + 本文 `stale: output loop tick too old`。

監視・起動確認用。

### `GET /api/v1/clips`

ビルトインデモ + 変換済みメディアクリップの統合一覧。実装済み。

```json
[
  {
    "id": "demo/expanding-rings",
    "kind": "demo",
    "frameCount": 375,
    "fps": 30,
    "width": 256,
    "height": 128,
    "sourceWidth": 0,
    "sourceHeight": 0,
    "createdAtUnixSec": 0,
    "displayName": "Expanding rings",
    "isDemo": true
  },
  {
    "id": "up-550e8400-e29b-41d4-a716-446655440000",
    "kind": "equirect-video",
    "frameCount": 300,
    "fps": 30,
    "width": 256,
    "height": 128,
    "sourceKind": "equirectangular-video",
    "sourceWidth": 2048,
    "sourceHeight": 1024,
    "createdAtUnixSec": 1781332800,
    "displayName": "My clip"
  }
]
```

### `GET /api/v1/clips/:clipId/source-frame/:frameIndex`

→ 実装済み: メディアクリップに同梱されたインポート（`source-import.*`）から、指定フレームを **PNG** で返す。ビルトインデモでは `404`。`frameIndex` は `0 .. frameCount-1`。

### `DELETE /api/v1/clips/:clipId`

→ 実装済み: `assets/clips/<clipId>/` をディスクから削除。ビルトインデモは `400`。再生中なら先に選択解除。成功時 **`204 No Content`**。

### `PATCH /api/v1/clips/:clipId`

```json
{ "displayName": "New label" }
```

→ 実装済み: メディアクリップの `manifest.json` の `displayName` を更新。ビルトインデモは `400`。`200` + 更新後のクリップ要約。

### `POST /api/v1/media/upload`

`multipart/form-data`: `file`（正距円筒画像/動画/ZIP）。

→ 実装済み: **`file` は PNG / JPEG / ZIP / MP4 / WebM / MOV / MKV**（拡張子または先頭マジックで ZIP 判定）。本文上限はランタイムで約 **48MiB**。

→ `{ "uploadId": "uuid", "status": "stored" }`

### `POST /api/v1/media/:uploadId/convert`

```json
{ "fps": 30, "displayName": "Optional label", "resolution": { "width": 256, "height": 128 } }
```

`layoutId` は不要（レイアウト非依存）。`resolution` 省略時は 256×128。

→ `{ "jobId": "uuid", "status": "queued" }`

→ 実装済み: 正距円筒メディアを低解像度 `equirect.bin` + `glowbe-clip` manifest として `assets/clips/` に出力。元ファイルは `source-import.<ext>` として複製。

### `GET /api/v1/media/:uploadId`

変換進捗・`clipId`（完了時）。

→ 実装済み。例:

```json
{
  "uploadId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "running",
  "jobId": "...",
  "progress": 0
}
```

`status`: `stored` | `running` | `done` | `failed`。`running` 中は **`progress` が 0–99** で変換のおおよその進捗（ZIP 多フレーム時）。`done` のとき `clipId` と `progress: 100`。`failed` のとき `error`。

## WebSocket `GET /api/v1/ws`

→ 実装済み: 接続直後と約 1 秒ごとに `state` を送る。`ping` → `pong`。**`masterSettings`** は任意モードでマスター補正を更新（`POST /api/v1/master-tone` と同等）。**`interactive`** メッセージは、出力モードが **`interactive`** のときだけ合成（それ以外は `event_status` `error`）。**`previewSubscribe`** で有効化した接続には、約 **30fps** で **バイナリ** LED フレーム（UDP 直前と同一の最終 RGB）が送られる。

### クライアント → サーバ

```json
{ "type": "masterSettings", "brightness": 0.85, "gamma": 1.15 }
{ "type": "getLayoutUv" }
{ "type": "interactive", "action": "setEffect", "effect": "expandingRingDiagonal" }
{ "type": "interactive", "action": "setSolid", "enabled": true, "colorRgb": [16, 16, 24] }
{ "type": "interactive", "action": "setSolid", "enabled": false }
{ "type": "interactive", "action": "pulse", "u": 0.42, "v": 0.71, "effect": "sphereGaussian", "durationMs": 450, "sigmaRad": 0.14, "colorRandom": true }
{ "type": "interactive", "action": "pulse", "u": 0.42, "v": 0.71, "effect": "expandingRingDiagonal", "colorRgb": [255, 120, 40], "ringSpeed": 1.2, "ringThicknessRad": 0.09 }
{ "type": "interactive", "action": "pulse", "u": 0.42, "v": 0.71, "amplitude": 1.0, "durationMs": 450, "sigmaRad": 0.14 }
{ "type": "ping" }
{ "type": "previewSubscribe", "enable": true }
```

- **`masterSettings`** … `brightness` / `gamma` を任意指定（未指定のキーは**変更しない**）。全モードで有効。
- **`previewSubscribe`** … `enable`（既定 `true`）で、その WebSocket 接続への **バイナリ LED プレビュー**（約 30fps）を開始／停止する。成功時は `event_status`（`event`: `previewSubscribe`, `status`: `ok`）。出力モードは問わない。
- **`getLayoutUv`** … 現在のランタイム `layoutId` の UV マップを返す（`GET /api/v1/layout/uv` と同一 JSON に **`"type": "layoutUv"`** を付与）。失敗時は `event_status`（`event`: `getLayoutUv`, `status`: `error`）。
- **`interactive` + `action: "setEffect"`** … 以降のパルスで省略したときに使う既定エフェクトを設定（`effect`: `sphereGaussian` | `expandingRingDiagonal`）。
- **`interactive` + `action: "setSolid"`** … インタラクティブ出力の**下地**を全 LED 同一色にするか消灯に戻す。出力モードが **`interactive`** のときのみ有効（それ以外は `event_status` `error`）。**`enabled`** が **`false`** または省略のときは全消灯ベース。**`true`** のときは **`colorRgb`: [r,g,b]**（各 0–255）で指定するか、**`r` / `g` / `b`** 数値（未指定は 0）で指定。成功応答は `event_status`（`action`: `setSolid`, `enabled`, 有効時は `colorRgb`）。
- **`interactive` + `action: "pulse"`**（または `action` 省略でパルス扱い）… パルスは **最大 32 本**まで保持し、それを超えると古いものから破棄する。アクティブな全パルスを **線形光（sRGB デコード）で加算**し、合成後に **最大チャンネルが 1 を超える場合だけ線形空間で RGB を一様に縮小**してから sRGB に戻す。残光トレイルが重なるため、赤と緑のリップルが重なった所は **黄に加算混色**される。
  - 共通: **`amplitude`**（既定 1、0–4）、**`colorRandom`: true** でタップごとに鮮やかな色を自動決定、**`colorRgb`: [r,g,b]`** で固定色（`colorRandom` が true なら無視）。
  - **`sphereGaussian`**: **`durationMs`**（既定 450、100–5000）と **`sigmaRad`**（既定約 0.14 rad、0.02–0.6）で寿命とスポット半径を指定する球面ガウス。
  - **`expandingRingDiagonal`**（リップル）: タップ中心から **大円角距離で等方に拡大する波面**と、通過後の**狭い残光トレイル**。**`ringSpeed`**（波面速度）、**`ringThicknessRad`**（バンド幅）、寿命は速度・幅から自動算出。到達前の立ち上がりは `ringThicknessRad` に依存しない固定の短い時間フェザーでタップ点から。`durationMs` は無視。

### サーバ → クライアント

```json
{ "type": "state", "layoutId": "prototype-icosahedron-15", "mode": "loop", "fpsOut": 60.0 }
{ "type": "layoutUv", "layoutId": "prototype-icosahedron-15", "ledCount": 225, "leds": [ { "i": 0, "u": 0.5, "v": 0.5 } ] }
{ "type": "pong" }
{ "type": "event_status", "event": "interactive", "status": "ok", "action": "setSolid", "enabled": true, "colorRgb": [16, 16, 24] }
{ "type": "event_status", "event": "interactive", "status": "ok", "effect": "sphereGaussian" }
```

`interactive` の `error` は ledmap 欠落など。

**エフェクト:** `sphereGaussian` は球面上ガウス（大円距離）。`expandingRingDiagonal` はタップ中心から**等方に拡大する球面波面**（大円角 θ に対する到達時刻 `θ/c`）と、通過後の指数トレイル。立ち上がりは波面幅に依存しない短い時間フェザーで**点始まり**。トレイルは角度方向にも狭いガウスでゲートし、球全体を埋めない。

### バイナリ LED プレビュー（`previewSubscribe` 有効時）

WebSocket の **Binary** メッセージ。ビッグエンディアン。

| オフセット | 型 | 内容 |
|-----------|-----|------|
| 0 | `u32` | マジック `0x47425031`（ASCII `GBP1`） |
| 4 | `u32` | フレーム更新シーケンス（単調増加、ラップ可） |
| 8 | `u16` | `ledCount`（`state` / `meta` と一致） |
| 10 | `u16` | 予約（0） |
| 12 | `u8[ledCount*3]` | LED 順の R,G,B（UDP 送信直前と同一：マスター輝度・ガンマ適用後） |

クライアントは `ledCount` とバッファ長を検証すること。

## Phase 対応 / 実装状況

| エンドポイント | Phase | 実装 |
|----------------|-------|------|
| `GET /api/v1/state` | 1 | ✅ 実装済 |
| `GET /health` | 1 | ✅ 実装済 |
| `POST /api/v1/mode` (`idle` / `loop` / `interactive` / `mate` / `text`) | 1 | ✅ 実装済 |
| `POST /api/v1/master-tone` | 1 | ✅ 実装済 |
| `GET` / `POST /api/v1/text/config` | 3 | ✅ 実装済 |
| `POST /api/v1/loop/select` | 2 | ✅ 実装済 |
| `POST /api/v1/loop/clear-selection` | 2 | ✅ 実装済 |
| `POST /api/v1/loop/pause` | 2 | ✅ 実装済 |
| `GET /api/v1/layout/uv` | 1–2 | ✅ 実装済 |
| `GET /api/v1/layouts` | 2 | ✅ 実装済 |
| `POST /api/v1/device/layout` | 2 | ✅ 実装済 |
| `GET /api/v1/ws`（state 配信） | 1–2 | ✅ 実装済 |
| `GET /api/v1/ws`（interactive） | 1–2 | ✅ interactive UV 合成・複数エフェクト |
| `GET /api/v1/clips`（デモ + メディア統合） | 2 | ✅ 実装済 |
| `PATCH /api/v1/clips/:id`（`displayName`） | 2 | ✅ 実装済 |
| `media/*`（upload / convert / GET 進捗） | 2 | 🟡 画像+ZIP 連番。**動画**は未 |
| `GET /api/v1/ws`（`previewSubscribe` + バイナリ RGB、約 30fps） | 2 | ✅ 実装済 |
| `GET /api/v1/ws`（`getLayoutUv` → `layoutUv`） | 2 | ✅ 実装済 |
| clock modes 関連 | 4 | ⬜ 未実装 |

> 進捗の正本は [`docs/STATUS.md`](../docs/STATUS.md)。本表はスナップショットであり、ズレた場合は STATUS を優先。

OpenAPI 化は Phase 1 着手時に `protocol/control-api.openapi.yaml` へ移行可。
