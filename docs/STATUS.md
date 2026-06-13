# Glowbe — 実装状況・引き継ぎ（STATUS）

> **役割:** 本書は「いま何ができていて、次に何をやるか」の**正本**。  
> 設計の「あるべき姿」は [`ARCHITECTURE.md`](ARCHITECTURE.md)、各仕様は [`../protocol/`](../protocol/)。  
> 最終更新: 2026-06-14（堅牢性・プロトコル・計画ドキュメントの一括反映）

---

## 1. 全体サマリ

| 指標 | 現在地 |
|------|--------|
| フェーズ | **Phase 2（静止画→シーケンス最小パイプライン実装中）** |
| ランタイム | loop パターン / 選択シーケンス再生 + 状態 API。`cargo test` **5** 件パス |
| ファーム | UDP 受信・フレーム再構成・S3(LCD+DMA)/無印(RMT) ドライバ実装済 |
| UDP E2E | 「成功扱い」。**60fps×5 分ベンチの合格記録は未取得**（[`BENCHMARK.md`](BENCHMARK.md)） |
| Web | **Phase 1.5 完了**（状態ダッシュボード + `idle`/`loop` 切替） |
| メディアパイプライン | **Phase 2 最小実装**（正距円筒静止画→1フレームシーケンス） |

> ハードウェア前提: ESP32-S3 が本番。S3 実機が「届いたら本番」、手元の ESP32 無印で先行検証する想定（`docs/firmware/LED-OUTPUT.md`）。

---

## 2. コンポーネント別ステータス

凡例: ✅ 実装済 / 🟡 一部 / ⬜ 未着手 / 📄 設計のみ

| コンポーネント | パス | 状況 | 備考 |
|----------------|------|------|------|
| Rust ランタイム | `runtime/` | 🟡 | 送信失敗でループ停止しない・60 連続失敗で再接続／mDNS（`esp_ip` 省略時）／`[assets].compiled_dir`／ホットパス atomics／`layoutMismatch`・**論理 RGB** ワイヤ |
| `Mode` trait・モード合成 | `runtime/`（§9） | 🟡 | trait 化は未実装。`idle`/`loop` は atomic flag で最小切替済み |
| メディアワーカー / 変換 | `runtime/src/media.rs` | 🟡 | CLI `convert-image` で正距円筒 PNG/JPEG → `manifest.json` + `frames.bin`（1フレーム） |
| プレビュー（WS JPEG） | `runtime/`（§14） | ⬜ | |
| サーバマイク（cpal） | `runtime/`（§6.1） | ⬜ | Phase 4 |
| Web クライアント | `web/` | ✅ | Vite + React。`/api/v1/state` と `/health` を1秒ポーリングし、`idle`/`loop` を切替 |
| ESP ファーム（共通） | `firmware/esp32s3/` | ✅ | Wi-Fi STA / UDP / 再構成 / **20 バイト STATUS**（`layout_hash`）/ idle パターン |
| LED ドライバ S3 | `src/led_driver_s3.cpp` | ✅ | LCD+DMA、`setMaxPower`（暫定 4000mA TODO）、論理 RGB 入力 |
| LED ドライバ 無印 | `src/led_driver_esp32.cpp` | ✅ | RMT per line、同上 |
| レイアウト v1 + コンパイル | `config/layouts/`, `tools/layout-compile.ts` | ✅ | **`layoutHash` / `GLOWBE_LAYOUT_HASH`** を出力。プロトタイプ 225 LED コンパイル済 |
| プロトコル文書 | `protocol/` | ✅ | udp-wire / control-api / glowseq / compiled-layout |
| ベンチツール | `tools/bench-udp.mjs`, `tools/listen-status.mjs` | ✅ | 合格記録は未取得 |
| PCB / hardware | `hardware/pcb/` | ⬜ | ディレクトリ未追加 |

---

## 3. API エンドポイント別

| エンドポイント | 状況 | メモ |
|----------------|------|------|
| `GET /api/v1/state` | ✅ | `layoutId, mode, fpsOut, fpsRx, espRssi, espDrops, ledCount, loopSequenceId, uptimeSec, frameLoopStaleMs, layoutMismatch, framesSent` |
| `GET /health` | ✅ | 出力ループ tick が **1s 超 stale** なら **503**、そうでなければ **200 ok** |
| `POST /api/v1/mode` | ✅ | `idle` / `loop` の最小切替。`idle` は黒フレーム、`loop` はテストパターン |
| `POST /api/v1/loop/select` | ✅ | 生成済みシーケンスを読み込み、layout/LED 数一致時に loop へ選択 |
| `GET /api/v1/layout/uv` | ⬜ | UV プレビュー |
| `GET /api/v1/ws`（ripple/preview） | ⬜ | |
| `media/*`, `GET /api/v1/sequences` | ⬜ | Phase 2 |

詳細仕様: [`../protocol/control-api.md`](../protocol/control-api.md)

---

## 4. モード別（§9）

| モード | id | 状況 |
|--------|-----|------|
| ループ再生 | `loop` | 🟡 現状は変換シーケンス再生ではなく、ランタイム内蔵のテストパターン（`pattern.rs`）を送出 |
| インタラクティブ | `interactive` | ⬜ Phase 3 |
| デジタル時計 | `clock_digital` | ⬜ Phase 4a（ロードマップ分割後） |
| アナログ時計 | `clock_analog` | ⬜ Phase 4a |
| サーバマイク | `mic` | ⬜ Phase 4b |

---

## 5. プロトコル整合（重要メモ）

- **STATUS offset 10 は `drops`**。実装・仕様・API（`espDrops`）で一致。
- **STATUS 拡張（20 バイト）:** 末尾 4 バイトに `layout_hash`（FNV-1a）。ランタイムは `meta.layoutHash` と照合し `layoutMismatch` を立てる。16 バイトのみの旧ファームは照合スキップ。
- **FRAME ペイロード上限** ランタイム・ファームとも **1472 バイト**（旧 1020 から拡大）。ESP 側 `FrameAssembler` バッファ **4096** バイト。
- **ワイヤ色順:** **論理 RGB**（R,G,B）。GRB 物理順は FastLED の `GRB` テンプレートのみが担当（二重変換を解消済み）。
- 現ファームの `drops` は主に **不正ヘッダで破棄したパケット数**。
  - ⚠️ **TODO:** チャンク欠落による未完成フレーム破棄の計上（`FrameAssembler` 拡張）。

---

## 6. 既知の課題 / TODO

| # | 内容 | 優先 |
|---|------|------|
| 1 | **60fps×5 分ベンチの合格記録を取得し `BENCHMARK.md` に追記** | 高（Phase 1 完了条件） |
| 2 | 残 API（`layout/uv` / `ws`）の実装方針確定 | 高 |
| 3 | `Mode` trait 導入（loop 固定からプラグイン化へ） | 中 |
| 4 | frame-drop（チャンク欠落）カウントの実装 | 中 |
| 5 | LICENSE 確定（README "TBD"。完全オープン方針なら明示） | 中 |
| 6 | 製品レイアウト `product-geodesic-2v-60` のコンパイル・検証 | 中 |
| 8 | `hardware/pcb/glowbe-revA/` の追加 | 低 |
| 9 | **判断待ち:** `SK6805` と FastLED `WS2812` テンプレの組み合わせ／`SK6812` 等への切替 | 低 |
| 10 | PlatformIO ファームの `pio run` を CI に追加（キャッシュ設定含む） | 低 |

**直近の実装反映:** Phase 2 最小（`convert-image` CLI、`POST /api/v1/loop/select`、選択シーケンス再生）、Phase 1.5 Web、UDP 送信失敗耐性、layout hash、mDNS、GitHub Actions（Rust + Web）。

---

## 7. 次の具体タスク（Phase 1 締め）

1. **実機 or ループバックでベンチ**: `tools/bench-udp.mjs` と `tools/listen-status.mjs` で送出/受信 fps を計測 → 結果を [`BENCHMARK.md`](BENCHMARK.md) に記録。
2. Web から `loop/select` できるシーケンス選択 UI を追加。
3. Phase 2 を拡張（アップロード API、`GET /api/v1/sequences`、動画/複数フレーム変換）。

---

## 8. 開発環境セットアップ

| 対象 | 要件 | コマンド |
|------|------|----------|
| レイアウト | Node 20+ | `npx tsx tools/layout-compile.ts config/layouts/prototype.layout.json` |
| ランタイム | Rust toolchain + C linker | `cd runtime && cargo run -- ../config.toml` |
| Web | Node 20+ | `cd web && npm install && npm run dev`（状態表示 + `idle`/`loop` 切替。既定で runtime `127.0.0.1:8080` へプロキシ） |
| 静止画変換 | Rust + PNG/JPEG | `cargo run --manifest-path runtime/Cargo.toml -- convert-image /path/to/image.png sequence-id config.toml` |
| ファーム | PlatformIO（`uv`） | `cd firmware/esp32s3 && uv sync && uv run pio run -e prototype -t upload` |
| ベンチ | Node 20+ | `docs/BENCHMARK.md` 参照 |

`config.toml` は `config.example.toml` をコピーする。**`device.esp_ip`** は実機 IP にするか、**省略**して同一 LAN で **mDNS**（ESP が `_glowbe._udp` を広告）を使う。

---

## 9. 引き継ぎ上の注意

- `archived-glowbe` は **幾何・UV マッピングの参照のみ**。コードマージ・プロトコル/ファーム互換は非目標（§20）。
- ESP32-S3 は無印の I2S パラレルとは別アーキ。**S3 = LCD+DMA**（`docs/firmware/LED-OUTPUT.md`）。
- すべてのピクセルはランタイムが生成する**単一ライター**原則を崩さない（§設計原則 1）。
