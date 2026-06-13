# Glowbe パフォーマンスベンチマーク

**対象ハードウェア（v1）:** プロトタイプ `prototype-icosahedron-15`（225 LED、5 データ線、GPIO 16/17/18/19/21）

## 合格基準

| 項目 | 条件 |
|------|------|
| 最低 fps | **60.0** 以上（`STATUS.fps_rx / 10`） |
| 計測時間 | **連続 5 分** |
| 破棄パケット | `espDrops` 増分が計測区間で **0**（または総フレームの **0.1% 未満**） |
| Wi-Fi | ESP **2.4 GHz STA** のみ |
| サーバ | **有線 Ethernet** 推奨 |
| ランタイム | 合成モード `loop` またはテストパターン（フル RGB 更新） |
| プレビュー | **OFF** で計測（ON は参考値として別記） |

## 環境記録（毎回レポートに含める）

- AP 機種・チャンネル・帯域（2.4 GHz）
- ESP モジュール型番（PSRAM 有無）
- サーバ OS（Ubuntu / Windows）と Rust バイナリ版
- `layout_id`、ファーム git SHA
- サーバ ↔ AP 間距離（おおよそ）

## 計測手順

1. `tools/layout-compile.ts` でプロトタイプレイアウトをコンパイル。
2. ファームをフラッシュ（`firmware/esp32s3`）。
3. ランタイムをテストパターンまたは最短ループで **60 fps ターゲット**起動。
4. ESP `STATUS` またはランタイム `GET /api/v1/state` の `fpsRx` / `espDrops` を 5 分記録。
5. `docs/benchmarks/` に日付付き結果 JSON を保存（未作成なら手動メモ可）。

## 未達時の切り分け順

1. UDP チャンクサイズ（`payload_len` ≤ **1472**）と 1 フレームあたりパケット数
2. ESP: Wi-Fi 省電力無効、受信タスク優先度
3. AP チャンネル混雑（スキャンして変更）
4. ランタイム送信スレッドの CPU ピン留め（Linux）

## 帯域目安（プロトタイプ）

- 225 LED × 3 = **675 バイト/フレーム**
- 60 fps → **40.5 KB/s** ペイロード（ヘッダ込みでも 2.4 GHz では十分小さい）
- ボトルネックは帯域より **ESP の LED 出力時間（S3: LCD+DMA / 無印: FastLED I2S-parallel）+ Wi-Fi スタック遅延** になりやすい

製品版（`product-geodesic-2v-60`）はコンパイル後に同様の表を追記する。

## 合格記録（暫定）

### ESP32 無印（`prototype-esp32`）— 2026-06-14

| 項目 | 記録 |
|------|------|
| レイアウト | `prototype-icosahedron-15`（225 LED、5 線） |
| LED 出力 | **FastLED I2S-parallel**（`FASTLED_ESP32_I2S`、`FASTLED_ESP32_I2S_NUM_DMA_BUFFERS=4`）。本変更後は再フラッシュして再計測すること。 |
| 条件 | 60 fps ターゲット、`loop` / テストパターン、**連続 5 分**、`espDrops` 増分 **0**（運用確認） |
| 参考ログ | シリアル `diag`: `fps_x10≈600`（≈60 fps）、`drops=0`、`udp_err=0`（例: `frames` が 5 秒あたり **+300** 程度で増加） |

**注意:** 本番ターゲットの **ESP32-S3**（`prototype` env、LCD+DMA）では同条件の記録を別途取ること。

### 今後の追記

- ファームの **git SHA**、AP 型番、Rust バイナリ版を上表に追記する。
- `docs/benchmarks/` に JSON エクスポートを置く場合は、この節からリンクする。
