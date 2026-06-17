# Glowbe — 相棒（mate）モード設計

> **ステータス:** 設計ドラフト（2026-06-15）。本書は「あるべき姿」を記述する。
> **範囲:** 球面ネイティブな「液体的に動く顔」を持つエージェントモードの初期版（外部統合なし）。顔パーツ・表現プリセット・呼吸・徘徊などをサーバ側で生成し、Web のボタン／スライダーで制御する。
> **実装状況の正本:** [`STATUS.md`](STATUS.md)
> **上位設計:** [`ARCHITECTURE.md`](ARCHITECTURE.md)（§9 サーバーモード）

---

## 目次

1. [目的と方針](#1-目的と方針)
2. [調査: StackChan と、なぜそのまま使わないか](#2-調査-stackchan-と-なぜそのまま使わないか)
3. [設計の核心: 球面ネイティブで液体的な顔](#3-設計の核心-球面ネイティブで液体的な顔)
4. [表現チャンネル（創造的レパートリー）](#4-表現チャンネル創造的レパートリー)
5. [表情プリセット（多チャンネルベクトル）](#5-表情プリセット多チャンネルベクトル)
6. [ムードと待機コレオグラフィ](#6-ムードと待機コレオグラフィ)
7. [微動作（呼吸・まばたき・サッケード・トレモロ）](#7-微動作呼吸まばたきサッケードトレモロ)
8. [合成パイプラインと管理方法](#8-合成パイプラインと管理方法)
9. [球面上の顔レンダリング](#9-球面上の顔レンダリング)
10. [パラメータモデル](#10-パラメータモデル)
11. [ランタイム統合（`OutputMode::Mate`）](#11-ランタイム統合outputmodemate)
12. [制御 API](#12-制御-api)
13. [Web クライアント](#13-web-クライアント)
14. [データ型の対応（TS ↔ Rust）](#14-データ型の対応ts--rust)
15. [段階的実装計画](#15-段階的実装計画)
16. [将来の外部統合（マイク / AI）](#16-将来の外部統合マイク--ai)
17. [未決事項](#17-未決事項)
18. [参考](#18-参考)

---

## 1. 目的と方針

**相棒（mate）モード**は、Glowbe 球体を「液体のように球面を動きまわる、表情を持つ相棒」にするサーバーモードである。平面ディスプレイのアバターと違い、**顔そのものが球面上を移動・徘徊し、視線に引っ張られてパーツが偏り、見上げれば顔ごと北極へ昇っていく**。待機中は球面を一周するような、流体的でゆったりした待機モーションで「生きている球」を演出する。

### 1.1 体験ゴール

| ID | ゴール |
|----|--------|
| M1 | 顔が球面上の任意の向きに置け、**極を跨いでも破綻せず**滑らかに移動できる |
| M2 | 視線と顔移動が連続体: 軽く見る＝瞳だけ、強く見る＝**顔全体がそちらへ migrate**（見上げ→北極） |
| M3 | StackChan より**液体感**: 慣性・トレイリング・スカッシュ&ストレッチでパーツが遅れて追従し、ぷるんと揺れる |
| M4 | キョロキョロ: 視線方向にパーツが**偏り・密集**し、反対側のパーツは圧縮される |
| M5 | 待機モーション: 球面を一周する徘徊・8 の字・極へのスパイラルなど、**コレオグラフィのレパートリー** |
| M6 | StackChan に囚われない**創造的な表現レパートリー**（形だけでなく色・発光・全球変調・運動の質感・形態変化を感情次元に使う） |
| M7 | これらを**宣言的に管理・合成・ライブ調整**できる仕組み |

### 1.2 スコープ（初期版）

外部入力統合（マイク・AI）は**しない**。サーバ内蔵時計と Web 操作のみで上記を実現する。設計原則は既存と共通: ピクセルはランタイムのみが生成する**単一ライター**で、**Rust フレームループの per-frame 手続き生成**として実装し、事前ベイクには依存しない（[`ARCHITECTURE.md`](ARCHITECTURE.md) §設計原則）。

---

## 2. 調査: StackChan と、なぜそのまま使わないか

StackChan の顔は M5Stack 用ライブラリ [`m5stack-avatar`](https://github.com/meganetaaan/m5stack-avatar)（MIT）が描画する。学ぶべき中核思想は **「コマアニメではなく、連続パラメータ＋自律微動作＋プリセット補間」** である（[`Avatar.cpp`](https://github.com/meganetaaan/m5stack-avatar/blob/0.9.1/src/Avatar.cpp) / [`Face.cpp`](https://github.com/meganetaaan/m5stack-avatar/blob/0.9.1/src/Face.cpp)）。

| 学ぶ点 | 内容 |
|--------|------|
| 連続パラメータ | `expression / breath / eyeOpenRatio / mouthOpenRatio / gaze` から毎フレーム顔を再構成 |
| 自律微動作 | 別タスクで呼吸（sin）・まばたき・サッケードを常時重畳 |
| プリセット補間 | 表情 = 目標値、現在値→目標値へなめらかに近づける |
| 口の独立駆動 | 振幅から `mouthOpenRatio` を駆動（lip-sync の足場） |

**ただし StackChan の前提は Glowbe と根本的に異なり、そのままは使えない。**

| 前提 | StackChan | Glowbe | 帰結 |
|------|-----------|--------|------|
| 面 | 320×240 平面 LCD | 低密度 LED 球体（〜225 LED、正距円筒 UV→球面） | 描画を球面 SDF + 加算発光へ作り直す |
| 顔の場所 | 画面に固定 | **球面のどこにでも置け、移動する** | 顔を「球面上の向き」として持つ |
| 視線 | 瞳だけ動く | 瞳＋**顔全体の migration** | 視線と位置の連続体を導入 |
| 動きの質 | スプライト上書き（剛体的） | **液体的に揺れて追従** | 慣性・スプリング・二次運動を導入 |
| 感情表現 | 主に目・口の形 | **色・発光・全球変調・形態**も使える | 多チャンネル表現へ拡張 |

したがって本設計は **StackChan の「パラメータ駆動・微動作・補間」という骨格だけを継承**し、表現空間・移動・ダイナミクス・管理方法は**球面と液体感に最適化して新規に構築**する。

---

## 3. 設計の核心: 球面ネイティブで液体的な顔

### 3.1 顔フレーム = 球面上の向き（クォータニオン）

顔の位置・向きは `(u,v)` ではなく **クォータニオン `q_face`** で持つ。顔ローカル座標系（前方 `+Z`、上 `+Y`、右 `+X`）を世界座標へ写す回転とする。

- **正面方向** `f̂ = q_face · (0,0,1)` が「顔が向いている球面上の点」。
- **roll**（顔の傾き）も `q_face` に内包され、徘徊時に進行方向へ寝かせるなどの表現に使える。

> **極を跨いでも破綻しない理由（M1 の肝）:** 正距円筒 `(u,v)` は南北極に特異点を持つが、本設計は **入力（各 LED の方向ベクトル）にしか `(u,v)` を使わない**。顔の配置・移動・補間はすべて **3D 方向／クォータニオン空間**で行うため、`(u,v)` の特異点の影響を受けない。「見上げて顔が北極へ」は、ターゲット方向を上に向けて `q_face` を slerp するだけで滑らかに実現でき、ジンバルロックも極での歪みも起きない。

各 LED 方向 `n`（= `unit_dir_from_equirect_uv_y_up(u,v)`）を **顔ローカルへ変換**して評価する。

```
n_local = conj(q_face) · n            // 顔ローカル方向
front   = n_local.z                   // > 0 が顔の前面ヘミスフィア
(s, t)  = (n_local.x, n_local.y) / (1 + n_local.z)   // 立体射影で接平面へ
```

`(s,t)` 上でパーツ SDF を評価する（§9）。立体射影は前面で歪みが少なく、低密度でも素直。

### 3.2 視線と顔移動の連続体（gaze_pull）

視線ターゲット方向 `ĝ`（球面上の点）に対し、**どれだけ顔ごと向くか**を連続パラメータ `gaze_pull ∈ [0,1]` で制御する。

```
f̂_target = slerp(anchor, ĝ, gaze_pull)     // 0:瞳だけ / 1:顔ごと migrate
pupil_offset ∝ (1 - gaze_pull) · (ĝ を顔ローカルへ投影した残差)
```

- `gaze_pull = 0`: 顔は留まり、瞳（ハイライト）だけが `ĝ` 方向へ動く（StackChan 的）。
- `gaze_pull = 1`: 顔全体が `ĝ` へ migrate。`ĝ` が真上なら **顔は北極へ昇る**（M2）。
- `anchor` は徘徊／ムードが決める「基準の居場所」。`gaze_pull` はムード・表情で変える（例: curious は高め、shy は低め）。

### 3.3 液体感: スプリング・慣性・トレイリング・スカッシュ&ストレッチ

剛体的に瞬間移動させず、**物理的な遅れと揺り戻し**を与える（M3）。

**(a) 顔フレームのスプリング（一次運動）**
`f̂_target` へは角速度 `ω` を介したスプリングで追従する。

```
θ, axis = f̂ から f̂_target への角度と回転軸
ω += (k_face · θ · axis − c_face · ω) · dt      // バネ-ダンパ
q_face = normalize(q_face + 0.5 · quat(ω·dt) · q_face)
```

`c_face` を臨界以下にすると floaty（ふわっと行き過ぎて戻る）、上げると素早く減衰。ムードで `k/c` を変えて「運動の質感」を作る。

**(b) パーツのトレイリング（二次運動）**
各パーツは顔ローカルの静止位置 `r_p` を持つが、**顔の角速度に逆らって遅れる**変位を加える。

```
x_p = r_p − lag_p · (ω × r̂_p)        // 急旋回でパーツが後ろへ流れる
   ＋ 各パーツ固有のサブスプリングで r_p へ復元（揺り戻し＝ぷるん）
```

**(c) スカッシュ&ストレッチ**
速度方向へ伸び、直交方向へ縮む（擬似体積保存）。動くほど水滴のように歪む。

```
stretch = 1 + a · |ω|        // 進行方向
squash  = 1 / sqrt(stretch)  // 直交方向
```

**(d) コメット/ボディ・トレイル（任意・強い液体感）**
顔中心が動いた軌跡に沿って、淡い発光の尾を残す（直近の `f̂` 履歴を加算減衰）。球面を泳ぐ生き物のような余韻が出る。

### 3.4 キョロキョロ: パーツのクラスタリング・偏り

`cluster ∈ [0,1]` で、視線方向にパーツを**偏らせ・密集**させる（M4）。

- 全パーツを接平面上で `cluster · gazeVec` だけ視線側へ平行移動。
- 視線と反対側のパーツ（遠い目）は `eye_open` と幅を `(1 − k·cluster)` で**圧縮**（顔をひねって覗き込む見え方）。
- キョロキョロ挙動 = サッケードで `ĝ` を小刻みに動かしつつ `cluster` を一時的に上げる、の合成。

---

## 4. 表現チャンネル（創造的レパートリー）

感情を「目・口の形」だけに押し込めず、**球と発光の特性を活かした複数チャンネル**へ分配する（M6）。表情プリセットはこれらの**横断ベクトル**として定義する。

| # | チャンネル | パラメータ例 | 感情への効き |
|---|------------|--------------|--------------|
| 1 | **ジオメトリ** | `eye_curve`（∧/∪）, `eye_open`, `mouth_curve`, `mouth_open`, `brow_*` | 喜怒哀楽の基本形 |
| 2 | **色・発光** | `hue`, `saturation`, `temperature`(暖/寒), `glow_pulse` | angry=温色で脈動 / calm=寒色で静か |
| 3 | **全球変調** | `breath_amp`（全球の明滅）, `halo`（顔周囲の淡い暈し）, `aura_ripple`（顔から湧く波） | 興奮=全球が脈打つ / 眠気=沈む |
| 4 | **運動の質感** | `stiffness/damping`(§3.3), `floatiness`, `tremor`(微振動) | nervous=細かく震える / sleepy=とろい |
| 5 | **形態・トポロジー** | `eye_count`, `dissolve`（粒子化）, `melt`（垂れ下がり）, `elongation` | surprised=見開き＋伸長 / sad=melt |
| 6 | **分布** | `cluster`(§3.4), `spread`（パーツ間隔）, `face_scale`（全体配置）, `parts_scale`（目・口の形状サイズ） | 集中=密集 / リラックス=広がる |

> **方針:** 初期版は 1・2・3・4・6 を実装し、5（形態変化）は `eye_count` と弱い `melt` 程度に留め、`dissolve` 等は将来拡張に置く。だが**パラメータの器は最初から用意**し、プリセットで段階的に解放する。

---

## 5. 表情プリセット（多チャンネルベクトル）

プリセット = 上記チャンネルの**目標値テーブル**（移動・徘徊などムード系は含めない）。Web のボタンは ID を送るだけ。適用は即時上書きではなく**目標値の差し替え**で、§8 のダイナミクスが滑らかに遷移させる。

| プリセット | eye_curve | eye_open | mouth_curve | mouth_open | 色/温度 | 全球/運動 | 体感 |
|------------|-----------|----------|-------------|------------|---------|-----------|------|
| `neutral` | 0.0 | 1.0 | 0.0 | 0.05 | 寒色寄り中庸 | 標準 | 標準 |
| `happy` | +0.8 | 0.9 | +0.8 | 0.2 | 明・やや暖 | 軽い glow_pulse | 笑顔（∪ 目） |
| `sad` | -0.2 | 0.7 | -0.6 | 0.05 | 暗・寒 | `melt`↑, 沈む | 困り・垂れ |
| `angry` | -0.7 | 1.0 | -0.4 | 0.1 | 温色・高彩度 | 速い tremor＋脈動 | 怒り（∧ 目） |
| `sleepy` | 0.0 | 0.25 | 0.0 | 0.0 | 暗・低彩度 | floaty・とろい | 半目・沈下傾向 |
| `surprised` | 0.0 | 1.0 | 0.0 | 0.7 | 明 | `elongation`↑・一瞬の halo | 見開き＋伸長 |
| `curious` | +0.2 | 1.0 | +0.2 | 0.1 | 明 | `cluster`↑・gaze_pull↑ | 興味津々・覗き込む |
| `playful` | +0.5 | 0.9 | +0.6 | 0.2 | 多彩 | 速い徘徊と相性◎ | やんちゃ |

```rust
pub enum Expression {
    Neutral, Happy, Sad, Angry, Sleepy, Surprised, Curious, Playful,
}
impl Expression {
    pub fn parse(s: &str) -> Option<Self> { /* "neutral" | "happy" | ... */ }
    pub fn as_str(self) -> &'static str { /* ... */ }
    /// 全チャンネル横断の目標値。移動・徘徊は含めない。
    pub fn target(self) -> ExpressionTarget { /* 上表の値 */ }
}
```

プリセットは**重み付きブレンド**を許す（例: `0.7·happy + 0.3·curious`）。これで表情間も連続で、ムードによる味付けも合成できる。

---

## 6. ムードと待機コレオグラフィ

「どこを・どう動きまわるか」は表情と分離し、**ムード（自律行動ジェネレータ）**と**待機コレオグラフィ（移動経路のレパートリー）**で管理する（M5）。

### 6.1 ムード（mood）

ムードは秒〜分のスケールで **anchor の動き方・視線傾向・微動作レート・表情バイアス・運動の質感**を決める上位状態。

| ムード | anchor 挙動 | 視線 | 微動作 | 既定コレオ | 質感 |
|--------|-------------|------|--------|------------|------|
| `calm` | ゆっくり漂う | たまにサッケード | 呼吸ゆったり | `drift` | floaty |
| `curious` | 注目点へ寄る | 高 `gaze_pull`・キョロキョロ | サッケード頻繁 | `peek`/`wander` | 機敏 |
| `playful` | 球面を活発に巡る | 動的 | まばたき多い | `orbit`/`figure8` | 弾む |
| `sleepy` | 下（南）へ沈む・低速 | ほぼ静止 | まばたき遅い・長い閉眼 | `drift`(弱) | とろい |
| `alert` | 直近ターゲットへ素早く | 強い注視 | サッケード抑制 | （停止して注視） | 硬め |

ムードは「現在ムード＋次の遷移確率」で自律遷移も可能だが、**初期版は手動選択のみ**（自律遷移は将来）。

### 6.2 待機コレオグラフィ（idle routine）

`anchor`（基準の居場所）を時間関数で動かす**経路レパートリー**。実際の `f̂` は §3.3 のスプリングを通すので、どの経路も液体的になる。

| ルーチン | 経路 | パラメータ | 用途 |
|----------|------|------------|------|
| `drift` | 低周波ノイズで近傍をたゆたう | 振幅・速度 | 省エネ待機 |
| `orbit` | **大円に沿って球面を一周** | 軸・速度・傾き | 「一周する待機モーション」(M5) |
| `figure8` | 球面上のレムニスケート（8 の字） | 中心・サイズ・速度 | 遊び心 |
| `spiral_pole` | 赤道→極へ螺旋、折り返し | 向き・巻数 | 上下を大きく使う |
| `wander` | 測地線ランダムウォーク（時々停留） | 歩幅・停留時間 | 生き物的探索 |
| `peek` | ある点へ素早く向き、戻る | ターゲット・滞在 | キョロキョロの大版 |

```rust
pub enum IdleRoutine { Drift, Orbit, Figure8, SpiralPole, Wander, Peek }

/// 時刻 t における anchor の目標方向を返す（球面上の単位ベクトル）。
fn idle_anchor(routine: IdleRoutine, t: f32, cfg: &IdleCfg) -> [f32; 3] { /* ... */ }
```

- `orbit` は大円 `cos(ωt)·e₁ + sin(ωt)·e₂`（`e₁⊥e₂`、軸は設定）で**確実に球を一周**。`roll` を進行方向に少し寝かせると“泳ぎ”感が出る。
- すべて単調時計（`loop_start.elapsed()`）駆動でクライアント非依存。乱数系（`wander/peek`）はシード付き。

---

## 7. 微動作（呼吸・まばたき・サッケード・トレモロ）

待機の生命感を、表情・移動と独立した**加算/乗算レイヤ**としてサーバ tick で生成する。

| 動作 | 駆動 | 反映先 | 既定 |
|------|------|--------|------|
| 呼吸 | `0.5+0.5·sin(2π t/period)` | `breath_amp`（全球明滅＋顔の微小スケール） | period≈4s |
| まばたき | 開 2.5–4.5s（乱数）→約120msで 1→0→1 | `eye_open` に乗算 | 両目同時 |
| サッケード | 0.6–1.4s ごとに `ĝ` を微小ランダム移動 | 視線ターゲット（→ §3.2 で瞳/顔へ） | ムードで頻度可変 |
| トレモロ | 高周波微振動 | `q_face` に微小ノイズ回転 | `tremor` 強度で nervous 表現 |

各レイヤは ON/OFF と強度を設定可能（呼吸 OFF・まばたき OFF で完全静止も選べる）。

---

## 8. 合成パイプラインと管理方法

「創造的レパートリーをどう管理・合成するか」（M7）の中核。**宣言的な目標値の重み付き合成 → ダイナミクス積分 → レンダリング**という固定パイプラインに、レイヤを流し込む。

### 8.1 合成順序（毎フレーム）

```
1. ムード         : anchor 経路(idle routine)・各種バイアス・微動作レートを供給
2. 表情ブレンド    : Σ wᵢ·Expressionᵢ.target() → チャンネル目標値
3. 微動作         : 呼吸/まばたき/サッケード/トレモロ を重畳（加算 or 乗算）
4. ダイナミクス    : 目標 → 現在 をスプリング/慣性/トレイリングで積分（§3.3）
                    ＋ gaze_pull で視線→顔移動を解決（§3.2）
5. レンダリング    : q_face で LED 方向を顔ローカルへ → SDF 評価 → 加算発光（§9）
6. 最終トーン      : apply_master_tone（輝度/ガンマ・全モード共通）
```

### 8.2 管理方法（オーサリングと調整）

- **データ駆動:** 表情プリセット・ムード・コレオ設定は**データ**（Rust const、または `config.toml`／JSON で外出し可）。コード分岐を増やさず追加できる。
- **重み付きブレンド:** 表情・ムードは即時切替でなく**重みの遷移**。`set` は目標重みを動かし、ダイナミクスが繋ぐ。
- **チャンネル独立:** 各チャンネル（§4）は独立に補間時定数を持つ（形は速く、色はゆっくり等）。
- **ライブ調整:** 物理パラメータ（`stiffness/damping/floatiness/tremor`）や `gaze_pull`、コレオ速度を **WS/REST でその場調整**でき、実機で詰められる。
- **決定性:** すべてサーバ単調時計＋シード乱数。単一ライター原則を維持。

### 8.3 補間（フレームレート非依存）

```rust
fn approach(current: f32, target: f32, dt: f32, tau: f32) -> f32 {
    let k = 1.0 - (-dt / tau).exp();
    current + (target - current) * k
}
```
形状 `tau≈0.18s`、色 `tau≈0.4s`、視線スプリングは §3.3 の角速度系、呼吸は直接代入。まばたきは補間でなく時間エンベロープで `eye_open` を生成し表情側へ乗算。

---

## 9. 球面上の顔レンダリング

### 9.1 座標と評価

- 既存 [`runtime/src/sphere.rs`](../runtime/src/sphere.rs) の `unit_dir_from_equirect_uv_y_up(u,v)` で各 LED を方向ベクトル化。LED 順 UV テーブルは `interactive` と同じ **`SharedApp::interactive_uv`（`ensure_interactive_uv`）** を流用。
- 各方向を §3.1 のとおり `q_face` で顔ローカルへ変換、前面（`n_local.z>0`）のみ立体射影で `(s,t)` を得て評価。背面はベース（黒＋任意の弱いアンビエント）。

### 9.2 パーツ SDF

`(s,t)`（さらに §3 のトレイル/スカッシュ/クラスタ変位を適用後）でパーツを SDF 評価し、`smoothstep` で発光強度へ（低密度でも境界が滑らか）。

| パーツ | 形状 | 主パラメータ |
|--------|------|--------------|
| 目（左/右） | 楕円。`eye_curve` で上弧/下弧クリップ。瞳に視線残差オフセット | `eye_open`, `eye_curve`, `cluster` |
| 眉（任意） | カプセル（線分） | `brow_angle/raise` |
| 口 | 角を `mouth_curve` で曲げた横カプセル。`mouth_open` で縦に開く | `mouth_width/open/curve` |
| 全球変調 | 顔と無関係に球全体へ作用 | `breath_amp`, `halo`, `aura_ripple` |

### 9.3 合成（加算発光）

- パーツ発光 `× color` を**線形光バッファに加算** → sRGB エンコード → クリップ。既存 `interactive` の混色（`blend_interactive_accum` 相当）と同方式で、重なりが自然に飽和。
- `aura_ripple` は顔中心 `f̂` からの**大円角距離**で波を作る（`angle_rad_between_unit` 再利用）。`interactive` の輪波面評価を流用できる。

### 9.4 性能

- per-LED は「方向回転＋数パーツの SDF＋加算」。クォータニオン回転は LED 数ぶんだが軽量。tick 予算 < 2ms（[`ARCHITECTURE.md`](ARCHITECTURE.md) §16）に収まる見込み。
- `sin/exp/slerp` 等はフレーム単位の少数回（パラメータ更新時）に限定し、per-LED ループ内は加減算・smoothstep 中心に保つ。

---

## 10. パラメータモデル

最終的にレンダラへ渡すのは確定済みの **`FaceParams`**。その上流に **`FaceFrame`（運動）** と **`MateState`（補間現在値・ムード・設定）** を置く。

```rust
/// 顔の運動状態（球面上の向きと角速度）。
pub struct FaceFrame {
    pub q_face: Quat,          // 顔ローカル→世界
    pub omega: [f32; 3],       // 角速度（液体感の源）
}

/// レンダラへ渡す確定パラメータ（全チャンネル）。
pub struct FaceParams {
    // 視線・配置
    pub gaze_dir: [f32; 3], pub gaze_pull: f32, pub cluster: f32,
    pub face_scale: f32, pub parts_scale: f32, pub elongation: f32,
    // 目・眉・口
    pub eye_open_l: f32, pub eye_open_r: f32, pub eye_curve: f32,
    pub brow_angle: f32, pub brow_raise: f32, pub eye_count: u8,
    pub mouth_open: f32, pub mouth_width: f32, pub mouth_curve: f32,
    // 色・発光・全球
    pub color: [u8; 3], pub temperature: f32, pub saturation: f32,
    pub brightness: f32, pub glow_pulse: f32, pub breath_amp: f32,
    pub halo: f32, pub aura_ripple: f32,
    // 運動の質感・形態
    pub tremor: f32, pub melt: f32, pub dissolve: f32,
}

/// 相棒モードの可変状態。WS/REST で更新、tick で積分。
pub struct MateState {
    pub frame: FaceFrame,
    pub current: FaceParams,                 // 補間の現在値
    pub expr_weights: Vec<(Expression, f32)>,// ブレンド対象と重み
    pub mood: Mood,
    pub routine: IdleRoutine, pub idle_cfg: IdleCfg,
    pub gaze_target: [f32; 3],               // サッケード/明示
    pub auto: AutoFlags,                     // breath/blink/saccade/tremor/sway
    pub dynamics: DynamicsCfg,               // stiffness/damping/floatiness/lag
    pub rng: SmallRng,
    pub next_blink_at: Instant, pub next_saccade_at: Instant,
    // anchor・色など外観設定
}
```

- 既存 `InteractivePulse` と違い**常時保持**。tick 内は積分のみ（重い処理なし）。

---

## 11. ランタイム統合（`OutputMode::Mate`）

既存 `OutputMode` は `Idle / Loop / Interactive`（[`runtime/src/state.rs`](../runtime/src/state.rs)）。4 つ目を追加する。`Mode` trait 化（[`STATUS.md`](STATUS.md) TODO #3）は前提にせず、enum＋`output.rs` match 拡張で足す。

```rust
pub enum OutputMode { Idle, Loop, Interactive, Mate }   // Mate 追加
// parse: "mate" => Mate / as_str: Mate => "mate" / code/from_code に 1 値追加
```

フレームループ（[`runtime/src/output.rs`](../runtime/src/output.rs)）の match に分岐を足す。

```rust
match app.output_mode() {
    OutputMode::Idle => rgb.fill(0),
    OutputMode::Loop => { /* 既存 */ }
    OutputMode::Interactive => rgb.fill(0),
    OutputMode::Mate => {
        // §8.1: ムード→表情ブレンド→微動作→ダイナミクス積分→確定 FaceParams
        // → interactive_uv で per-LED 球面 SDF を評価・加算発光
        render_mate_face(&app, dt, &mut rgb);
    }
}
if app.output_mode() == OutputMode::Interactive {
    try_apply_interactive_overlay(&app, &mut rgb);   // Mate には適用しない
}
apply_master_tone(&app, &mut rgb);                   // 最終段は全モード共通
```

- 黒ベースに顔を描く**常時レンダラ**。`apply_master_tone` も適用する。
- `idle` 遷移時のシーケンス解除など既存 `post_mode` 挙動は維持。`mate` は `loop` シーケンスと独立。

---

## 12. 制御 API

`interactive`（WS）と `mode/master-tone`（REST）のパターンに合わせる。連続値（視線・口・徘徊）は WS、設定系は REST/WS どちらでも。正本は実装時に [`protocol/control-api.md`](../protocol/control-api.md) へ追記。

### 12.1 REST

| メソッド | パス | ボディ | 用途 |
|----------|------|--------|------|
| POST | `/api/v1/mode` | `{ "mode": "mate" }` | 相棒モードへ |
| POST | `/api/v1/mate/state` | 下記 | 表情・ムード・コレオ・調整の一括/部分更新 |

```jsonc
{
  "expression": "curious",                 // or {"blend":[["happy",0.7],["curious",0.3]]}
  "mood": "playful",
  "idle": { "routine": "orbit", "speed": 0.15, "axis": [0,1,0], "tilt": 0.3 },
  "gaze": { "u": 0.5, "v": 0.2 },          // 視線ターゲット（球面 UV）
  "gazePull": 0.8,                         // 0:瞳のみ / 1:顔ごと migrate
  "cluster": 0.6,                          // キョロキョロの偏り
  "dynamics": { "stiffness": 6.0, "damping": 0.7, "floatiness": 0.4, "trailLag": 0.3 },
  "appearance": { "color": [200,240,255], "temperature": 0.2, "brightness": 0.9, "faceScale": 1.0, "partsScale": 1.0 },
  "auto": { "breath": true, "blink": true, "saccade": true, "tremor": false }
}
```

### 12.2 WebSocket（`/api/v1/ws`、`mate` モード時のみ受理）

Client → Server: `{ type: "mate", action, ... }`

| action | フィールド | 用途 |
|--------|------------|------|
| `setExpression` | `expression` または `blend` | 表情（ブレンド可） |
| `setMood` | `mood` | ムード |
| `setIdle` | `routine`, 経路パラメータ | 待機コレオ（orbit 等） |
| `setGaze` | `u,v`（or 方向）, `gazePull`, `cluster` | 視線・顔移動・偏り |
| `setDynamics` | `stiffness/damping/floatiness/trailLag` | 液体感のライブ調整 |
| `setAppearance` | `color/temperature/brightness/faceScale/partsScale` | 外観 |
| `setAuto` | `breath/blink/saccade/tremor` | 微動作トグル |
| `setMouthOpen` | `value` | 口（将来 lip-sync） |
| `blink` / `peek` | （ターゲット） | ワンショット動作 |

Server → Client は既存どおり `state`（1 秒周期）と `event_status`。`state` に現在 `expression/mood/routine/auto` を含め UI 同期に使う。

---

## 13. Web クライアント

`StudioPage.tsx` に 4 つ目タブ「相棒（Mate）」を追加し `MateModePanel.tsx` を新設。`LiveControls` の WS 管理と `LayoutUvSphereCanvas`／`LayoutUvSheet` のプレビュー資産を流用する。

- **表情:** プリセットボタン群（＋任意でブレンド 2 つの重みスライダー）。
- **ムード／待機:** ムード選択＋コレオ選択（orbit/figure8/…）と速度・軸スライダー。「球面一周」をワンタップで。
- **視線・移動:** 2D/3D プレビューのタップで視線ターゲット `(u,v)`（2D を正とする既存変換に従う）。`gazePull`・`cluster` スライダーで「瞳だけ↔顔ごと」「キョロキョロ度」を調整。
- **液体感:** `stiffness/damping/floatiness/trailLag` スライダーでその場チューニング。
- **微動作:** 呼吸・まばたき・サッケード・トレモロのトグル。
- **外観:** 色・温度・明るさ・顔サイズ。
- **プレビュー:** 2D equirect ＋ 3D 球（サーバ生成を反映表示）。

`canMate = outputMode === 'mate'` をガードに WS 送信。接続時に `state` から現在値を取り込み初期表示を合わせる。

---

## 14. データ型の対応（TS ↔ Rust）

| 概念 | TypeScript（`web/src/types.ts`） | Rust（`runtime/src`） |
|------|----------------------------------|------------------------|
| モード | `OutputMode = ... \| 'mate'` | `OutputMode::Mate`（`state.rs`） |
| 表情 | `Expression`（8 種） | `Expression`（新 `mate.rs`） |
| ムード | `Mood` | `Mood` |
| 待機コレオ | `IdleRoutine` | `IdleRoutine` |
| 顔運動/パラメータ | UI 状態 | `FaceFrame` / `FaceParams` / `MateState` |
| ダイナミクス | `DynamicsCfg` | `DynamicsCfg` |
| WS メッセージ | `{ type:'mate', action, ... }` | `handle_ws_text` の `"mate"` 分岐（`api.rs`） |

Web UI 文言は英語、Rust/ドキュメントは日本語という既存方針を踏襲。

---

## 15. 段階的実装計画

| Phase | 内容 | 完了条件 |
|-------|------|----------|
| **A. 球面フレーム＋静的な顔** | `OutputMode::Mate`、`q_face` 変換、立体射影、`neutral` を球面に描画 | 顔が球面の任意の向きに出る。極でも破綻しない |
| **B. 移動と液体感** | gaze_pull・スプリング・トレイリング・スカッシュ&ストレッチ | 見上げ→北極、急旋回でパーツが流れて揺り戻す |
| **C. 表情＋多チャンネル** | `Expression` プリセット・ブレンド・色/全球/質感チャンネル | ボタンで表情が滑らかに変わり、色や脈動も伴う |
| **D. ムード＋待機コレオ** | ムード、`orbit/figure8/wander/...`、キョロキョロ、微動作 | 球面を一周する待機・覗き込みが自然に動く |
| **E. Web パネル** | `MateModePanel`、WS 制御、ライブ調整、2D/3D プレビュー | ブラウザだけで表情・移動・液体感を操作・調整できる |
| **F. 仕上げ** | 設定の外出し（データ駆動）、`state` 同期、単体テスト（幾何/補間） | `cargo test`・lint 通過、`STATUS.md` 反映 |

初期版（外部統合なし）の達成点は **E まで**。F は品質仕上げ。

---

## 16. 将来の外部統合（マイク / AI）

初期版では実装しないが、無改修で繋げられる接点を用意する。

- **口チャンネルの外部駆動:** `mouth_open` を外部信号で上書き可能に分離（lip-sync）。サーバマイク（`mic`, cpal）や AI 発話の振幅エンベロープを流し込む。
- **表情・ムードの外部指定:** `setExpression`/`setMood` は AI の感情ラベルでもそのまま使える。`aura_ripple` 等を発話強調に使う余地。
- **自律遷移:** ムードの自律遷移（確率/コンテキスト）を入れれば、入力が無い時間帯も飽きない相棒になる。
- **モード関係:** `ai_voice`（[`ARCHITECTURE.md`](ARCHITECTURE.md) §9.6）は相棒モードを**描画エンジン**として利用し、入力（音声・テキスト）は別系統で供給する構成を想定。相棒モードは「顔の描画・移動・微動作」に責務を限定する。

---

## 17. 未決事項

| # | 論点 | 備考 |
|---|------|------|
| 1 | `anchor`／顔の正面の既定向き | 設置向き・配線依存。レイアウトごとに既定を持つか |
| 2 | 低密度 LED での視認性 | 225 LED で目・口・移動が読めるか実機確認。読めなければパーツ大型化・数を絞る |
| 3 | クォータニオン依存の追加 | 軽量 quat を自前実装するか小クレート導入か（依存方針に従う） |
| 4 | 液体感の既定値 | floaty すぎると酔う／硬すぎると機械的。ムード別プリセットで詰める |
| 5 | `Mate` を `Mode` trait 化の起点にするか | trait 化（STATUS TODO #3）と同時だと綺麗。スコープ拡大に注意 |
| 6 | 形態変化（dissolve/melt）の範囲 | 初期は弱め。粒子化は将来 |
| 7 | コレオ・ムード・表情の外出し形式 | Rust const か `config.toml`/JSON か |

---

## 18. 参考

- [`meganetaaan/m5stack-avatar`](https://github.com/meganetaaan/m5stack-avatar) — StackChan の顔描画ライブラリ（MIT）。骨格思想（パラメータ駆動・微動作・補間・lip-sync）の出典。
  - [`src/Avatar.cpp`（0.9.1）](https://github.com/meganetaaan/m5stack-avatar/blob/0.9.1/src/Avatar.cpp) — パラメータと自律微動作タスク。
  - [`src/Face.cpp`（0.9.1）](https://github.com/meganetaaan/m5stack-avatar/blob/0.9.1/src/Face.cpp) — パーツ合成・呼吸オフセット。
- [`stack-chan/stack-chan`](https://github.com/stack-chan/stack-chan) / [`m5stack/StackChan`](https://github.com/m5stack/StackChan) — StackChan 本体・公式オープンソース。
- アニメーション原則: スカッシュ&ストレッチ、二次運動（follow-through / overlapping action）— §3.3 の液体感の根拠。
- Glowbe 内部: [`ARCHITECTURE.md`](ARCHITECTURE.md) §9、[`runtime/src/sphere.rs`](../runtime/src/sphere.rs)（球面幾何・大円角）、[`runtime/src/output.rs`](../runtime/src/output.rs)（フレームループ）、[`runtime/src/state.rs`](../runtime/src/state.rs)（`OutputMode`/interactive）、[`web/src/lib/layout-uv-geometry.ts`](../web/src/lib/layout-uv-geometry.ts)（UV↔球面）。

---

*以上*
