# Glowbe シーケンス形式（`.glowseq`）v1

メディアパイプライン（正距円筒 → LED）の出力。`assets/sequences/<id>/` に配置。

## ファイル構成

```
assets/sequences/<id>/
├── manifest.json
└── frames.bin
```

## manifest.json

```json
{
  "format": "glowseq",
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
  "createdAt": "2026-06-13T12:00:00Z"
}
```

## frames.bin

連続した生 RGB フレーム（チャンク・圧縮なし v1）。

```
繰り返し frameCount 回:
  ledCount × 3 バイト (R,G,B per global LED index)
```

オフセット計算:

```
frame_offset = frame_index * ledCount * 3
```

## ループモードでの利用

ランタイムは `manifest.json` を読み、`frames.bin` をメモリマップまたはストリーミング読み込みし、`frame_index = floor(t * fps) % frameCount` でサンプリングする。
