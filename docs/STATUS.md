# Glowbe — 実装状況・引き継ぎ（STATUS）

> **役割:** 本書は「いま何ができていて、次に何をやるか」の**正本**。
> 設計の「あるべき姿」は [`ARCHITECTURE.md`](ARCHITECTURE.md)、各仕様は [`../protocol/`](../protocol/)。
> 最終更新: 2026-06-15（相棒 `mate` モード・`POST /api/v1/mate/state`・WS `mate`・Studio Mate タブ）

---

## 1. 全体サマリ

| 指標 | 現在地 |
|------|--------|
| フェーズ | **Phase 2（静止画→シーケンス最小パイプライン実装中）** |
| ランタイム | loop パターン / 選択シーケンス再生 + 状態 API。`cargo test` **13** 件パス |
| ファーム | UDP 受信・フレーム再構成・S3(NeoPixelBus LCD)/無印(NeoPixelBus I2S0) ドライバ実装済。欠落時は前フレーム保持 + プレイアウト遅延 |
| UDP E2E | ESP32 **無印**で 60fps×5 分ベンチ通過、ちらつき解消を確認（記録: [`BENCHMARK.md`](BENCHMARK.md)）。**ESP32-S3 本番ボードでは未再計測** |
| Web | **Glowbe Studio**（Loop / Interactive / Idle / **Mate**・状態/モード・シーケンス表示名・ZIP/画像アップロード・**UV 散布プレビュー**） |
| メディアパイプライン | **Phase 2**（静止画 / **ZIP 連番**→シーケンス・`displayName`・進捗 GET） |

> ハードウェア前提: ESP32-S3 が本番。S3 実機が「届いたら本番」、手元の ESP32 無印で先行検証する想定（`docs/firmware/LED-OUTPUT.md`）。

---

## 2. コンポーネント別ステータス

凡例: ✅ 実装済 / 🟡 一部 / ⬜ 未着手 / 📄 設計のみ

| コンポーネント | パス | 状況 | 備考 |
|----------------|------|------|------|
| Rust ランタイム | `runtime/` | 🟡 | 送信失敗でループ停止しない・60 連続失敗で再接続／mDNS（`esp_ip` 省略時）／`[assets].compiled_dir`／ホットパス atomics／`layoutMismatch`・**論理 RGB** ワイヤ |
| `Mode` trait・モード合成 | `runtime/`（§9） | 🟡 | trait 化は未実装。`idle` / `loop` / `interactive`（別名 `ripple`）/ **`mate`** |
| メディアワーカー / 変換 | `runtime/src/media.rs` + HTTP `media/*` | 🟡 | CLI + **REST**（PNG/JPEG・**ZIP 連番**・`PATCH …/sequences` で表示名） |
| サーバマイク（cpal） | `runtime/`（§6.1） | ⬜ | Phase 4 |
| Web クライアント | `web/` | ✅ | **Glowbe Studio**（Loop: 画像/ZIP アップロード・表示名・**UV プレビュー**・シーケンス一覧） |
| ESP ファーム（共通） | `firmware/esp32s3/` | ✅ | Wi-Fi STA / UDP / 再構成 / **20 バイト STATUS**（`layout_hash`）。LED は UDP のみ（マイコン内アニメなし）。受信途絶時は前フレーム保持 |
| LED ドライバ S3 | `src/led_driver_s3.cpp` | ✅ | NeoPixelBus LCD 並列（`NeoEsp32LcdX8/X16Ws2812xMethod`）、論理 RGB → `NeoGrbFeature` |
| LED ドライバ 無印 | `src/led_driver_esp32.cpp` | ✅ | NeoPixelBus I2S0 並列（`NeoEsp32I2s0X8/X16Ws2812xMethod`）、論理 RGB 入力 |
| レイアウト v1 + コンパイル | `config/layouts/`, `tools/layout-compile.ts` | ✅ | **`layoutHash` / `GLOWBE_LAYOUT_HASH`** を出力。プロトタイプ 225 LED コンパイル済 |
| プロトコル文書 | `protocol/` | ✅ | udp-wire / control-api / glowseq / compiled-layout |
| ベンチツール | `tools/bench-udp.mjs`, `tools/listen-status.mjs` | ✅ | 無印で合格記録あり（[`BENCHMARK.md`](BENCHMARK.md)） |
| PCB / hardware | `hardware/pcb/` | ⬜ | ディレクトリ未追加 |

---

## 3. API エンドポイント別

| エンドポイント | 状況 | メモ |
|----------------|------|------|
| `GET /api/v1/state` | ✅ | `layoutId, mode, …`。**`mode` が `mate` のとき任意で `mate` 要約**（[`MATE-MODE.md`](MATE-MODE.md)） |
| `GET /health` | ✅ | 出力ループ tick が **1s 超 stale** なら **503**、そうでなければ **200 ok** |
| `POST /api/v1/mode` | ✅ | `idle` / `loop` / `interactive`（別名 `ripple`）/ **`mate`** |
| `POST /api/v1/mate/state` | ✅ | **`mate` 時のみ** JSON パッチ（表情・視線・外観・自動微動作など） |
| `POST /api/v1/master-tone` | ✅ | 全モード最終段の明るさ・ガンマ（`masterBrightness` / `masterGamma` を `state` に反映） |
| `GET /api/v1/sequences` | ✅ | 一覧（任意 **`displayName`**） |
| `PATCH /api/v1/sequences/:id` | ✅ | `manifest.json` の **`displayName`** 更新 |
| `GET /api/v1/layout/uv` | ✅ | `assets/compiled/<layoutId>.ledmap.json` を返す |
| `GET /api/v1/ws`（state 配信） | ✅ | 接続直後 + 1 秒ごとに state を送信 |
| `GET /api/v1/ws`（interactive） | ✅ | `interactive` 複数パルス同時加算・色/輪パラメータ・`masterSettings`。`ripple` 型パルス |
| `GET /api/v1/ws`（mate） | ✅ | **`mate` 時のみ** `type: "mate"` + `action` で状態更新（[`MATE-MODE.md`](MATE-MODE.md) §12） |
| `media/upload`, `media/convert`, `GET …/media/:uploadId` | 🟡 | **PNG/JPEG + ZIP**（正距円筒連番）・進捗 **`progress`**。**動画**は未 |
| `GET /api/v1/ws` `getLayoutUv` | ✅ | **`layoutUv`** 応答（`GET /layout/uv` 相当） |

詳細仕様: [`../protocol/control-api.md`](../protocol/control-api.md)

---

## 4. モード別（§9）

| モード | id | 状況 |
|--------|-----|------|
| ループ再生 | `loop` | 🟡 シーケンス未選択時は内蔵テストパターン（`pattern.rs`）。色相は **`ledmap` の (u,v)**（欠落時はワイヤ順フォールバック） |
| インタラクティブ（消灯＋WS） | `interactive` | ✅ 消灯出力＋WS `interactive`（別名メッセージ型 `ripple`）でパルス合成。エフェクト: `sphereGaussian` / `expandingRingDiagonal`（既定 `expandingRingDiagonal`）。`loop` では WS 合成は拒否 |
| 相棒（球面顔） | `mate` | ✅ 黒ベース＋`mate.rs` の SDF 顔。`POST /api/v1/mate/state` と WS `mate`。設計 [`MATE-MODE.md`](MATE-MODE.md) |
| 後方互換 | `ripple`（モード id） | ✅ `interactive` と同義（REST / state では `interactive` を推奨） |
| デジタル時計 | `clock_digital` | ⬜ Phase 4a（ロードマップ分割後） |
| アナログ時計 | `clock_analog` | ⬜ Phase 4a |
| サーバマイク | `mic` | ⬜ Phase 4b |

---

## 5. プロトコル整合（重要メモ）

- **STATUS offset 10 は `drops`**。実装・仕様・API（`espDrops`）で一致。
- **STATUS 拡張（20 バイト）:** 末尾 4 バイトに `layout_hash`（FNV-1a）。ランタイムは `meta.layoutHash` と照合し `layoutMismatch` を立てる。16 バイトのみの旧ファームは照合スキップ。
- **FRAME ペイロード上限** ランタイム・ファームとも **1472 バイト**（旧 1020 から拡大）。ESP 側 `FrameAssembler` バッファ **4096** バイト。
- **ワイヤ色順:** **論理 RGB**（R,G,B）。GRB 物理順は **NeoPixelBus `NeoGrbFeature`** が担当（二重変換を解消済み）。
- **欠落時表示:** 完全フレームが揃わない場合は LED を更新せず、最後に表示したフレームを保持する。受信途絶で自動消灯しない。
- **プレイアウト遅延:** ファーム側 `GLOWBE_PLAYOUT_LAG_FRAMES` 既定 2、リング 8。ESP32 無印で低 fps でも出ていた消灯ちらつきは、この方針で解消確認済み。
- 現ファームの `drops` は主に **不正ヘッダで破棄したパケット数**。
- **未完成フレーム破棄:** `FrameAssembler` は、別 `frame_id` に切り替わる際に前フレームが未完なら **`incomplete_frame_aborts`** を増やす（シリアル `diag` の `frame_aborts=`）。STATUS の `drops` とは別指標（ワイヤ上の STATUS には未載せ）。

---

## 6. 既知の課題 / TODO

| # | 内容 | 優先 |
|---|------|------|
| 1 | **ESP32-S3 で 60fps×5 分ベンチを再計測し `BENCHMARK.md` に追記** | 高（本番ハード検証） |
| 2 | ~~WebSocket の interactive~~ → 実装済 | 完了 |
| 3 | `Mode` trait 導入（loop 固定からプラグイン化へ） | 中 |
| 4 | ~~frame-drop（チャンク欠落）カウント~~ → シリアル `frame_aborts`（`FrameAssembler::incomplete_frame_aborts`）で計上 | 完了（STATUS への載せは未） |
| 5 | LICENSE 確定（README "TBD"。完全オープン方針なら明示） | 中 |
| 6 | 製品レイアウト `product-geodesic-2v-60` のコンパイル・検証 | 中 |
| 8 | `hardware/pcb/glowbe-revA/` の追加 | 低 |
| 9 | **判断待ち:** `SK6805` と NeoPixelBus `NeoGrbFeature`/`Ws2812x` タイミングの整合／`SK6812` 等への切替 | 低 |
| 10 | PlatformIO ファームの `pio run` を CI に追加（キャッシュ設定含む） | 低 |

**直近の実装反映:** Phase 2 最小（`convert-image` CLI、`GET /api/v1/sequences`、`GET /api/v1/layout/uv`、`GET /api/v1/ws` state + **interactive（複数エフェクト）**、`POST /api/v1/loop/select`、Web 選択 UI、選択シーケンス再生）、Phase 1.5 Web、UDP 送信失敗耐性、layout hash、mDNS、GitHub Actions（Rust + Web）、**S3/無印: NeoPixelBus LED 出力（マイコン内アニメなし）**、前フレーム保持 + プレイアウト遅延によるちらつき対策。

---

## 7. 次の具体タスク（Phase 1 締め）

1. **ESP32-S3 実機でベンチ再計測**: 無印と同条件で 5 分 → [`BENCHMARK.md`](BENCHMARK.md) に追記（本番ボード到着後の最優先）。
2. Phase 2 を拡張（**動画変換**、進捗のより細かい割合、ZIP 以外のコンテナ）。正距円筒 **UV** は Studio の散布プレビューと WS **`getLayoutUv`** / **`layoutUv`** で対応済み。
3. 同一プレイアウト設定で S3 実機ベンチを再計測（上記 1 とまとめ可能）。

---

## 8. 開発環境セットアップ

| 対象 | 要件 | コマンド |
|------|------|----------|
| レイアウト | Node 20+ | `npx tsx tools/layout-compile.ts config/layouts/prototype.layout.json` |
| ランタイム | Rust toolchain + C linker | `cd runtime && cargo run -- ../config.toml` |
| Web | Node 20+ | `cd web && npm install && npm run dev`（`/api` と WS をランタイムへプロキシ。`/` のみ） |
| 静止画変換 | Rust + PNG/JPEG | `cargo run --manifest-path runtime/Cargo.toml -- convert-image /path/to/image.png sequence-id config.toml` |
| ファーム | PlatformIO（`uv`） | `cd firmware/esp32s3 && uv sync && uv run pio run -e prototype -t upload` |
| ベンチ | Node 20+ | `docs/BENCHMARK.md` 参照 |

`config.toml` は `config.example.toml` をコピーする。**`device.esp_ip`** は実機 IP にするか、**省略**して同一 LAN で **mDNS**（ESP が `_glowbe._udp` を広告）を使う。

---

## 9. 引き継ぎ上の注意

- `archived-glowbe` は **幾何・UV マッピングの参照のみ**。コードマージ・プロトコル/ファーム互換は非目標（§20）。
- ESP32-S3 は無印の I2S パラレルとは別アーキ。**S3 = LCD+DMA**（`docs/firmware/LED-OUTPUT.md`）。
- すべてのピクセルはランタイムが生成する**単一ライター**原則を崩さない（§設計原則 1）。
