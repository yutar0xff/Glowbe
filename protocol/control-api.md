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
  "loopSequenceId": null,
  "loopSourceFrame": null,
  "loopPlaybackPaused": false,
  "uptimeSec": 3600,
  "frameLoopStaleMs": 12,
  "layoutMismatch": false,
  "framesSent": 216000,
  "masterBrightness": 1,
  "masterGamma": 1
}
```

- `masterBrightness`: 全モード共通の最終輝度係数（0–2、1 が既定）。UDP 直前に各チャンネルへ乗算。
- `masterGamma`: 全モード共通のガンマ補正（約 0.45–3.5、1 が既定）。`out = clamp( ((in/255)×brightness)^(1/gamma) × 255 )`。
- `frameLoopStaleMs`: 直近のフレームループ tick からの経過時間（ms）。出力タスクが停止すると急増する。
- `layoutMismatch`: ESP STATUS の `layout_hash` とランタイムの `meta.layoutHash` が食い違うとき `true`（いずれか欠損時は照合しない）。
- `framesSent`: 完全送信に成功したフレーム数（累計）。
- `outputTargetAddr`: runtime が FRAME を送信している宛先。`espStatusAddr` と IP が違う場合、`config.toml` の `device.esp_ip` が古い可能性が高い。
- `loopSourceFrame`: **`loop` かつシーケンスのフレームが実際に出力バッファへコピーできているとき**、そのソース上のフレーム index（0 始まり）。テストパターンへフォールバック中や `idle` / `interactive` では省略または `null`。
- `loopPlaybackPaused`: **`loop` でシーケンス選択中**にタイムラインが一時停止のとき `true`（`POST /api/v1/loop/pause`）。それ以外は `false`。
- `espStatusAddr`: ESP STATUS パケットの送信元。

### `POST /api/v1/brightness`（草案・未実装）

```json
{ "value": 128 }
```

グローバル輝度 0–255。実装時はファームまたはランタイムの最終段で適用（[`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §6.5）。

### `POST /api/v1/mode`

```json
{ "mode": "idle" | "loop" | "interactive" | "mate" | "mic" | "clock_digital" | "clock_analog" }
```

→ 実装済み: **`idle`**（全消灯・**選択シーケンス解除**・WS インタラクティブ合成は無視）、**`loop`**（テストパターンまたは選択シーケンス）、**`interactive`**（既定は全消灯ベース。WebSocket の **`setSolid`** で全 LED を同一 RGB にしたうえで、インタラクティブ・パルスを UDP 出力に合成。シーケンス選択は保持）。**`mate`**（相棒モード: 球面クォータニオン＋SDF 顔。詳細は [`docs/MATE-MODE.md`](../docs/MATE-MODE.md)）。`200` + 更新後 `state` オブジェクト。その他のモードは `400`。

### `POST /api/v1/mate/state`

相棒モード用の部分更新。出力モードが **`mate`** でないときは `400`。

```json
{
  "expression": "curious",
  "mood": "playful",
  "idle": { "routine": "orbit", "speed": 0.35, "axis": [0, 1, 0] },
  "gaze": { "u": 0.5, "v": 0.42 },
  "gazePull": 0.55,
  "cluster": 0.15,
  "dynamics": { "stiffness": 6.0, "damping": 0.72, "floatiness": 0.35, "trailLag": 0.28 },
  "appearance": { "color": [200, 240, 255], "brightness": 1.0, "faceScale": 1.0, "partsScale": 1.0, "useExpressionTint": true },
  "auto": { "breath": true, "blink": true, "saccade": true, "tremor": false },
  "mouthOpen": 0.2,
  "clearMouthOpen": true,
  "useExpressionTint": true
}
```

→ 実装済み: `appearance.useExpressionTint` またはトップレベル `useExpressionTint` が `true` のとき、表情プリセット色への追従に戻す（`appearance.color` による固定を解除）。`200` + 更新後 `state`（`mode` が `mate` のとき `mate` 要約を含む）。

### `POST /api/v1/loop/select`

```json
{ "sequenceId": "sunset-01" }
```

→ 実装済み: `assets/sequences/<sequenceId>/manifest.json` と `frames.bin` を読み込み、ランタイムの `layoutId` / `ledCount` と一致すれば loop モードで再生する。失敗時は `400`。

### `POST /api/v1/loop/clear-selection`

ボディ不要。

→ 実装済み: 選択中のシーケンスを解除し（`loopSequenceId` を `null`）、出力モードを **`loop`** にする。シーケンス無しのテストパターンへ移行する。`200` + 更新後 `state`。

### `POST /api/v1/loop/pause`

```json
{ "paused": true }
```

→ 実装済み: **`loop` かつシーケンス選択中**のとき、シーケンスのタイムラインを一時停止（`paused: true`）または再開（`paused: false`）。`idle` / `interactive` / `mate` では状態のみ更新され、出力の見え方はモードに従う。`200` + 更新後 `state`（`loopPlaybackPaused` を含む）。

### `POST /api/v1/master-tone`

```json
{ "brightness": 1.0, "gamma": 1.0 }
```

→ 実装済み: **全出力モード**で、フレームを UDP に送る直前に適用するマスター補正。`brightness` は 0–2（クランプ）、`gamma` は約 0.45–3.5（クランプ）。`200` + 更新後 `state` オブジェクト。

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

→ 実装済み: ランタイムの **`layoutId` / `ledCount` / `layoutHash` 期待値**を切り替え、プレビューバッファを再確保する。現在のループシーケンスの `manifest.layoutId` または LED 数が一致しない場合は **選択解除**（テストパターンへ）。`config.toml` は書き換えない。`400` + `{ "error": "..." }`（メタ JSON が無い等）。成功時は `200` + 更新後 `state`。

**注意:** ESP はコンパイル時に埋め込んだ `layout_hash` / `led_count` と一致するフレームのみ受け入れる。Studio のレイアウト選択と実機ファームを揃えること。

### `GET /health`

ヘルスチェック。**プレーンテキスト**。

- 出力ループが直近 **1000ms** 以内に tick していれば `200 OK` + 本文 `ok`。
- それ以外（タスク停止・長時間ブロック等）では `503 Service Unavailable` + 本文 `stale: output loop tick too old`。

監視・起動確認用。

### `GET /api/v1/sequences`

変換済みシーケンス一覧。実装済み。

```json
[
  {
    "id": "anim10003",
    "layoutId": "prototype-icosahedron-15",
    "ledCount": 225,
    "frameCount": 1,
    "fps": 1,
    "sourceKind": "equirectangular-image",
    "sourceWidth": 1024,
    "sourceHeight": 512,
    "createdAtUnixSec": 1781332800,
    "displayName": "My clip"
  }
]
```

任意キー **`displayName`**（UI 用・最大約 120 文字）。未設定のシーケンスでは省略され得る。

### `GET /api/v1/sequences/:sequenceId/source-frame/:frameIndex`

→ 実装済み: シーケンスに同梱されたインポート（`source-import.*`）から、指定フレームを **PNG** で返す。`frameIndex` は `0 .. frameCount-1`。`manifest.source.kind` が **`equirectangular-image`**（単一画像は 0 のみ）、**`equirectangular-image-sequence`**、**`equirectangular-video`**（サーバに `ffmpeg` が必要）に対応。インポートファイルが無いシーケンスでは `404`。

### `DELETE /api/v1/sequences/:sequenceId`

→ 実装済み: `assets/sequences/<sequenceId>/` を **ディスクから完全削除**（`manifest.json`・`frames.bin`・`source-import.*` など含む）。現在そのシーケンスをループ再生中なら、先に選択を解除してから削除する。成功時は **`204 No Content`**。ディレクトリが無い場合は `404`。

### `PATCH /api/v1/sequences/:sequenceId`

```json
{ "displayName": "New label" }
```

→ 実装済み: `manifest.json` の `displayName` を更新（空文字でキー削除）。`200` + 更新後のシーケンス要約（`GET /api/v1/sequences` と同形の 1 要素相当）。シーケンスが無い場合は `404`。

### `POST /api/v1/media/upload`

`multipart/form-data`: `file`（正距円筒画像/動画/ZIP）。

→ 実装済み: **`file` は PNG / JPEG / ZIP / MP4 / WebM / MOV / MKV**（拡張子または先頭マジックで ZIP 判定）。本文上限はランタイムで約 **48MiB**。

→ `{ "uploadId": "uuid", "status": "stored" }`

### `POST /api/v1/media/:uploadId/convert`

```json
{ "fps": 30, "layoutId": "prototype-icosahedron-15", "displayName": "Optional label" }
```

→ `{ "jobId": "uuid", "status": "queued" }`

→ 実装済み（**正距円筒 PNG/JPEG 1 枚**、**ZIP 内の同名サイズ PNG/JPEG 連番**・最大 **3600** フレーム・ファイル名ソート、または **動画** を **`ffmpeg`** で指定 `fps` にリサンプルして最大 3600 フレーム）。`manifest.source.kind` は `equirectangular-image` / `equirectangular-image-sequence` / `equirectangular-video`。元ファイルはシーケンスディレクトリに `source-import.<ext>` として複製され、プレビュー API 用の参照になる。

### `GET /api/v1/media/:uploadId`

変換進捗・`sequenceId`（完了時）。

→ 実装済み。例:

```json
{
  "uploadId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "running",
  "jobId": "...",
  "progress": 0
}
```

`status`: `stored` | `running` | `done` | `failed`。`running` 中は **`progress` が 0–99** で変換のおおよその進捗（ZIP 多フレーム時）。`done` のとき `sequenceId` と `progress: 100`。`failed` のとき `error`。

## WebSocket `GET /api/v1/ws`

→ 実装済み: 接続直後と約 1 秒ごとに `state` を送る。`ping` → `pong`。**`masterSettings`** は任意モードでマスター補正を更新（`POST /api/v1/master-tone` と同等）。**`interactive`** メッセージは、出力モードが **`interactive`** のときだけ合成（それ以外は `event_status` `error`）。**`mate`** メッセージは、出力モードが **`mate`** のときだけ `mate` 状態へ反映（それ以外は `event_status` `error`）。**`previewSubscribe`** で有効化した接続には、約 **30fps** で **バイナリ** LED フレーム（UDP 直前と同一の最終 RGB）が送られる。

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
{ "type": "mate", "action": "setExpression", "expression": "happy" }
{ "type": "mate", "action": "setGaze", "u": 0.42, "v": 0.71, "gazePull": 0.6 }
{ "type": "mate", "action": "setDynamics", "stiffness": 8.0, "damping": 0.65 }
{ "type": "mate", "action": "setAppearance", "color": [255, 200, 220], "brightness": 0.95 }
{ "type": "mate", "action": "setAppearance", "faceScale": 2.5, "partsScale": 1.2 }
{ "type": "mate", "action": "clearMouthOpen" }
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
- **`mate` + `action`** … 出力モードが **`mate`** のときのみ。`setExpression` / `setMood` / `setIdle` / `setGaze` / `setDynamics` / `setAppearance` / `setAuto` / `setMouthOpen`（`value`）/ `clearMouthOpen`。フィールドの意味は `POST /api/v1/mate/state` と [`docs/MATE-MODE.md`](../docs/MATE-MODE.md) §12 に準拠。応答は `event_status`（`event`: `mate`）。

### サーバ → クライアント

```json
{ "type": "state", "layoutId": "prototype-icosahedron-15", "mode": "loop", "fpsOut": 60.0 }
{ "type": "layoutUv", "layoutId": "prototype-icosahedron-15", "ledCount": 225, "leds": [ { "i": 0, "u": 0.5, "v": 0.5 } ] }
{ "type": "pong" }
{ "type": "event_status", "event": "interactive", "status": "ok", "action": "setSolid", "enabled": true, "colorRgb": [16, 16, 24] }
{ "type": "event_status", "event": "interactive", "status": "ok", "effect": "sphereGaussian" }
{ "type": "event_status", "event": "mate", "status": "ok", "action": "setGaze" }
{ "type": "event_status", "event": "mate", "status": "error", "reason": "mate WS events apply only in output mode \"mate\"" }
```

`interactive` の `error` は ledmap 欠落など。`mate` の `error` はモード不一致や必須フィールド欠落など。

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
| `POST /api/v1/mode` (`idle` / `loop` / `interactive` / `mate`) | 1 | ✅ 実装済 |
| `POST /api/v1/mate/state` | 2 | ✅ 実装済 |
| `POST /api/v1/master-tone` | 1 | ✅ 実装済 |
| `POST /api/v1/loop/select` | 2 | ✅ 実装済 |
| `POST /api/v1/loop/clear-selection` | 2 | ✅ 実装済 |
| `POST /api/v1/loop/pause` | 2 | ✅ 実装済 |
| `GET /api/v1/layout/uv` | 1–2 | ✅ 実装済 |
| `GET /api/v1/layouts` | 2 | ✅ 実装済 |
| `POST /api/v1/device/layout` | 2 | ✅ 実装済 |
| `GET /api/v1/ws`（state 配信） | 1–2 | ✅ 実装済 |
| `GET /api/v1/ws`（interactive） | 1–2 | ✅ interactive UV 合成・複数エフェクト |
| `GET /api/v1/ws`（mate） | 2 | ✅ mate 状態の WS 更新 |
| `GET /api/v1/sequences`（任意 `displayName`） | 2 | ✅ 実装済 |
| `PATCH /api/v1/sequences/:id`（`displayName`） | 2 | ✅ 実装済 |
| `media/*`（upload / convert / GET 進捗） | 2 | 🟡 画像+ZIP 連番。**動画**は未 |
| `GET /api/v1/ws`（`previewSubscribe` + バイナリ RGB、約 30fps） | 2 | ✅ 実装済 |
| `GET /api/v1/ws`（`getLayoutUv` → `layoutUv`） | 2 | ✅ 実装済 |
| clock modes 関連 | 4 | ⬜ 未実装 |

> 進捗の正本は [`docs/STATUS.md`](../docs/STATUS.md)。本表はスナップショットであり、ズレた場合は STATUS を優先。

OpenAPI 化は Phase 1 着手時に `protocol/control-api.openapi.yaml` へ移行可。
