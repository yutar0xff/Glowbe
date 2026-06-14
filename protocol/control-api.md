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
  "framesSent": 216000
}
```

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
{ "mode": "idle" | "loop" | "ripple" | "interactive" | "mic" | "clock_digital" | "clock_analog" }
```

→ 実装済み: **`idle`**（全消灯・**選択シーケンス解除**・WS `ripple` は無視）、**`loop`**（テストパターンまたは選択シーケンス）、**`ripple`**（消灯ベースで WebSocket の `ripple` のみ UDP に合成。シーケンス選択は保持）。`200` + 更新後 `state` オブジェクト。その他のモードは `400`。

### `POST /api/v1/loop/select`

```json
{ "sequenceId": "sunset-01" }
```

→ 実装済み: `assets/sequences/<sequenceId>/manifest.json` と `frames.bin` を読み込み、ランタイムの `layoutId` / `ledCount` と一致すれば loop モードで再生する。失敗時は `400`。

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

→ 実装済み: 接続直後と約 1 秒ごとに `state` を送る。`ping` → `pong`。**`ripple`** メッセージはランタイムの出力モードが **`ripple`** のときだけ UV 波紋を合成（それ以外は `event_status` `error`）。`subscribe_preview` / `unsubscribe_preview` と `preview_frame` は従来どおり。

### クライアント → サーバ

```json
{ "type": "ripple", "u": 0.42, "v": 0.71, "amplitude": 1.0 }
{ "type": "subscribe_preview", "quality": 70 }
{ "type": "unsubscribe_preview" }
{ "type": "ping" }
```

### サーバ → クライアント

```json
{ "type": "state", "layoutId": "prototype-icosahedron-15", "mode": "loop", "fpsOut": 60.0 }
{ "type": "pong" }
{ "type": "preview_status", "status": "available", "quality": 70 }
{ "type": "preview_status", "status": "stopped", "reason": "client unsubscribed" }
{ "type": "event_status", "event": "ripple", "status": "ok" }
{ "type": "event_status", "event": "ripple", "status": "error", "reason": "ripple WS events apply only in output mode \"ripple\"" }
{ "type": "preview_frame", "format": "jpeg", "seq": 12004, "data": "<base64>" }
```

`preview_status` は `available`（購読開始）・`stopped`（`unsubscribe_preview`）・将来用の `unavailable` など。`ripple` の `error` は ledmap 欠落など。

## Phase 対応 / 実装状況

| エンドポイント | Phase | 実装 |
|----------------|-------|------|
| `GET /api/v1/state` | 1 | ✅ 実装済 |
| `GET /health` | 1 | ✅ 実装済 |
| `POST /api/v1/mode` (`idle` / `loop` / `ripple`) | 1 | ✅ 実装済 |
| `POST /api/v1/loop/select` | 2 | ✅ 実装済 |
| `GET /api/v1/layout/uv` | 1–2 | ✅ 実装済 |
| `GET /api/v1/ws`（state 配信） | 1–2 | ✅ 実装済 |
| `GET /api/v1/ws`（ripple/preview） | 1–2 | ✅ ripple UV 合成・JPEG プレビュー配信 |
| `GET /api/v1/sequences` | 2 | ✅ 実装済 |
| `media/*`（upload/convert 等） | 2 | ⬜ 未実装 |
| clock modes 関連 | 4 | ⬜ 未実装 |

> 進捗の正本は [`docs/STATUS.md`](../docs/STATUS.md)。本表はスナップショットであり、ズレた場合は STATUS を優先。

OpenAPI 化は Phase 1 着手時に `protocol/control-api.openapi.yaml` へ移行可。
