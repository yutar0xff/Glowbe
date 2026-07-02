# 開発メモ（ランタイム + Web + ESP）

環境変数は [`ENV.md`](ENV.md) を参照。

## 起動

1. `config.toml` の `[server] bind`（既定例は `0.0.0.0:8748`）
2. `cd runtime && cargo run -- ../config.toml`
3. `cd web && npm run dev`（プロキシ先は `web/.env.development`、上書きは `.env.development.local`）

## 本番ランタイムと開発

同一 ESP へはランタイムを一つにする。本番 Web を動かしたまま `npm run dev` する分には通常問題にならない。

## Idle と UDP

`idle` でもフレーム送出ループは動き、黒フレームを UDP で送り続ける。複数ランタイムで同一 `esp_ip` に向けないこと。

## HTTP ポート

`[server] bind` で変更。リポジトリの既定例は 8748。

## Studio のライブ LED プレビュー

Loop（クリップ再生中）・Interactive・Mate の各 Studio タブに組み込み済み。ランタイムの WebSocket `previewSubscribe` とバイナリ LED フレーム（約 30fps、マスター補正後の最終 RGB）で 2D / 3D マップを更新する。仕様は [`protocol/control-api.md`](../protocol/control-api.md) を参照。
