# Glowbe 制御 API v1

ベース URL: `http://<runtime-host>:8080`（`config.toml` の `server.bind`）

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
  "espStatusAddr": "192.168.0.42:49152",
  "outputTargetAddr": "192.168.0.42:49152",
  "ledCount": 225,
  "loopSequenceId": null,
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
- `espStatusAddr`: ESP STATUS パケットの送信元。

### `POST /api/v1/brightness`（草案・未実装）

```json
{ "value": 128 }
```

グローバル輝度 0–255。実装時はファームまたはランタイムの最終段で適用（[`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §6.5）。

### `POST /api/v1/mode`

```json
{ "mode": "idle" | "loop" | "interactive" | "ripple" | "mic" | "clock_digital" | "clock_analog" }
```

→ 実装済み: **`idle`**（全消灯・**選択シーケンス解除**・WS インタラクティブ合成は無視）、**`loop`**（テストパターンまたは選択シーケンス）、**`interactive`**（消灯ベースで WebSocket のインタラクティブ・パルスのみ UDP に合成。シーケンス選択は保持）。**`ripple`** は **`interactive` と同義**（後方互換用）。`200` + 更新後 `state` オブジェクト。その他のモードは `400`。

### `POST /api/v1/loop/select`

```json
{ "sequenceId": "sunset-01" }
```

→ 実装済み: `assets/sequences/<sequenceId>/manifest.json` と `frames.bin` を読み込み、ランタイムの `layoutId` / `ledCount` と一致すれば loop モードで再生する。失敗時は `400`。

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
    "createdAtUnixSec": 1781332800
  }
]
```

### `POST /api/v1/media/upload`

`multipart/form-data`: `file`（正距円筒画像/動画/ZIP）。

→ `{ "uploadId": "uuid", "status": "stored" }`

### `POST /api/v1/media/:uploadId/convert`

```json
{ "fps": 30, "layoutId": "prototype-icosahedron-15" }
```

→ `{ "jobId": "uuid", "status": "queued" }`

### `GET /api/v1/media/:uploadId`

変換進捗・`sequenceId`（完了時）。

## WebSocket `GET /api/v1/ws`

→ 実装済み: 接続直後と約 1 秒ごとに `state` を送る。`ping` → `pong`。**`masterSettings`** は任意モードでマスター補正を更新（`POST /api/v1/master-tone` と同等）。**`interactive`**（および後方互換の **`ripple`**）メッセージは、出力モードが **`interactive`** のときだけ合成（それ以外は `event_status` `error`）。

### クライアント → サーバ

```json
{ "type": "masterSettings", "brightness": 0.85, "gamma": 1.15 }
{ "type": "interactive", "action": "setEffect", "effect": "expandingRingDiagonal" }
{ "type": "interactive", "action": "pulse", "u": 0.42, "v": 0.71, "effect": "sphereGaussian", "durationMs": 450, "sigmaRad": 0.14, "colorRandom": true }
{ "type": "interactive", "action": "pulse", "u": 0.42, "v": 0.71, "effect": "expandingRingDiagonal", "colorRgb": [255, 120, 40], "ringSpeed": 1.2, "ringThicknessRad": 0.09 }
{ "type": "ripple", "u": 0.42, "v": 0.71, "amplitude": 1.0, "durationMs": 450, "sigmaRad": 0.14 }
{ "type": "ping" }
```

- **`masterSettings`** … `brightness` / `gamma` を任意指定（未指定のキーは**変更しない**）。全モードで有効。
- **`interactive` + `action: "setEffect"`** … 以降のパルスで省略したときに使う既定エフェクトを設定（`effect`: `sphereGaussian` | `expandingRingDiagonal`）。`ripple` 型メッセージでは不可。
- **`interactive` + `action: "pulse"`**（または `action` 省略でパルス扱い）… パルスは **最大 32 本**まで保持し、それを超えると古いものから破棄する。アクティブな全パルスを **線形光（sRGB デコード）で加算**し、合成後に **最大チャンネルが 1 を超える場合だけ線形空間で RGB を一様に縮小**してから sRGB に戻す。残光トレイルが重なるため、赤と緑のリップルが重なった所は **黄に加算混色**される。
  - 共通: **`amplitude`**（既定 1、0–4）、**`colorRandom`: true** でタップごとに鮮やかな色を自動決定、**`colorRgb`: [r,g,b]`** で固定色（`colorRandom` が true なら無視）。
  - **`sphereGaussian`**: **`durationMs`**（既定 450、100–5000）と **`sigmaRad`**（既定約 0.14 rad、0.02–0.6）で寿命とスポット半径を指定する球面ガウス。
  - **`expandingRingDiagonal`**（リップル）: タップ中心から **大円角距離で等方に拡大する波面**と、通過後の**狭い残光トレイル**。**`ringSpeed`**（波面速度）、**`ringThicknessRad`**（バンド幅）、寿命は速度・幅から自動算出。到達前の立ち上がりは `ringThicknessRad` に依存しない固定の短い時間フェザーでタップ点から。`durationMs` は無視。
  - `ripple` 型メッセージはパルス（`sphereGaussian` 既定）のみで、`setEffect` 不可。

### サーバ → クライアント

```json
{ "type": "state", "layoutId": "prototype-icosahedron-15", "mode": "loop", "fpsOut": 60.0 }
{ "type": "pong" }
{ "type": "event_status", "event": "interactive", "status": "ok", "effect": "sphereGaussian" }
{ "type": "event_status", "event": "interactive", "status": "error", "reason": "interactive WS events apply only in output mode \"interactive\"" }
```

`interactive` の `error` は ledmap 欠落など。

**エフェクト:** `sphereGaussian` は球面上ガウス（大円距離）。`expandingRingDiagonal` はタップ中心から**等方に拡大する球面波面**（大円角 θ に対する到達時刻 `θ/c`）と、通過後の指数トレイル。立ち上がりは波面幅に依存しない短い時間フェザーで**点始まり**。トレイルは角度方向にも狭いガウスでゲートし、球全体を埋めない。

## Phase 対応 / 実装状況

| エンドポイント | Phase | 実装 |
|----------------|-------|------|
| `GET /api/v1/state` | 1 | ✅ 実装済 |
| `GET /health` | 1 | ✅ 実装済 |
| `POST /api/v1/mode` (`idle` / `loop` / `interactive`、別名 `ripple`) | 1 | ✅ 実装済 |
| `POST /api/v1/master-tone` | 1 | ✅ 実装済 |
| `GET /api/v1/layout/uv` | 1–2 | ✅ 実装済 |
| `GET /api/v1/ws`（state 配信） | 1–2 | ✅ 実装済 |
| `GET /api/v1/ws`（interactive） | 1–2 | ✅ interactive UV 合成・複数エフェクト |
| `GET /api/v1/sequences` | 2 | ✅ 実装済 |
| `media/*`（upload/convert 等） | 2 | ⬜ 未実装 |
| clock modes 関連 | 4 | ⬜ 未実装 |

> 進捗の正本は [`docs/STATUS.md`](../docs/STATUS.md)。本表はスナップショットであり、ズレた場合は STATUS を優先。

OpenAPI 化は Phase 1 着手時に `protocol/control-api.openapi.yaml` へ移行可。
