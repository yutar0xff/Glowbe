# Glowbe — 実装状況・引き継ぎ（STATUS）

> **役割:** 本書は「いま何ができていて、次に何をやるか」の**正本**。  
> 設計の「あるべき姿」は [`ARCHITECTURE.md`](ARCHITECTURE.md)、各仕様は [`../protocol/`](../protocol/)。  
> 最終更新: 2026-06-14

---

## 1. 全体サマリ

| 指標 | 現在地 |
|------|--------|
| フェーズ | **Phase 1（締め作業中）** |
| ランタイム | loop パターンを 60fps 想定で UDP 送信 + 状態 API。`cargo test` 2 件パス |
| ファーム | UDP 受信・フレーム再構成・S3(LCD+DMA)/無印(RMT) ドライバ実装済 |
| UDP E2E | 「成功扱い」。**60fps×5 分ベンチの合格記録は未取得**（[`BENCHMARK.md`](BENCHMARK.md)） |
| Web | **未着手** |
| メディアパイプライン | **未着手**（Phase 2） |

> ハードウェア前提: ESP32-S3 が本番。S3 実機が「届いたら本番」、手元の ESP32 無印で先行検証する想定（`docs/firmware/LED-OUTPUT.md`）。

---

## 2. コンポーネント別ステータス

凡例: ✅ 実装済 / 🟡 一部 / ⬜ 未着手 / 📄 設計のみ

| コンポーネント | パス | 状況 | 備考 |
|----------------|------|------|------|
| Rust ランタイム | `runtime/` | 🟡 | フレームループ / UDP 送信 / STATUS 受信 / `GET /api/v1/state` `/health`。モードは loop 固定 |
| `Mode` trait・モード合成 | `runtime/`（§9） | 📄 | trait・プラグイン機構・`POST /api/v1/mode` は未実装。`state.mode` は固定文字列 |
| メディアワーカー / 変換 | `runtime/`（§7） | ⬜ | Phase 2 |
| プレビュー（WS JPEG） | `runtime/`（§14） | ⬜ | |
| サーバマイク（cpal） | `runtime/`（§6.1） | ⬜ | Phase 4 |
| Web クライアント | `web/` | ⬜ | ディレクトリ未作成 |
| ESP ファーム（共通） | `firmware/esp32s3/` | ✅ | Wi-Fi STA / UDP / 再構成 / STATUS 送信 / idle パターン |
| LED ドライバ S3 | `src/led_driver_s3.cpp` | ✅ | LCD(I8080)+DMA 並列（FastLED `FASTLED_USES_ESP32S3_I2S`） |
| LED ドライバ 無印 | `src/led_driver_esp32.cpp` | ✅（未追跡） | RMT per line |
| レイアウト v1 + コンパイル | `config/layouts/`, `tools/layout-compile.ts` | ✅ | プロトタイプ 225 LED コンパイル済。製品 60 面は未コンパイル |
| プロトコル文書 | `protocol/` | ✅ | udp-wire / control-api / glowseq / compiled-layout |
| ベンチツール | `tools/bench-udp.mjs`, `tools/listen-status.mjs` | ✅ | 合格記録は未取得 |
| PCB / hardware | `hardware/pcb/` | ⬜ | ディレクトリ未追加 |

---

## 3. API エンドポイント別

| エンドポイント | 状況 | メモ |
|----------------|------|------|
| `GET /api/v1/state` | ✅ | `layoutId, mode, fpsOut, fpsRx, espRssi, espDrops, ledCount, loopSequenceId(常に null), uptimeSec` |
| `GET /health` | ✅ | `200 ok` |
| `POST /api/v1/mode` | ⬜ | モード機構待ち |
| `POST /api/v1/loop/select` | ⬜ | シーケンス機構待ち（Phase 2） |
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
| サーバマイク | `mic` | ⬜ Phase 4 |
| デジタル時計 | `clock_digital` | ⬜ Phase 4 |
| アナログ時計 | `clock_analog` | ⬜ Phase 4 |

---

## 5. プロトコル整合（重要メモ）

- **STATUS offset 10 のフィールド名は `drops` に統一済み**（旧 `parse_errors`）。実装・仕様・API（`espDrops`）を 2026-06-14 に揃えた。
- 現ファームの `drops` は **不正ヘッダで破棄したパケット数**を計上する。仕様（[`udp-wire.md`](../protocol/udp-wire.md)）の「破棄パケット数」と一致。
  - ⚠️ **TODO:** チャンク欠落による「未完成フレームの破棄」はまだ計上していない。真の frame-drop 検出は将来拡張（`FrameAssembler` に破棄理由の戻り値追加が必要）。
- FRAME ヘッダは 16 バイト LE。`MAX_CHUNK_PAYLOAD = 1020`。プロトタイプ 225 LED（675B）は 1 チャンクに収まる。

---

## 6. 既知の課題 / TODO

| # | 内容 | 優先 |
|---|------|------|
| 1 | **60fps×5 分ベンチの合格記録を取得し `BENCHMARK.md` に追記** | 高（Phase 1 完了条件） |
| 2 | 残 API（`mode` / `loop/select` / `layout/uv` / `ws`）の実装方針確定 | 高 |
| 3 | `Mode` trait 導入（loop 固定からプラグイン化へ） | 中 |
| 4 | frame-drop（チャンク欠落）カウントの実装 | 中 |
| 5 | LICENSE 確定（README "TBD"。完全オープン方針なら明示） | 中 |
| 6 | 製品レイアウト `product-geodesic-2v-60` のコンパイル・検証 | 中 |
| 7 | Web クライアント雛形（Phase 1 の状態表示だけでも） | 低〜中 |
| 8 | `hardware/pcb/glowbe-revA/` の追加 | 低 |

---

## 7. 次の具体タスク（Phase 1 締め）

1. **実機 or ループバックでベンチ**: `tools/bench-udp.mjs` と `tools/listen-status.mjs` で送出/受信 fps を計測 → 結果を [`BENCHMARK.md`](BENCHMARK.md) に記録。
2. **`POST /api/v1/mode` の最小実装**: まずは `idle`/`loop` の切替（`state.mode` 書き換え + フレームループの分岐）から。`Mode` trait は次段で。
3. 上記が固まったら Phase 2（正距円筒 静止画 1 枚 → LED フレーム）の設計メモを起こす。

---

## 8. 開発環境セットアップ

| 対象 | 要件 | コマンド |
|------|------|----------|
| レイアウト | Node 20+ | `npx tsx tools/layout-compile.ts config/layouts/prototype.layout.json` |
| ランタイム | Rust toolchain + C linker | `cd runtime && cargo run -- ../config.toml` |
| ファーム | PlatformIO（`uv`） | `cd firmware/esp32s3 && uv sync && uv run pio run -e prototype -t upload` |
| ベンチ | Node 20+ | `docs/BENCHMARK.md` 参照 |

`config.toml` は `config.example.toml` をコピーし `device.esp_ip` を実機 IP（シリアル diag の `ip=...`）に合わせる。

---

## 9. 引き継ぎ上の注意

- `archived-glowbe` は **幾何・UV マッピングの参照のみ**。コードマージ・プロトコル/ファーム互換は非目標（§20）。
- ESP32-S3 は無印の I2S パラレルとは別アーキ。**S3 = LCD+DMA**（`docs/firmware/LED-OUTPUT.md`）。
- すべてのピクセルはランタイムが生成する**単一ライター**原則を崩さない（§設計原則 1）。
