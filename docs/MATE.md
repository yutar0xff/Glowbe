# Glowbe — Mate モード

> **役割:** **mate モード**（球体 LED に「顔」を表示し、Web UI および WebSocket から表情を制御する）の設計と実装参照。  
> **前提:** [`ARCHITECTURE.md`](ARCHITECTURE.md) · [`STATUS.md`](STATUS.md) · [`../protocol/control-api.md`](../protocol/control-api.md)  
> **レイアウト:** `geodesic-2v-60`（1260 LED / 60panels）のみ。`icosahedron-15` では mate を提供しない。

---

## 1. ゴールと非ゴール

### ゴール

| ID | 内容 |
|----|------|
| M1 | 球体前面に「顔」を表示する出力モード `mate` を追加する |
| M2 | 目・口・頬などの**パーツ**と、涙・汗・リボン・イライラマーク等の**小物**を組み合わせた**表情プリセット**をデータ（JSON）で自由に定義できる |
| M3 | Web UI からプリセットを選んで表示を切り替えられる |
| M4 | **呼吸感**（ゆるやかな明滅・スケール揺れ）と**瞬き**を常時加える |
| M5 | 表情間を**シームレスに遷移**（モーフ）できる |
| M6 | WebSocket で**リアルタイムにパラメータを上書き**（口開閉・viseme 等） |
| M7 | 非直角・疎な LED 格子でも崩れない描画（SDF カバレッジによるアンチエイリアス）にする |

### 非ゴール（本フェーズ）

| ID | 内容 |
|----|------|
| NM1 | 15panels（225 LED）での mate 対応 |
| NM2 | AI エージェント本体・音声認識・TTS（口開閉を**受ける口**のみ。駆動元は外部） |
| NM3 | Web 上での GUI 表情エディタ（プリセットは JSON 編集で定義） |
| NM4 | ファーム変更（mate はランタイムが RGB を生成するだけ。**単一ライター原則**を崩さない） |

---

## 2. 既存アーキの要点（下位モデルが触る箇所）

mate モードは既存のモード機構（`Idle`/`Loop`/`Interactive`）と同じ流儀で **1 つの出力モードとして**足す。新しい送信経路やファーム改造は不要。

- **モード保持:** `runtime/src/state.rs` の `enum OutputMode`。`DeviceSlot.mode_code: AtomicU8`（`runtime/src/device_slot.rs`）。
- **毎フレーム合成:** `runtime/src/output.rs` の `device_output_loop`。tick ごとに `slot.output_mode()` で分岐し、`rgb: Vec<u8>`（長さ `led_count*3`、**論理 RGB**）を埋める → `apply_master_tone` → `wire::encode_frame` で UDP 送出。`mate` 用の `match` 腕を 1 つ足す。
- **時刻:** サーバ単調時計のみ（`loop_start.elapsed()` 等）。クライアント時刻は使わない。
- **LED の幾何:** コンパイル済み `assets/compiled/<layoutId>.ledmap.json` に各 LED の正距円筒 `(u,v)`。`(u,v) → 単位方向ベクトル(Y 上)` は `runtime/src/sphere.rs::unit_dir_from_equirect_uv_y_up`。
- **プレビュー:** 既に `slot.preview_frame`（最終 RGB）を WS `previewSubscribe` でブラウザへ配信済み。mate の出力もこの経路で**そのままプレビューできる**（追加実装不要）。
- **WS コマンド作法:** `runtime/src/api.rs::handle_ws_text` がテキスト JSON を `type` で分岐。`interactive` の実装が良い手本。
- **REST 作法:** `runtime/src/api.rs::router` にルート追加。`post_mode` がモード切替の手本。
- **Web 型/呼び出し:** `web/src/types.ts`（`OutputMode` 文字列ユニオン）・`web/src/api.ts`・`web/src/studio/StudioPage.tsx`（モードタブ）・`web/src/studio/InteractiveModePanel.tsx`（パネル手本）。

### LED 配置の実測（geodesic-2v-60）

`assets/compiled/geodesic-2v-60.ledmap.json` を解析した結果（設計の根拠）:

| 指標 | 値 |
|------|----|
| LED 総数 | 1260 |
| `v` 範囲 | 0.024 〜 0.662（`v=0` 北極＝上、`v=0.5` 赤道、`v=0.662` 赤道の約 29° 下） |
| `u` 範囲 | 0 〜 0.992（全周） |
| 最近傍 LED の角間隔（平均） | **≈ 0.084 rad ≈ 4.8°**（半径 50mm 上で弦長 ≈ 4.2mm） |
| LED 重心方向 | ほぼ真上（垂直軸対称） |

**意味:** 点灯可能領域は「北極キャップ〜赤道の少し下」までの上 2/3。顔はこの前面に置く。**有効解像度は前面で 1 辺あたりおおむね 25〜30 LED 相当**。細い線・小さな小物は潰れるので、後述の SDF + 最小サイズ予算に従う。

---

## 3. 幾何モデル — Face Frame と LED → 顔平面の射影

### 3.1 方針

パーツは**正規化された 2D「顔平面」** `(fx, fy) ∈ [-1,1]²`（中心が顔の中心、+fy が上、+fx が顔から見て右）で定義する。これにより**パーツ定義を球の向き・配線から完全に分離**できる。各 LED を顔平面に射影し、SDF でカバレッジを求めて色を載せる。

### 3.2 Face Frame（顔の向き）

レイアウト座標（Y 上）における **正規直交基底** で顔の向きを表す:

- `forward` … 顔が向く方向（視線・鼻先）。
- `up` … 顔の上方向。
- `right = normalize(cross(up, forward))`、`up' = cross(forward, right)` で直交化。

LED は上 2/3（北極寄り）に偏るため、`forward` は水平から**上向きに傾ける**と顔がカバレッジ中央に来る。

**パラメータ（キャリブレーション対象。既定値）:**

| パラメータ | 既定 | 意味 |
|------------|------|------|
| `frontLongitudeU` | 0.5 | 顔正面の経度。`u` 値で指定（`lam = 2π·u − π`）。実機の配線/設置向きに合わせて校正 |
| `forwardTiltDeg` | 28 | `forward` を赤道面から上へ傾ける角度（度）。LED 被覆中央（赤道の約 +30° 上）に合わせる |
| `faceAngularRadiusDeg` | 70 | 顔平面の半径 1 に対応する `forward` からの開き角（度）。大きいほど顔が小さく収まる |
| `silhouetteFadeDeg` | 12 | 可視縁（`faceAngularRadiusDeg`）付近のフェード幅（度）。シルエットを滑らかに消す |

`forward` の構成（既定値の場合、Y 上座標）:

```
lam0 = 2π·frontLongitudeU − π          # = 0 （u=0.5）
tilt = forwardTiltDeg in rad           # = 0.489
forward = ( cos(tilt)·cos(lam0),  sin(tilt),  cos(tilt)·sin(lam0) )
up      = (0, 1, 0) を forward で直交化（up' = normalize(up − (up·forward)·forward)）
right   = normalize(cross(up', forward))
```

> これらは **mate-frame として永続化**する（§7.3）。最初は既定値でよいが、実機の前面方向 `frontLongitudeU` は校正が要る。校正用に**デバッグ表情**（§6.4）を用意する。

### 3.3 LED → 顔平面の射影（正射影）

写真の見た目（球を正面から見た像）に最も一致する**正射影**を使う。各 LED の単位方向 `d` に対し:

```
fwd = d · forward
if fwd <= 0:  この LED は裏面 → weight = 0（描かない）
ang = acos(clamp(fwd, -1, 1))                       # forward からの開き角
R   = faceAngularRadiusDeg in rad
x   = (d · right) / sin(R)                            # 顔平面座標（正規化）
y   = (d · up')   / sin(R)
# 可視重み（シルエットのソフトな縁）
weight = smoothstep(cos(R + fade), cos(R), fwd)       # fade = silhouetteFadeDeg
```

- `weight` は最終色に乗算する（縁で自然に減衰）。
- **前計算:** Face Frame と `faceAngularRadiusDeg` が決まれば LED ごとの `(x, y, weight)` は不変。レイアウト切替・パラメータ変更時に 1 回だけ構築し `Vec<FaceSample>` にキャッシュする（毎 tick で `acos`/`sin` を回さない）。

### 3.4 解像度予算（パーツ設計の制約）

LED 角間隔 4.8° と `faceAngularRadiusDeg=70°` から、**顔平面 [-1,1]（幅 2.0）に概ね 25〜30 LED**。よって:

| 項目 | 目安（顔平面の正規化単位） |
|------|----------------------------|
| LED ピッチ | ≈ 0.07〜0.08 |
| 線/ストロークの**最小太さ** | **≥ 0.06**（これ未満は途切れる） |
| 認識できる小物の**最小サイズ** | **≥ 0.18** |
| SDF の縁ソフトネス `edgeSoftness` 既定 | 0.05〜0.08（LED ピッチ相当） |
| 目の標準サイズ | 半径 0.18〜0.26 |
| 口（笑顔）の幅 | 0.5〜0.7、太さ 0.07〜0.10 |

> **重要:** 非直角・疎な格子なので「正確なドット絵」は不可能。すべて **SDF（符号付き距離）→ カバレッジ → アンチエイリアス**で描く。`coverage = smoothstep(edgeSoftness, -edgeSoftness, sdf)` のように LED ごとの被覆率（0..1）を出し、色 × 被覆率 × `weight` を加算合成する。

---

## 4. パーツモデル

### 4.1 パーツ種別（`kind`）

すべて顔平面 `(fx,fy)` 上の SDF として評価する。

| `kind` | 用途 | 主パラメータ |
|--------|------|--------------|
| `ellipse` | 目・瞳・頬・塗り○口・丸目 | `pos[2]`, `size[2]`(rx,ry), `rotationDeg` |
| `ring` | 開いた口(O)・驚き・眠り目(下弧)・輪郭 | `pos`, `radius`, `thickness`, `arcStartDeg`, `arcEndDeg`（弧指定可） |
| `polyline` | 口（笑い/への字）・眉・閉じ目(^ ^)・波線 | `points[][2]`, `thickness`, `closed`(bool), `cornerRound` |
| `triangle` | パーティ帽・牙・三角の小物 | `points[3][2]`, `cornerRound` |
| `teardrop` | 涙・汗 | `pos`, `size`, `rotationDeg` |
| `stamp` | 任意アイコン（ハート/星/音符/リボン/花/怒りマーク/zzz） | `asset`(名), `pos`, `size[2]`(hx,hy), `rotationDeg`, `palette[][3]`(再配色・任意) |

- `polyline` は制御点列を**丸い線分（カプセル）チェーン**として太さ `thickness` で描く。`closed=true` で多角形塗り。これで「笑い口」「眉」「半目」「波形の口」を 1 種でまかなえる。
- `stamp` は**正方形ピクセルアート PNG**を 1:1 でインポートし、色分け（パレット）を保持したまま顔平面にスタンプする（§4.4）。`size[2]` は顔平面での半幅・半高。描画時は**短辺に合わせた等方スケール**で歪めない。表示色は**ランタイム側で再配色**し、`palette`（任意）でスロットごとに色を上書きできる。未指定なら単色 stamp は `color`、多色 stamp は元 PNG の色を使う。

### 4.2 共通プロパティ

```jsonc
{
  "slot": "eye.l",          // 遷移でモーフするための安定 ID（§5）。同名スロットが補間対象
  "layer": "eyes",          // 描画順グループ（後述の固定順で重ね）
  "kind": "ellipse",
  "color": [40, 120, 255],  // 論理 RGB 0..255
  "intensity": 1.0,         // 0..1（明るさ係数）
  "edgeSoftness": 0.06,     // SDF 縁のソフトネス（顔平面単位）
  "blink": false,           // true の目だけ瞬きで上下スカッシュ（§5.2）
  "breathe": true,          // 呼吸の明滅対象に含めるか（既定 true）
  // 以下 kind 依存パラメータ
  "pos": [-0.45, 0.28],
  "size": [0.20, 0.24],
  "rotationDeg": 0
}
```

**レイヤ描画順（背→前、固定）:** `background` → `cheeks` → `mouth` → `eyes` → `brows` → `accessories`。
同レイヤ内は配列順。合成は**線形加算 + ソフトクリップ**（`output.rs::blend_interactive_accum` と同方式）。

### 4.3 表情プリセット形式（`*.face.json`）

```jsonc
{
  "format": "glowbe-mate-face",
  "version": 1,
  "id": "happy",
  "displayName": "Happy",
  "background": [0, 0, 0],
  "parts": [
    { "slot": "eye.l", "layer": "eyes", "kind": "ellipse",
      "pos": [-0.42, 0.26], "size": [0.19, 0.23], "color": [40,120,255], "blink": true },
    { "slot": "eye.r", "layer": "eyes", "kind": "ellipse",
      "pos": [ 0.42, 0.26], "size": [0.19, 0.23], "color": [40,120,255], "blink": true },
    { "slot": "cheek.l", "layer": "cheeks", "kind": "ellipse",
      "pos": [-0.62, -0.05], "size": [0.14, 0.10], "color": [255,80,140], "intensity": 0.8 },
    { "slot": "cheek.r", "layer": "cheeks", "kind": "ellipse",
      "pos": [ 0.62, -0.05], "size": [0.14, 0.10], "color": [255,80,140], "intensity": 0.8 },
    { "slot": "mouth", "layer": "mouth", "kind": "polyline",
      "points": [[-0.30,-0.34],[0,-0.50],[0.30,-0.34]], "thickness": 0.085, "color": [40,120,255] }
  ]
}
```

- **ビルトイン + ユーザー定義:** 起動時に (1) バイナリ同梱のビルトイン数種、(2) `assets/mate/*.face.json` を読み込み、`id` で索く。重複 `id` はユーザー定義を優先。
- **バリデーション:** `format/version` 一致・`id` パス安全（`/ \` 不可）・座標/サイズの範囲・`stamp.asset` 存在を起動時/読込時に検証し、失敗したプリセットはスキップしてログ。

### 4.4 stamp 資産（ピクセルアート PNG → `.stamp.json`）

**方針:** stamp の正本は**正方形ピクセルアート PNG**。インポートは**リサイズ・補間なし**で、PNG の各ピクセルを 1 セルとして `.stamp.json` に保存する（`size` = PNG の辺のピクセル数）。**色分け（カラー領域）は保持**し、実際の表示色は**ランタイム側で再配色**する。ランタイムは読込時にそのグリッドへ EDT で SDF を構築し、顔平面上の `size:[hx,hy]` でスケールして描く。前面 LED の有効解像度（§3.4）から **16×16 前後が実用的**だが、上限は設けず**元画像のピクセル数を保持**する。

**ソース PNG:**
- 置き場所: `assets/mate/stamps/src/<name>.png`（アップロード元・作業用）
- 形式: **正方形**。**透明（α<0.5）= 図形の外側**、不透明ピクセル = 図形の内側。
- **色ごとに領域を分ける**: 不透明な各色がパレットの 1 スロットになる（出現順）。アンチエイリアスのない**くっきりしたピクセルアート**にする（不透明色は最大 16 種）。
- **1 ピクセル = 1 セル**（ダウンスケール・アップスケール・グリッド再標本化なし）。

**インポート工程:**
- コマンド: `glowbe-runtime mate-import-stamp <src.png> <name> [--out path]`
  - PNG をデコード → 正方形チェック → ピクセルごとにパレット索引を抽出（行優先・上から、α<0.5 は 0=外側）
  - 出力: `assets/mate/stamps/<name>.stamp.json`
- ビルトインも同工程。`runtime/src/mate/stamps/<name>.stamp.json` を `include_str!` で同梱。

**stamp 形式（`<name>.stamp.json`）:**
```jsonc
{
  "format": "glowbe-mate-stamp",
  "version": 2,
  "id": "heart",
  "size": 16,                       // PNG の辺のピクセル数（= pixels の一辺）
  "palette": [[255,255,255]],       // 元 PNG の不透明色（出現順）
  "pixels": [0,0,1,1,...]           // size×size、行優先・上から。0=外側、n=palette[n-1]
}
```

**ランタイム再配色:**
- stamp のパレットは**設計上の色分け**であり、出力色はプリセットの stamp パートで決める。
- 解決優先順位（パートごと）:
  1. プリセット側に `palette: [[r,g,b],...]` があれば索引対応で割り当て（未指定スロットは元の色を維持）。
  2. パレットが 1 色なら `color` に再配色（単色 stamp の既定）。
  3. それ以外は元 PNG の色をそのまま使う。

**ランタイム解決・描画:**
- 起動時に (1) 同梱ビルトイン、(2) `assets/mate/stamps/*.stamp.json` を読み、`id` で索く。
- 読込時に `pixels`（`size`×`size`、0 以外=内側）から EDT で SDF を構築。
- 描画: 各 LED 方向 `d` を **stamp 中心 `d0` での測地線正規座標（指数写像の逆＝log map）** に変換し、そのセルのパレット索引を最近傍で求めて**再配色後の色**を出力する（モーフ遷移中のみ SDF 補間と `color` を使う）。`d0` に局所正規直交接フレーム（顔の right/up を `d0` 接平面へ投影）を作り、各軸方向の**測地線弧長（rad）**を使うため、球面上で等方になる（正方形 PNG が歪まない）。`min(hx,hy)` は log map 上の半角（rad 相当）。

---

## 5. アニメーション

すべてサーバ単調時計で駆動。1 tick の最終 RGB を生成するパイプライン:

```
t = loop_start.elapsed()
1. 現在の「合成表情」を求める（遷移中なら 2 表情をスロット単位で補間 → §5.3）
2. 呼吸モジュレーション（§5.1）を全体に適用
3. 瞬きモジュレーション（§5.2）を blink パーツに適用
4. ライブ上書き（§6）を適用（口の viseme 等）
5. 各パーツを SamplePoint ごとに SDF 評価 → 加算合成 → ソフトクリップ → rgb
```

### 5.1 呼吸（breathing）

- ゆるやかな正弦で**全体の明るさ**と**わずかな縦スケール**を揺らす。
- 既定: `periodMs = 4200`, `brightnessAmp = 0.10`（±10%）, `scaleAmp = 0.02`。
- `breathe:false` のパーツは明滅対象外（例: 常時はっきり見せたい小物）。

### 5.2 瞬き（blink）

- `blink:true` のパーツ（通常は目）に対し、`openness ∈ [0,1]` を掛けて**縦方向にスカッシュ**（`size.y *= openness`、`openness→0` で 1 本線に潰れる）。
- 駆動: ランダム間隔（既定 `2.5〜6.0s`）で 1 回 `120ms` 程度の閉→開（イージング）。二度瞬きを稀に混ぜると自然。
- ライブから単発トリガ（§6）も可能。
- `ring`/`stamp` の目（ぐるぐる目・ハート目）は瞬き対象外にできるよう `blink` 既定 false。

### 5.3 遷移（シームレスなモーフ）

- 表情はスロット ID で対応付ける。遷移は **`from` と `to` の同名スロットをパラメータ補間**（`pos`, `size`, `color`, `intensity`, `rotation`, `polyline.points` など数値を線形 or イージング補間）。
- スロットの**出現/消失**は `intensity` を 0↔1 でクロスフェード（`from` のみ→フェードアウト、`to` のみ→フェードイン）。
- `polyline.points` は**点数が一致する場合のみ**点ごとに補間。点数が違う/`kind` が違うスロットは「クロスフェード（両方を被覆率で混ぜる）」にフォールバック。
- 既定 `transitionMs = 320`、イージング `easeInOutCubic`。遷移完了で `from` を破棄。
- 遷移中に別の `to'` が来たら、**現在の合成結果を新しい `from` とみなして**再遷移（途切れさせない）。
- 回転演出（任意・オン/オフ切替可）: 有効時は遷移進捗に合わせて顔全体を球の縦軸まわりに `0→360°`（`easeInOutBack`）で 1 回転させる。序盤で少し巻き戻し、終盤は 360° を少し越えてから戻る動き。360°≡0° で終わるため元の正面へ継ぎ目なく収まる。モーフと同時進行。`POST /api/v1/mate/transition { "rotate": bool }` で切替。

### 5.4 リップシンク（口の駆動）

- 口スロット（規約: `slot == "mouth"`）は**ライブ・パラメータ** `openness ∈ [0,1]`（縦開き）と `width ∈ [0,1]`（横幅係数）で毎フレーム上書きできる。
- `polyline` 口なら中央制御点を下げて `openness` で口内（`ring`/塗り）を出す、または口スロットを `ring`(arc) と解釈して開口度に反映。実装簡素化のため**口スロットは `mouth.openness` を受け取れる専用ロジック**を持たせる（他スロットは純粋プリセット）。
- 駆動元（AI/音声）は §6 の WS でフレーム列を流す。ランタイムは最後の値を保持し、無入力時は `openness→0` へ緩やかに戻す。

---

## 6. 制御 API / WS

### 6.1 モード切替（既存機構に追加）

- `OutputMode::Mate` を追加（`state.rs`）。`POST /api/v1/mode { "mode": "mate" }` で切替（`post_mode` は `OutputMode::parse` 経由なので**自動対応**。`code() = 3`）。
- `idle` への切替時に sequence をクリアするのと同様、`mate` への切替時は **直近 or 既定プリセット**を選ぶ（未選択なら `neutral`）。

### 6.2 REST

| メソッド | パス | 用途 |
|----------|------|------|
| GET | `/api/v1/mate/presets` | プリセット一覧（`id`, `displayName`, パーツ数, 由来 builtin/user） |
| POST | `/api/v1/mate/expression` | `{ "preset": "happy", "transitionMs": 320 }` で表情を遷移指定 |
| POST | `/api/v1/mate/breathing` | `{ "enabled": true, "periodMs": 4200, "amplitude": 0.10 }` |
| POST | `/api/v1/mate/transition` | `{ "rotate": true }` で遷移中に顔全体を球面上で 1 回転させる演出を切替 |
| GET | `/api/v1/mate/frame` | 現在の Face Frame パラメータ取得（校正 UI 用） |
| POST | `/api/v1/mate/frame` | Face Frame パラメータ更新（校正） |

### 6.3 WebSocket（`type: "mate"`、`handle_ws_text` に分岐追加）

`mate` 出力モード時のみ受理（`interactive` と同様、モード不一致は `event_status` error）。

```jsonc
// 表情を遷移
{ "type": "mate", "action": "setExpression", "preset": "angry", "transitionMs": 250 }
// 単発の瞬き
{ "type": "mate", "action": "blink" }
// 呼吸パラメータ
{ "type": "mate", "action": "setBreathing", "enabled": true, "periodMs": 4000, "amplitude": 0.12 }
// 遷移時の回転演出の切替
{ "type": "mate", "action": "setTransitionRotate", "rotate": true }
// リップシンク（毎フレーム/間引きで連続送出）
{ "type": "mate", "action": "viseme", "openness": 0.6, "width": 0.8 }
// 低レベル・ライブ上書き（AI 表情の微調整）: 指定スロットのパラメータを一時上書き
{ "type": "mate", "action": "setSlot", "slot": "eye.l", "size": [0.10,0.30] }
```

- 応答は既存規約に合わせ `{"type":"event_status","event":"mate","status":"ok"|"error",...}`。
- ライブ上書き（`viseme`/`setSlot`）は**保持式**。新しい `setExpression` で基底プリセットが変わっても、明示クリアまで上書きを重ねる（リップシンクは表情が変わっても継続したい）。クリア用 `{"action":"clearLive"}` を用意。

---

## 7. ランタイム実装設計

### 7.1 新規モジュール `runtime/src/mate.rs`

責務（純関数中心・テスト容易に）:

- `FaceFrame { forward, up, right, ang_radius_rad, fade_rad, front_longitude_u, tilt_deg }` と `from_params(...)`。
- `FaceSample { x: f32, y: f32, weight: f32 }`。`build_face_samples(ledmap_uv: &[(f32,f32)], frame: &FaceFrame) -> Vec<FaceSample>`。
- パーツ SDF: `sdf_ellipse`, `sdf_ring(arc)`, `sdf_polyline`, `sdf_triangle`, `sdf_teardrop`, `sample_stamp`。各 `(fx,fy)` で距離 or 被覆率を返す。
- `Part`（解決済みの数値パーツ）と `Expression { background, parts: Vec<Part> }`。
- `FacePreset`（JSON デシリアライズ）と `resolve_preset(&FacePreset) -> Expression`。
- `lerp_expression(from, to, t) -> Expression`（スロット対応のモーフ。§5.3）。
- `render(samples: &[FaceSample], expr: &Expression, mods: &Modulation, out_rgb: &mut [u8])`。
  - `Modulation { breathe_scale, breathe_brightness, blink_openness, mouth_openness, mouth_width, live_slot_overrides }`。
  - 各サンプル: レイヤ順に全パーツの被覆率を評価 → 線形加算 acc → ソフトクリップ → sRGB（`output.rs` の `srgb_byte_to_linear`/`linear_to_srgb_u8` を再利用、または `pub(crate)` 化）。

### 7.2 `DeviceSlot`（`device_slot.rs`）への追加状態

`interactive_*` フィールド群と同じ作法（`StdRwLock` / `Atomic`）で追加:

```rust
mate_samples: StdRwLock<Option<(String /*layoutId*/, Vec<mate::FaceSample>)>>, // frame×layout でキャッシュ
mate_frame: StdRwLock<mate::FaceFrame>,                 // 校正値
mate_presets: Arc<StdRwLock<HashMap<String, mate::Expression>>>, // 解決済み（共有可）
mate_transition: StdRwLock<MateTransition>,             // from/to Expression + 開始時刻 + duration
mate_breathing: StdRwLock<BreathingParams>,
mate_blink: StdRwLock<BlinkState>,                      // 次回瞬き時刻・進行
mate_live: StdRwLock<MateLive>,                         // viseme(openness,width) + slot overrides + 更新時刻
```

メソッド: `set_mate_expression(id, transition_ms)`, `trigger_blink()`, `set_breathing(..)`, `apply_mate_viseme(..)`, `set_mate_slot_override(..)`, `clear_mate_live()`, `ensure_mate_samples(compiled_dir, layout_id)`, `set_mate_frame(..)`（変更時に `mate_samples` を無効化）。

> プリセット集合は**全デバイス共通**でよい（`SharedApp` に置いて `Arc` 共有も可）。Face Frame と遷移/ライブ状態は**デバイス毎**。

### 7.3 永続化

- Face Frame: `assets/mate/frame.<layoutId>.json`（無ければ既定値）。`POST /api/v1/mate/frame` で更新・保存。
- プリセット: `assets/mate/*.face.json`（ユーザー）＋ ビルトイン（`include_str!` 同梱、最低 `neutral`, `happy`, `sad`, `angry`, `surprised`, `sleepy`）。

### 7.4 `output.rs` の合成腕

`match output_mode { ... }` に追加:

```rust
OutputMode::Mate => {
    slot.metrics.set_loop_source_frame(None);
    slot.ensure_mate_samples(&app.compiled_dir, &layout_id).ok();
    slot.render_mate(t, &mut rgb); // 内部で遷移/呼吸/瞬き/ライブを合成
}
```

`render_mate` は `mate.rs::render` を呼ぶ薄いラッパ。`apply_master_tone` は既存の最終段がそのまま効く。プレビュー配信も既存経路で動く。

### 7.5 パフォーマンス

- 1 tick: `1260 サンプル × パーツ数(~6〜15) × SDF`。SDF は加減算と数回の `sqrt` 程度。60fps で約 1.1M〜2.4M SDF 評価/秒 → 余裕（interactive の球面ガウスと同等オーダ）。
- `acos`/`sin` を含む射影は**前計算済み `FaceSample`** に閉じ込め、毎 tick では使わない。
- `mate_samples` は `(layoutId, frame)` が不変な限り再利用。`set_mate_frame` でのみ再構築。

---

## 8. Web UI 設計

最小限（プリセット選択 + 既存プレビュー）から始め、校正・ライブ操作を足す。

### 8.1 型・API（`web/src/types.ts`, `web/src/api.ts`）

- `OutputMode` に `'mate'` を追加。
- `fetchMatePresets()`, `setMateExpression(deviceId, presetId, transitionMs)`, `setMateBreathing(...)`, `get/setMateFrame(...)` を追加。
- WS は既存 `LiveControls`/WS フックに `mate` メッセージ送信を足す。

### 8.2 `StudioPage.tsx`

- `MODES` に `'mate'` を追加、`modeMeta.mate`（ラベル/説明/アイコン）を追加。
- `TabsContent value="mate"` に `MateModePanel` を表示。

### 8.3 `MateModePanel`（新規 `web/src/studio/MateModePanel.tsx`）

- プリセット一覧（グリッド or セレクト）→ クリックで `POST /api/v1/mate/expression`（遷移 ms スライダ）。
- 呼吸 ON/OFF・周期・振幅スライダ。
- **ライブプレビュー**: 既存の球面プレビュー（`LayoutUvSphereCanvas` + `previewSubscribe`）を流用。
- Face Frame 校正: `frontLongitudeU` / `forwardTiltDeg` / `faceAngularRadiusDeg` スライダ → `POST /api/v1/mate/frame`。

---

## 9. テスト戦略

- **Rust 単体（`cargo test`）:** 射影（前面/裏面/対称性）、各 SDF の符号と被覆率の単調性、`lerp_expression` の端点・中間、プリセット JSON バリデーション、口 viseme ロジック。
- **決定的レンダリング:** 小さな合成 `FaceSample` 集合に対する `render` 出力をスナップショット的に検証（特定 LED が点灯/消灯）。
- **Web:** `npm run lint && npm run build`。プレビュー描画は既存経路の流用なので回帰は小さい。
- **手動/実機:** プレビュー（ハード不要）→ ESP 実機で legibility を確認。

---

## 10. リスク・注意点

- **校正依存:** 顔が「正面」に出るかは `frontLongitudeU`（配線/設置向き）に依存。`POST /api/v1/mate/frame` と Web スライダで調整する。
- **解像度:** §3.4 の最小サイズを破ると小物・細線が消える。プリセット作者（人間/AI）はこの予算を守る。
- **単一ライター原則:** mate もランタイムのみが RGB を生成。ファーム・ワイヤは不変。
- **既存モードへの非干渉:** `mate` 状態は専用フィールドに隔離。`interactive`/`loop` の挙動を変えない。
- **ロック粒度:** ライブ上書き（高頻度 WS）は短いクリティカルセクションに。`render_mate` 中に長い書込みロックを取らない（スナップショットを取ってから描画）。
- **遷移の安定性（バウンス回避）:** 形のモーフは**カバレッジのクロスフェードではなく SDF 補間**で行う。stamp は読込時 EDT の SDF を等方スケールで評価する。呼吸・瞬きは遷移中もゲートせず連続適用する。

---

## 11. 触るファイル一覧（要約）

| 区分 | ファイル | 変更 |
|------|----------|------|
| ランタイム | `runtime/src/mate.rs` | 新規（幾何・SDF・表情・レンダ） |
| ランタイム | `runtime/src/state.rs` | `OutputMode::Mate` |
| ランタイム | `runtime/src/device_slot.rs` | mate 状態・メソッド |
| ランタイム | `runtime/src/output.rs` | `Mate` 合成腕、sRGB ヘルパ共有 |
| ランタイム | `runtime/src/api.rs` | REST `/mate/*`・WS `type:"mate"` |
| ランタイム | `runtime/src/main.rs` | mate モジュール宣言・起動時プリセット読込・`mate-import-stamp` サブコマンド |
| ランタイム | `runtime/src/mate/stamps.rs` | `.stamp.json` ローダ・読込時 EDT・サンプリング |
| ランタイム | `runtime/src/mate/stamp_import.rs` | PNG → `.stamp.json` インポート |
| ランタイム | `runtime/src/mate/stamp_edt.rs` | 小グリッド EDT（読込時 SDF 構築） |
| 資産 | `assets/mate/*.face.json`, `assets/mate/stamps/src/*.png`（ソース）, `assets/mate/stamps/*.stamp.json`（ユーザー上書き）, `runtime/src/mate/stamps/*.stamp.json`（同梱）, `assets/mate/frame.<layoutId>.json` | 新規 |
| Web | `web/src/types.ts`, `web/src/api.ts` | `mate` 型・API |
| Web | `web/src/studio/StudioPage.tsx` | mate タブ |
| Web | `web/src/studio/MateModePanel.tsx` | 新規パネル |
| ドキュメント | `docs/STATUS.md`, `protocol/control-api.md` | mate の状況・API 追記 |

---

## 13. 用語

| 用語 | 意味 |
|------|------|
| Face Frame | 顔の向きを表す正規直交基底（`forward/up/right`）＋画角。LED→顔平面射影の基準 |
| 顔平面 (face plane) | パーツを定義する正規化 2D 座標 `(fx,fy)∈[-1,1]²`。中心=顔中心、+fy 上、+fx 右 |
| FaceSample | LED ごとに前計算した `(fx, fy, weight)` |
| スロット (slot) | 遷移で対応付ける安定パーツ ID（例 `eye.l`, `mouth`）。同名同士を補間 |
| SDF カバレッジ | 符号付き距離から求めた LED 被覆率 0..1。疎・非直角格子のアンチエイリアス手段 |
| viseme | リップシンク用の口形状パラメータ（`openness`, `width`） |

*以上*
