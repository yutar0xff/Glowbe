//! Built-in procedural loop demos (layout-independent).

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use crate::mate;
use crate::output::{
    apply_interactive_expanding_ring_diagonal, finalize_linear_add_accum_black_base, ring_dynamics,
};
use crate::pattern;
use crate::state::{InteractiveEffectKind, InteractivePulse};

pub const DEMO_PREFIX: &str = "demo/";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DemoId {
    ExpandingRings,
    RainbowSweep,
    Twinkle,
    MateMoods,
    RainbowRings,
}

type DemoRenderer = fn(&[(f32, f32)], Duration, &mut [u8]);

impl DemoId {
    pub fn parse(id: &str) -> Option<Self> {
        let rest = id.strip_prefix(DEMO_PREFIX)?;
        match rest {
            "expanding-rings" => Some(Self::ExpandingRings),
            "rainbow-sweep" => Some(Self::RainbowSweep),
            "twinkle" => Some(Self::Twinkle),
            "mate-moods" => Some(Self::MateMoods),
            "rainbow-rings" => Some(Self::RainbowRings),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::ExpandingRings => "expanding-rings",
            Self::RainbowSweep => "rainbow-sweep",
            Self::Twinkle => "twinkle",
            Self::MateMoods => "mate-moods",
            Self::RainbowRings => "rainbow-rings",
        }
    }

    pub fn clip_id(self) -> String {
        format!("{DEMO_PREFIX}{}", self.as_str())
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::ExpandingRings => "Expanding rings",
            Self::RainbowSweep => "Rainbow sweep",
            Self::Twinkle => "Twinkle",
            Self::MateMoods => "Mate moods",
            Self::RainbowRings => "Rainbow + rings",
        }
    }

    pub fn fps(self) -> u32 {
        30
    }

    pub fn loop_period(self) -> Duration {
        match self {
            Self::ExpandingRings => Duration::from_secs_f32(12.5),
            Self::RainbowSweep => Duration::from_secs(6),
            Self::Twinkle => Duration::from_secs(5),
            Self::MateMoods => Duration::from_secs_f32(mood_period_s()),
            Self::RainbowRings => Duration::from_secs_f32(rainbow_rings_period_s()),
        }
    }

    pub fn all() -> [Self; 5] {
        [
            Self::ExpandingRings,
            Self::RainbowSweep,
            Self::Twinkle,
            Self::MateMoods,
            Self::RainbowRings,
        ]
    }

    fn renderer(self) -> DemoRenderer {
        match self {
            Self::ExpandingRings => render_expanding_rings,
            Self::RainbowSweep => render_rainbow_sweep,
            Self::Twinkle => render_twinkle,
            Self::MateMoods => render_mate_moods,
            Self::RainbowRings => render_rainbow_rings,
        }
    }

    pub fn render_into(self, elapsed: Duration, uv: &[(f32, f32)], out: &mut [u8]) {
        (self.renderer())(uv, elapsed, out);
    }
}

#[derive(Debug, Clone, Copy)]
struct Xor(u64);

impl Xor {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn f01(&mut self) -> f32 {
        (self.next() as f64 / u64::MAX as f64) as f32
    }

    fn range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + (hi - lo) * self.f01()
    }
}

#[derive(Clone, Copy)]
struct RingPulseSpec {
    t0: f32,
    life_s: f32,
    center_u: f32,
    center_v: f32,
    amplitude: f32,
    color_r: u8,
    color_g: u8,
    color_b: u8,
    ring_speed: f32,
}

fn expanding_ring_specs() -> Vec<RingPulseSpec> {
    let mut rng = Xor(0x0DEB_171D_ED00);
    (0..18)
        .map(|_| {
            let ring_speed = rng.range(0.82, 1.48);
            let d = ring_dynamics(ring_speed, 0.0);
            RingPulseSpec {
                t0: rng.range(0.0, 7.8),
                life_s: d.lifetime + 0.5,
                center_u: rng.range(0.1, 0.9),
                center_v: rng.range(0.1, 0.9),
                amplitude: rng.range(0.55, 1.15),
                color_r: rng.range(80.0, 255.0) as u8,
                color_g: rng.range(40.0, 220.0) as u8,
                color_b: rng.range(60.0, 255.0) as u8,
                ring_speed,
            }
        })
        .collect()
}

fn expanding_ring_specs_cached() -> &'static [RingPulseSpec] {
    static SPECS: OnceLock<Vec<RingPulseSpec>> = OnceLock::new();
    SPECS.get_or_init(expanding_ring_specs)
}

/// expanding-rings の「最初のリングが生まれる時刻」と「最後のリングが消える時刻」（秒）。
fn ring_active_window() -> (f32, f32) {
    static WINDOW: OnceLock<(f32, f32)> = OnceLock::new();
    *WINDOW.get_or_init(|| {
        let specs = expanding_ring_specs_cached();
        let first = specs.iter().map(|s| s.t0).fold(f32::INFINITY, f32::min);
        let last = specs.iter().map(|s| s.t0 + s.life_s).fold(0.0f32, f32::max);
        (first, last)
    })
}

fn render_expanding_rings(uv: &[(f32, f32)], elapsed: Duration, out: &mut [u8]) {
    let specs = expanding_ring_specs_cached();
    let period = DemoId::ExpandingRings.loop_period().as_secs_f32();
    let t = elapsed.as_secs_f32() % period;
    let anchor = Instant::now();
    let mut acc = vec![0f32; uv.len() * 3];
    for spec in specs {
        let local = t - spec.t0;
        if local < 0.0 || local >= spec.life_s {
            continue;
        }
        let pulse = InteractivePulse {
            center_u: spec.center_u,
            center_v: spec.center_v,
            amplitude: spec.amplitude,
            sigma_rad: 0.14,
            effect: InteractiveEffectKind::ExpandingRingDiagonal,
            started: anchor - Duration::from_secs_f32(local),
            duration: Duration::from_secs_f32(spec.life_s),
            color_r: spec.color_r,
            color_g: spec.color_g,
            color_b: spec.color_b,
            ring_speed: spec.ring_speed,
            ring_thickness_rad: 0.0,
        };
        apply_interactive_expanding_ring_diagonal(&mut acc, uv, &pulse, anchor);
    }
    let frame = finalize_linear_add_accum_black_base(&acc);
    if frame.len() == out.len() {
        out.copy_from_slice(&frame);
    } else {
        out.fill(0);
    }
}

fn render_rainbow_sweep(uv: &[(f32, f32)], elapsed: Duration, out: &mut [u8]) {
    let t_ms = (elapsed.as_millis() % u128::from(u32::MAX)) as u32;
    pattern::fill_loop_rgb(t_ms, out, Some(uv));
}

fn render_twinkle(uv: &[(f32, f32)], elapsed: Duration, out: &mut [u8]) {
    let t = elapsed.as_secs_f32();
    for (i, &(u, v)) in uv.iter().enumerate() {
        let hash = ((u * 43_758.547 + v * 19_643.21).fract() * 1000.0) as u32;
        let phase = (hash % 100) as f32 * 0.1;
        let blink = ((t * 2.5 + phase).sin() * 0.5 + 0.5).powi(3);
        let base = if hash.is_multiple_of(7) { 1.0 } else { 0.15 };
        let v = (blink * base * 255.0) as u8;
        let o = i * 3;
        out[o] = v;
        out[o + 1] = v;
        out[o + 2] = (v as f32 * 1.1).min(255.0) as u8;
    }
}

/// rainbow のみを見せる相の長さ（秒）。
const RAINBOW_RINGS_SOLO_S: f32 = 4.0;
/// rainbow→rings のクロスフェード長（秒）。リング相の先頭に重ねる。
const RAINBOW_RINGS_BLEND_IN_S: f32 = 1.4;
/// rings→rainbow のクロスフェード長（秒）。リング相の末尾に重ねる。
const RAINBOW_RINGS_BLEND_OUT_S: f32 = 0.2;

fn smoothstep01(x: f32) -> f32 {
    let x = x.clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}

/// リング相のアクティブ長に対する in/out クロスフェード長（秒）。
/// 2 つのフェードが重ならないよう、合計がアクティブ長を超えないようにクランプする。
fn rainbow_rings_blends(active: f32) -> (f32, f32) {
    let out = RAINBOW_RINGS_BLEND_OUT_S.min(active * 0.5);
    let in_ = RAINBOW_RINGS_BLEND_IN_S.min((active - out).max(1e-3));
    (in_, out)
}

/// rainbow-rings の 1 周期（秒）。solo 相 + リングの実アクティブ長。
fn rainbow_rings_period_s() -> f32 {
    let (first, last) = ring_active_window();
    RAINBOW_RINGS_SOLO_S + (last - first).max(1e-3)
}

/// 時刻 t におけるリングのブレンド重み（0=rainbow のみ, 1=rings のみ）。
/// リング相の先頭 `blend_in` 秒で 0→1、末尾 `blend_out` 秒で 1→0 に smoothstep で遷移する。
fn rainbow_rings_ring_weight(t: f32, solo: f32, active: f32, blend_in: f32, blend_out: f32) -> f32 {
    if t <= solo {
        return 0.0;
    }
    let lt = t - solo;
    let rise = smoothstep01(lt / blend_in.max(1e-3));
    let fall = smoothstep01((active - lt) / blend_out.max(1e-3));
    rise.min(fall)
}

fn blend_rgb_into(base: &mut [u8], overlay: &[u8], w: f32) {
    if base.len() != overlay.len() {
        return;
    }
    let w = w.clamp(0.0, 1.0);
    let base_w = 1.0 - w;
    for (b, &o) in base.iter_mut().zip(overlay.iter()) {
        *b = (*b as f32 * base_w + o as f32 * w)
            .round()
            .clamp(0.0, 255.0) as u8;
    }
}

/// rainbow-sweep と expanding-rings を交互に再生する。
///
/// 切り替えはハードカットではなくクロスフェード（`RAINBOW_RINGS_BLEND_S` の
/// グラデーション）で行う。リング相はリストの「最初のリングが生まれる時刻」から
/// 「最後のリングが消える時刻」にちょうど重ねてあるため、rainbow→rings では
/// 切り替わる瞬間に最初のリングが出現しながら rainbow がフェードアウトし、
/// rings→rainbow では最後のリングが消える瞬間へ向けて rainbow がフェードインする。
/// rainbow は常時連続再生するのでフェード復帰時も途切れない。
fn render_rainbow_rings(uv: &[(f32, f32)], elapsed: Duration, out: &mut [u8]) {
    let solo = RAINBOW_RINGS_SOLO_S;
    let (ring_first, ring_last) = ring_active_window();
    let active = (ring_last - ring_first).max(1e-3);
    let (blend_in, blend_out) = rainbow_rings_blends(active);
    let period = (solo + active).max(1e-3);
    let t = elapsed.as_secs_f32().rem_euclid(period);

    render_rainbow_sweep(uv, elapsed, out);

    let w = rainbow_rings_ring_weight(t, solo, active, blend_in, blend_out);
    if w <= 0.0 {
        return;
    }
    let ring_t = ring_first + (t - solo);
    let mut rings = vec![0u8; out.len()];
    render_expanding_rings(uv, Duration::from_secs_f32(ring_t), &mut rings);
    blend_rgb_into(out, &rings, w);
}

/// 切り替え時の顔全体の球面ヨー回転の種類。
#[derive(Clone, Copy, PartialEq, Eq)]
enum SpinKind {
    /// 回転なし。
    None,
    /// 遷移中に ease-in-out-back で 1 回転して正面へ戻る離散的な回し方（保持中は正面で静止）。
    Discrete,
    /// 区間全体（遷移+保持）で 360° 等速回転する連続的な回し方（正面で止まらない）。
    Continuous,
}

/// 「表情を切り替えすぎて mate が怒る」ムードデモの 1 キーフレーム。
/// `trans_s` はひとつ前の表情からのモーフ時間、`hold_s` は到達後の保持時間、
/// `spin` はこの表情への切り替え時の回転演出（`render_mate_moods` のヨー演出）。
struct MoodKey {
    id: &'static str,
    trans_s: f32,
    hold_s: f32,
    spin: SpinKind,
}

impl MoodKey {
    /// 離散回転（ease-in-out-back で 1 回転し正面へ戻る）。
    const fn discrete(id: &'static str, trans_s: f32, hold_s: f32) -> Self {
        Self {
            id,
            trans_s,
            hold_s,
            spin: SpinKind::Discrete,
        }
    }

    /// 連続回転（区間全体で 360° 等速回転。正面で止まらない）。
    const fn continuous(id: &'static str, trans_s: f32, hold_s: f32) -> Self {
        Self {
            id,
            trans_s,
            hold_s,
            spin: SpinKind::Continuous,
        }
    }

    /// 回転なしの遷移。
    const fn plain(id: &'static str, trans_s: f32, hold_s: f32) -> Self {
        Self {
            id,
            trans_s,
            hold_s,
            spin: SpinKind::None,
        }
    }
}

/// happy を少し見せてから surprised→love→sad を 10 周する。切り替え間隔（区間長）は
/// 1〜10 周目を通して滑らかに短くなり続ける（＝回転が加速し続ける）。加えて保持時間 `hold_s`
/// を 1〜10 周目で 0 へグラデーションさせるため、正面での「間（静止）」が段階的に消えて
/// 切り替えがなめらかになる。前半（1〜5 周目）は遷移ごとに ease-in-out-back で 1 回転して
/// 正面へ戻る離散的な回し方、後半（6 周目以降）は正面で止まらない連続回転へ自然に移行する。
/// 連続回転区間はちょうど 1 回転（360°≡0°）で終わるので隣接区間・フィナーレ境界でも位置は連続。
/// 最後に angry→neutral→happy（回転なし）でループ起点の happy へ戻る。
static MOOD_KEYS: [MoodKey; 34] = [
    MoodKey::plain("happy", 0.0, 2.5),
    // 1〜5 周目: ease-in-out-back の離散回転。区間長を詰めて加速し、hold を 0 へ寄せていく。
    MoodKey::discrete("surprised", 0.35, 0.55),
    MoodKey::discrete("love", 0.35, 0.55),
    MoodKey::discrete("sad", 0.35, 0.55),
    MoodKey::discrete("surprised", 0.26, 0.36),
    MoodKey::discrete("love", 0.26, 0.36),
    MoodKey::discrete("sad", 0.26, 0.36),
    MoodKey::discrete("surprised", 0.22, 0.22),
    MoodKey::discrete("love", 0.22, 0.22),
    MoodKey::discrete("sad", 0.22, 0.22),
    MoodKey::discrete("surprised", 0.19, 0.12),
    MoodKey::discrete("love", 0.19, 0.12),
    MoodKey::discrete("sad", 0.19, 0.12),
    MoodKey::discrete("surprised", 0.17, 0.05),
    MoodKey::discrete("love", 0.17, 0.05),
    MoodKey::discrete("sad", 0.17, 0.05),
    // 6〜10 周目: 連続回転へ自然移行しつつ加速。hold はほぼ 0 まで詰めて間をなくす。
    MoodKey::discrete("surprised", 0.16, 0.03),
    MoodKey::discrete("love", 0.16, 0.03),
    MoodKey::discrete("sad", 0.16, 0.03),
    MoodKey::continuous("surprised", 0.14, 0.018),
    MoodKey::continuous("love", 0.14, 0.018),
    MoodKey::continuous("sad", 0.14, 0.018),
    MoodKey::continuous("surprised", 0.12, 0.01),
    MoodKey::continuous("love", 0.12, 0.01),
    MoodKey::continuous("sad", 0.12, 0.01),
    MoodKey::continuous("surprised", 0.11, 0.004),
    MoodKey::continuous("love", 0.11, 0.004),
    MoodKey::continuous("sad", 0.11, 0.004),
    MoodKey::continuous("surprised", 0.10, 0.0),
    MoodKey::continuous("love", 0.10, 0.0),
    MoodKey::continuous("sad", 0.10, 0.0),
    // フィナーレ（回転なし）
    MoodKey::plain("angry", 0.45, 2.5),
    MoodKey::plain("neutral", 0.5, 0.6),
    MoodKey::plain("happy", 0.6, 0.0),
];

fn mood_keys() -> &'static [MoodKey] {
    &MOOD_KEYS
}

/// ムードデモの呼吸周期（秒）。表情ごとの周期差による位相飛びを避けるため固定。
const MOOD_BREATH_PERIOD_S: f32 = 4.0;

fn mood_period_s() -> f32 {
    mood_keys().iter().map(|k| k.trans_s + k.hold_s).sum()
}

fn mood_registry() -> &'static mate::PresetRegistry {
    static REG: OnceLock<mate::PresetRegistry> = OnceLock::new();
    REG.get_or_init(|| {
        mate::PresetRegistry::load(std::path::Path::new("/nonexistent"))
            .expect("builtin mate presets")
    })
}

fn mood_frame() -> &'static mate::FaceFrame {
    static FRAME: OnceLock<mate::FaceFrame> = OnceLock::new();
    FRAME.get_or_init(|| mate::FaceFrame::from_params(mate::FaceFrameParams::default()))
}

fn render_mate_moods(uv: &[(f32, f32)], elapsed: Duration, out: &mut [u8]) {
    let registry = mood_registry();
    let frame = mood_frame();
    let keys = mood_keys();
    let period = mood_period_s();
    let t = elapsed.as_secs_f32().rem_euclid(period.max(1e-3));

    // 現在のキーフレームと、その区間内での経過時間を求める。
    let mut start = 0.0;
    let mut idx = keys.len() - 1;
    for (i, k) in keys.iter().enumerate() {
        let seg = k.trans_s + k.hold_s;
        if t < start + seg {
            idx = i;
            break;
        }
        start += seg;
    }
    let key = &keys[idx];
    let local = t - start;
    let prev_id = if idx == 0 {
        keys[keys.len() - 1].id
    } else {
        keys[idx - 1].id
    };

    let (Some(cur), Some(prev)) = (registry.get(key.id), registry.get(prev_id)) else {
        out.fill(0);
        return;
    };

    let in_transition = key.trans_s > 1e-4 && local < key.trans_s;
    let expr = if in_transition {
        let tt = mate::ease_in_out_cubic(local / key.trans_s);
        mate::lerp_expression(prev, cur, tt)
    } else {
        cur.clone()
    };

    // 切り替え時の顔全体の球面ヨー回転。
    // Discrete（前半）は遷移中に ease-in-out-back で 1 回転し正面へ戻る離散的な回し方。
    // Continuous（後半）は区間全体（遷移+保持）で 360° 等速回転させるため保持中も止まらず、
    // 区間長が短くなるほど速く回る。各区間はちょうど 1 回転（360°≡0°）で終わるので、
    // 区間長が変化しても隣接区間・フィナーレ境界で位置は連続する。
    let yaw_deg = match key.spin {
        SpinKind::None => 0.0,
        SpinKind::Discrete => {
            if in_transition {
                360.0 * mate::ease_in_out_back(local / key.trans_s)
            } else {
                0.0
            }
        }
        SpinKind::Continuous => {
            let seg = (key.trans_s + key.hold_s).max(1e-4);
            360.0 * (local / seg)
        }
    };

    // 呼吸: デモはステートレスなので固定周期で位相を連続計算する（表情ごとの
    // 周期差による位相飛びを避ける）。
    let breathing = mate::BreathingParams { enabled: true };
    let phase = elapsed.as_secs_f32() / MOOD_BREATH_PERIOD_S * std::f32::consts::TAU;
    let wave = breathing.sample_wave(phase);

    let samples = mate::build_face_samples_yawed(uv, frame, yaw_deg);
    let mods = mate::Modulation {
        breathe_brightness: wave.brightness_gain,
        breathe_face_scale: wave.face_scale,
        breathe_face_offset_y: wave.face_offset_y,
        blink_openness: 1.0,
        anim_time_secs: elapsed.as_secs_f32(),
    };
    mate::render(&samples, frame, &expr, &mods, out);
}

pub fn render(demo: DemoId, elapsed: Duration, uv: &[(f32, f32)], out: &mut [u8]) {
    demo.render_into(elapsed, uv, out);
}

pub fn demo_clip_summaries() -> Vec<crate::media::ClipSummary> {
    DemoId::all()
        .into_iter()
        .map(|d| crate::media::ClipSummary {
            id: d.clip_id(),
            kind: "demo".to_string(),
            frame_count: (d.loop_period().as_secs_f32() * d.fps() as f32).ceil() as u32,
            fps: d.fps(),
            width: crate::equirect::DEFAULT_WIDTH,
            height: crate::equirect::DEFAULT_HEIGHT,
            source_kind: None,
            source_width: 0,
            source_height: 0,
            created_at_unix_sec: 0,
            display_name: Some(d.display_name().to_string()),
            is_demo: Some(true),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mate_moods_is_parseable_and_periodic() {
        assert_eq!(DemoId::parse("demo/mate-moods"), Some(DemoId::MateMoods));
        assert!(
            mood_period_s() > 5.0,
            "period too short: {}",
            mood_period_s()
        );
    }

    #[test]
    fn mate_moods_keys_resolve_to_presets() {
        let reg = mood_registry();
        for k in mood_keys() {
            assert!(reg.get(k.id).is_some(), "missing preset: {}", k.id);
        }
    }

    #[test]
    fn mate_moods_renders_without_panic_across_period() {
        let uv = [(0.5, 0.5), (0.25, 0.5), (0.75, 0.5), (0.5, 0.25)];
        let mut out = vec![0u8; uv.len() * 3];
        let period = mood_period_s();
        for step in 0..40 {
            let t = period * (step as f32) / 40.0;
            render_mate_moods(&uv, Duration::from_secs_f32(t), &mut out);
            assert_eq!(out.len(), uv.len() * 3);
        }
    }

    #[test]
    fn rainbow_rings_is_parseable_with_positive_period() {
        assert_eq!(
            DemoId::parse("demo/rainbow-rings"),
            Some(DemoId::RainbowRings)
        );
        assert!(rainbow_rings_period_s() > RAINBOW_RINGS_SOLO_S);
    }

    #[test]
    fn rainbow_rings_blend_weight_boundaries() {
        let (first, last) = ring_active_window();
        let active = last - first;
        let solo = RAINBOW_RINGS_SOLO_S;
        let (bin, bout) = rainbow_rings_blends(active);
        // solo 相はリング無し（rainbow のみ）。
        assert_eq!(
            rainbow_rings_ring_weight(solo * 0.5, solo, active, bin, bout),
            0.0
        );
        // リング相の切り替え境界はちょうど 0（最初のリング出現・最後のリング消滅）。
        assert!(rainbow_rings_ring_weight(solo, solo, active, bin, bout).abs() < 1e-4);
        assert!(
            rainbow_rings_ring_weight(solo + active, solo, active, bin, bout).abs() < 1e-4,
            "last ring should vanish exactly at the switch back to rainbow"
        );
        // リング相中央は rings のみ（重み 1）。
        assert!(
            (rainbow_rings_ring_weight(solo + active * 0.5, solo, active, bin, bout) - 1.0).abs()
                < 1e-4
        );
    }

    #[test]
    fn rainbow_rings_renders_without_panic_across_period() {
        let uv = [(0.5, 0.5), (0.25, 0.5), (0.75, 0.5), (0.5, 0.25)];
        let mut out = vec![0u8; uv.len() * 3];
        let period = rainbow_rings_period_s();
        for step in 0..48 {
            let t = period * (step as f32) / 48.0;
            render_rainbow_rings(&uv, Duration::from_secs_f32(t), &mut out);
            assert_eq!(out.len(), uv.len() * 3);
        }
    }
}
