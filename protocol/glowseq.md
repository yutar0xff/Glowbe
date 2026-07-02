# Glowbe クリップ（ループ再生用オンディスク形式）v1

メディアパイプライン（正距円筒 → 低解像度 equirect）の成果物。**レイアウト非依存**。再生時に現レイアウトの ledmap UV でサンプリングする。

## 既定ディレクトリ構成

```
assets/clips/<id>/
├── manifest.json
├── equirect.bin
└── source-import.*   # 元メディア（プレビュー / 再デコード用）
```

ビルトインデモ（`demo/expanding-rings` など）はディスク不要。ランタイム内の手続き関数として提供する。

## manifest.json

```json
{
  "format": "glowbe-clip",
  "version": 1,
  "id": "sunset-01",
  "kind": "equirect-video",
  "fps": 30,
  "frameCount": 300,
  "width": 256,
  "height": 128,
  "source": {
    "kind": "equirectangular-video",
    "path": "source-import.mp4",
    "origWidth": 2048,
    "origHeight": 1024
  },
  "createdAtUnixSec": 1781332800,
  "displayName": "Optional UI label"
}
```

- **`layoutId` / `ledCount` は持たない**（任意レイアウトで再生可能）。
- 任意 **`displayName`**（文字列・短い UI 表示名）を付けられる。未設定のときはキー自体を省略してよい。
- `kind`: `equirect-image` | `equirect-image-sequence` | `equirect-video` | （API 一覧では `demo` はビルトイン）

## equirect.bin

連続した生 RGB フレーム（チャンク・圧縮なし）。各フレームは **width × height × 3** バイト。

```
繰り返し frameCount 回:
  width * height * 3 バイト (R,G,B per equirect pixel)
```

オフセット計算:

```
frame_offset = frame_index * width * height * 3
```

既定解像度は **256×128**。変換 API で任意 `resolution` を指定可能。

## 再生（ランタイム）

- `equirect.bin` は **mmap** でマップし、全フレームを常駐 RAM に載せない。
- 各 tick で `frame_index = floor(t * fps) % frameCount` を選び、現レイアウトの UV テーブル `(u,v)` ごとに equirect フレームを **バイリニアサンプル**（`u` は wrap、`v` は clamp）。
- デモクリップは UV に対する手続き関数を毎 tick 評価する。

## ループモードの I/O（非ブロッキング）

フレームループの tick 内で **ディスク read をブロックしない**（mmap 済みまたは手続き）。tick ではサンプリング結果だけを UDP 送出に回す。

## 生成 CLI

```bash
cargo run --manifest-path runtime/Cargo.toml -- \
  convert-image /path/to/equirectangular.png clip-id config.toml
```

静止画 1 枚 → `frameCount = 1` のクリップを `assets/clips/` に生成する（layout 非依存）。

## ループモードでの利用（ランタイム）

`POST /api/v1/loop/select` でクリップ id（メディア uuid または `demo/...`）を選択する。レイアウト切替後も **再変換不要**。
