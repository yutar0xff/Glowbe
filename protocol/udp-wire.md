# Glowbe Wire Protocol v1（UDP）

ランタイム → ESP32-S3 のピクセル転送。ポート既定 **49152/udp**（`config.toml` の `output.udp_port` で変更可）。

## 共通

- バイト順: **リトルエンディアン**
- IPv4 UDP（v1 はマルチキャスト非対応）
- 1 フレーム = `led_count × 3` バイトの RGB（グローバル LED インデックス順、8bit/チャンネル）

## メッセージ: FRAME（ランタイム → ESP）

複数 UDP ダタグラムに分割する。ESP は `chunk_index == chunk_count - 1` まで揃った時点で LED 出力を更新する（S3: LCD+DMA 並列、無印プロト: RMT per line。詳細は [`docs/firmware/LED-OUTPUT.md`](../docs/firmware/LED-OUTPUT.md)）。

### ヘッダ（16 バイト）

| オフセット | 型 | 名前 | 値 |
|-----------|-----|------|-----|
| 0 | u8[2] | magic | `0x47 0x42` (`"GB"`) |
| 2 | u8 | version | `1` |
| 3 | u8 | msg_type | `1` = FRAME |
| 4 | u32 | frame_id | 単調増加（ラップ可） |
| 8 | u16 | led_count | レイアウトの総 LED 数 |
| 10 | u16 | chunk_index | `0 .. chunk_count-1` |
| 12 | u16 | chunk_count | 総チャンク数 ≥ 1 |
| 14 | u16 | payload_len | 本パケットの RGB バイト数 |

### ペイロード

`payload_len` バイトの RGB 断片。全チャンクの `payload_len` 合計は `led_count * 3` と一致すること。

チャンク `i` の先頭 LED インデックス（論理）:

```
offset_bytes = sum(payload_len of chunks 0..i-1)
led_index_start = offset_bytes / 3
```

### 推奨パラメータ（プロトタイプ・2.4 GHz）

| 項目 | 推奨値 |
|------|--------|
| `payload_len` 上限 | **1020**（IP MTU 1500 余裕） |
| 送信レート | ターゲット fps に合わせフレーム境界でバースト |
| `frame_id` 変化時 | 未完了の部分フレームは破棄 |

## メッセージ: STATUS（ESP → ランタイム、任意）

既定 **49153/udp** へ送信（実装時に固定または設定化）。

### ヘッダ（16 バイト）

| オフセット | 型 | 名前 | 値 |
|-----------|-----|------|-----|
| 0 | u8[2] | magic | `0x47 0x42` |
| 2 | u8 | version | `1` |
| 3 | u8 | msg_type | `3` = STATUS |
| 4 | u32 | frames_complete | 完了フレーム数 |
| 8 | u16 | fps_rx | 受信 fps × 10（例: 602 = 60.2） |
| 10 | u16 | drops | 破棄パケット数（不正ヘッダ等。累計下位 16bit） |
| 12 | i8 | rssi | Wi-Fi RSSI |
| 13 | u8[3] | reserved | `0` |

> 実装ノート: 現ファームの `drops` は **ヘッダ解析失敗で破棄したパケット数**を計上する。チャンク欠落による「未完成フレームの破棄」カウントは将来拡張（`docs/STATUS.md` 既知の TODO）。

ペイロードなし（v1）。

## 実装ノート

- ESP は `led_count` がコンパイル時定数と一致しないパケットを無視する。
- ランタイムは送信間隔を **壁時計**で制御（ブラウザ非依存）。
- ベンチ合格基準は [`docs/BENCHMARK.md`](../docs/BENCHMARK.md)。
