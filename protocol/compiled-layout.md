# コンパイル済みレイアウト（`.bin` / `.meta.json`）

`tools/layout-compile.ts` の出力。ランタイム・ファームが共有する。

## 出力先

```
assets/compiled/<layout-id>.meta.json
assets/compiled/<layout-id>.ledmap.json   # サーバ用 UV テーブル
assets/compiled/<layout-id>.bin             # ファーム用（配線メタ）
firmware/esp32s3/include/generated/<layout-id>/glowbe_layout.h    # ファーム用 C ヘッダ（自動生成）
```

## `.meta.json`

```json
{
  "layoutId": "prototype-icosahedron-15",
  "layoutHash": 2085622039,
  "ledCount": 225,
  "dataLineCount": 5,
  "gpios": [16, 17, 18, 19, 21],
  "ledsPerLine": [45, 45, 45, 45, 45],
  "lineGlobalOffset": [0, 45, 90, 135, 180]
}
```

`layoutHash` は `tools/layout-compile.ts` が算出する **FNV-1a 32bit**（配線・GPIO・chip 等）。ファームの `GLOWBE_LAYOUT_HASH` および STATUS 拡張フィールドと一致させ、ランタイムが不一致を検出する。

## `.ledmap.json`

サーバのメディアサンプリング・リップル用。各 LED:

```json
{ "i": 0, "u": 0.42, "v": 0.18, "channel": 0, "chainIndex": 0 }
```

## `.bin` v1

| オフセット | 型 | 内容 |
|-----------|-----|------|
| 0 | char[4] | `"GBLD"` |
| 4 | u8 | version = 1 |
| 5 | u16 LE | led_count |
| 7 | u8 | data_line_count |
| 8 | u8[data_line_count] | gpio per line |
| 8+N | u16 LE[data_line_count] | leds per line |

RGB 順序は **論理 RGB**（グローバル LED インデックスごとに R,G,B）。ワイヤ仕様は [`udp-wire.md`](udp-wire.md)。

## C ヘッダ

`include/generated/<layout-id>/glowbe_layout.h` にマクロ `GLOWBE_LAYOUT_ID`, `GLOWBE_LAYOUT_HASH`, `GLOWBE_LED_COUNT`, `GLOWBE_DATA_LINES`, `GLOWBE_GPIO_PINS[]`, `GLOWBE_LINE_LED_COUNTS[]` を出力。PlatformIO の `-I` でそのディレクトリを先に指定する。
