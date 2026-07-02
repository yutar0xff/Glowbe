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

1. UDP チャンク RGB（`payload_len` ≤ **1440**）と 1 フレームあたりパケット数
2. ESP: 完全フレーム欠落時に前フレーム保持になっていること（自動消灯しないこと）
3. ESP: `GLOWBE_PLAYOUT_LAG_FRAMES` / `GLOWBE_PLAYOUT_RING_CAP` の値
4. ESP: Wi-Fi 省電力無効、受信タスク優先度
5. AP チャンネル混雑（スキャンして変更）
6. ランタイム送信スレッドの CPU ピン留め（Linux）

## 帯域目安（プロトタイプ）

- 225 LED × 3 = **675 バイト/フレーム**
- 60 fps → **40.5 KB/s** ペイロード（ヘッダ込みでも 2.4 GHz では十分小さい）
- ボトルネックは帯域より **ESP の LED 出力時間（S3: NeoPixelBus LCD / 無印: NeoPixelBus I2S0）+ Wi-Fi スタック遅延** になりやすい

### ESP32 無印（`product-esp32`）— 2026-07-01

| 項目 | 記録 |
|------|------|
| レイアウト | `product-geodesic-2v-60`（1260 LED、10 線、105/147 混在） |
| LED 出力 | NeoPixelBus I2S0 X16。全線 `GLOWBE_MAX_LINE_LEDS`（147）で黒パディング |
| 条件 | ランタイム loop パターン、送信 120–165 fps |
| 同期更新（旧） | `fps_x10≈950`（≈95 fps）@ 送信 120 fps。ボトルネックは `loop()` 内の同期 `set_rgb` + `show` |
| **UDP / LED 分離（現行）** | Core 0 受信 + Core 1 表示、`glowbe_frame_queue.h`（深さ 3）。`fps_x10≈1650`（≈165 fps）、`applied≈frames`、`drops=0`、安定動作確認 |
| 備考 | `GLOWBE_PLAYOUT_LAG_FRAMES=0`（product プロファイル）。送信 fps は実効 **~165 fps** 以下に合わせる |

送信 fps は ESP の実効上限（無印 product でおおよそ **150–170 fps**）以下に合わせること。

## 合格記録（暫定）

### ESP32 無印（`prototype-esp32`）— 2026-06-14

| 項目 | 記録 |
|------|------|
| レイアウト | `prototype-icosahedron-15`（225 LED、5 線） |
| LED 出力 | **NeoPixelBus**（S3: LCD 並列 / 無印: I2S0 並列）。再フラッシュして再計測すること。 |
| 条件 | 60 fps ターゲット、`loop` / テストパターン、**連続 5 分**、`espDrops` 増分 **0**（運用確認） |
| 参考ログ | シリアル `diag`: `fps_x10≈600`（≈60 fps）、`drops=0`、`udp_err=0`（例: `frames` が 5 秒あたり **+300** 程度で増加） |
| ちらつき対策 | 低 fps（5〜10 fps）で消灯混入と切り分け。リンク切れ時の黒フォールバックを廃止し、完全フレーム欠落時は前フレーム保持。`GLOWBE_PLAYOUT_LAG_FRAMES=2` のジッタバッファで解消確認。 |

**注意:** 本番ターゲットの **ESP32-S3**（`prototype` env、LCD+DMA）では同条件の記録を別途取ること。

### 今後の追記

- ファームの **git SHA**、AP 型番、Rust バイナリ版を上表に追記する。
- `docs/benchmarks/` に JSON エクスポートを置く場合は、この節からリンクする。
