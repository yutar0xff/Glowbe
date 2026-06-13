# LED レイアウト（`glowbe-layout` v1）

ランタイム・ファームウェアが参照する **配線と幾何プリセット** の定義。変更・追加があり得る。

## ファイル

| 用途 | パス | `id` |
|------|------|------|
| 製品版 | [`product.layout.json`](product.layout.json) | `product-geodesic-2v-60` |
| プロトタイプ | [`prototype.layout.json`](prototype.layout.json) | `prototype-icosahedron-15` |

スキーマ: [`protocol/glowbe-layout.schema.json`](../protocol/glowbe-layout.schema.json)

## 形式概要

```json
{
  "format": "glowbe-layout",
  "version": 1,
  "id": "product-geodesic-2v-60",
  "variant": "product",
  "geometry": { "preset": "geodesic-ico-2v", "radiusMm": 50, "disabledFaceIds": [] },
  "face": { "ledCount": 21, "pattern": "zigzag", "paddingMm": 2.1 },
  "wiring": {
    "chip": "SK6805",
    "colorOrder": "GRB",
    "dataLines": [{ "gpio": 13, "faceChain": ["face-24", "..."], "faceRotations": {}, "reversedFaces": [] }]
  }
}
```

- **面の頂点座標は含めない** — `geometry.preset` と `disabledFaceIds` から `tools/layout-compile` が展開する（archived-glowbe のプリセット定義を移植予定）。
- ランタイム用の **LED インデックス ↔ UV** テーブルはコンパイル成果物（`assets/compiled/<layout-id>.bin`）として別出力する。

## 旧形式からの移行

`glowbe-studio-layout` からの変換:

```bash
node tools/migrate-studio-layout.mjs <旧.json> <新.layout.json> product|prototype
```

## 変更手順

1. `product.layout.json` または `prototype.layout.json` を編集（`id` は変えないか、変える場合はファーム設定も更新）。
2. コンパイル:

   ```bash
   npx tsx tools/layout-compile.ts config/layouts/prototype.layout.json
   npx tsx tools/layout-compile.ts config/layouts/product.layout.json
   ```

3. `docs/ARCHITECTURE.md` のレイアウト表を必要に応じて更新。
