# Glowbe シーケンス（ループ再生用オンディスク形式）v1

メディアパイプライン（正距円筒 → LED）の成果物。既定は **ディレクトリ + manifest + 生 RGB**（`.glowseq` という単一ファイルコンテナは **当面採用しない**。将来拡張で再検討する）。

## 既定ディレクトリ構成

```
assets/sequences/<id>/
├── manifest.json
└── frames.bin
```

（`manifest.json` の `format` フィールドで `"glowseq"` を宣言してもよいが、物理ファイル名に `.glowseq` 拡張子を必須としない。）

## manifest.json

```json
{
  "format": "glowbe-sequence",
  "version": 1,
  "id": "sunset-01",
  "layoutId": "prototype-icosahedron-15",
  "ledCount": 225,
  "frameCount": 300,
  "fps": 30,
  "source": {
    "kind": "equirectangular-video",
    "uploadId": "uuid",
    "width": 2048,
    "height": 1024
  },
  "createdAtUnixSec": 1781332800,
  "displayName": "Optional UI label"
}
```

- 任意 **`displayName`**（文字列・短い UI 表示名）を付けられる。未設定のときはキー自体を省略してよい。

## frames.bin

連続した生 RGB フレーム（チャンク・圧縮なし）。

```
繰り返し frameCount 回:
  ledCount × 3 バイト (R,G,B per global LED index)
```

オフセット計算:

```
frame_offset = frame_index * ledCount * 3
```

## 再生と出力 fps の対応（ランタイム）

- **既定:** **最近傍ホールド**（補間なし）。シーケンスの `fps` が 30 でランタイムが 60 のとき、各ソースフレームを 2 出力フレーム分表示するイメージ（実装は `floor(t * src_fps)` でインデックス決定）。
- **将来:** 線形補間などはオプション化してもよい。

## ループモードの I/O（非ブロッキング）

フレームループの tick 内で **ディスク read をブロックしない**。事前に次フレームを **プリフェッチ / ダブルバッファ** し、tick ではメモリ上のバッファだけを UDP 送出に回す。変換ジョブ（オフライン）とは別の、**再生専用の読み取り戦略**として設計する。

## 生成 CLI（Phase 2 最小）

```bash
cargo run --manifest-path runtime/Cargo.toml -- \
  convert-image /path/to/equirectangular.png sequence-id config.toml
```

現在の最小実装は **静止画 1 枚 → `frameCount = 1`** のシーケンスを生成する。

## ループモードでの利用（ランタイム）

ランタイムは `manifest.json` を読み、`frames.bin` をメモリに読み込み、`frame_index = floor(t * fps) % frameCount`（ホールド規則に従って出力レートへマップ）でサンプリングする。`POST /api/v1/loop/select` で生成済みシーケンスを選択する。
