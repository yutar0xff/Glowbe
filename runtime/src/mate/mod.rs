//! Mate モード: 顔平面 SDF パーツを LED 球面に射影して描画する。
//! 設計: `docs/MATE.md`

use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use tracing::warn;

use crate::layouts;
use crate::media;
use crate::sphere::unit_dir_from_equirect_uv_y_up;

pub mod stamp_edt;
pub mod stamp_import;
mod stamps;

pub use stamp_import::{import_stamp_from_png, write_stamp_json};
use stamps::{StampMask, StampRegistry};

#[allow(dead_code)]
pub const MATE_LAYOUT_ID: &str = "geodesic-2v-60";
/// Minimum LEDs for mate face rendering (icosahedron-15 has 225).
pub const MATE_MIN_LED_COUNT: u16 = 225;
pub const DEFAULT_PRESET_ID: &str = "happy";
pub const DEFAULT_TRANSITION_MS: u32 = 480;

const BUILTIN_PRESETS: &[&str] = &[
    include_str!("presets/neutral.face.json"),
    include_str!("presets/happy.face.json"),
    include_str!("presets/sad.face.json"),
    include_str!("presets/angry.face.json"),
    include_str!("presets/surprised.face.json"),
    include_str!("presets/sleepy.face.json"),
    include_str!("presets/love.face.json"),
];

// --- Face frame ---

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceFrameParams {
    /// RH yaw about +Y (deg). 0 = face forward along +X.
    pub yaw_deg: f32,
    /// Elevation from equator toward +Y (deg).
    pub pitch_deg: f32,
    pub face_angular_radius_deg: f32,
}

impl Default for FaceFrameParams {
    fn default() -> Self {
        Self {
            yaw_deg: 0.0,
            pitch_deg: 28.0,
            face_angular_radius_deg: 70.0,
        }
    }
}

#[derive(Debug, Clone)]
pub struct FaceFrame {
    pub forward: [f32; 3],
    pub up: [f32; 3],
    pub right: [f32; 3],
    pub ang_radius_rad: f32,
    pub params: FaceFrameParams,
}

impl FaceFrame {
    pub fn from_params(params: FaceFrameParams) -> Self {
        let forward = crate::orientation::unit_dir_from_yaw_pitch_deg(params.yaw_deg, params.pitch_deg);
        let world_up = [0.0f32, 1.0, 0.0];
        let dot = world_up[0] * forward[0] + world_up[1] * forward[1] + world_up[2] * forward[2];
        let mut up = [
            world_up[0] - dot * forward[0],
            world_up[1] - dot * forward[1],
            world_up[2] - dot * forward[2],
        ];
        let up_len = (up[0] * up[0] + up[1] * up[1] + up[2] * up[2])
            .sqrt()
            .max(1e-6);
        up = [up[0] / up_len, up[1] / up_len, up[2] / up_len];
        let right = normalize3(cross3(up, forward));
        let up = normalize3(cross3(forward, right));
        Self {
            forward,
            up,
            right,
            ang_radius_rad: params.face_angular_radius_deg.to_radians(),
            params,
        }
    }

    pub fn cache_key(&self) -> u64 {
        let p = &self.params;
        let bits = [
            p.yaw_deg.to_bits() as u64,
            p.pitch_deg.to_bits() as u64,
            p.face_angular_radius_deg.to_bits() as u64,
        ];
        bits.iter().fold(0xcbf29ce484222325u64, |h, &b| {
            (h ^ b).wrapping_mul(0x100000001b3)
        })
    }
}

#[derive(Debug, Clone, Copy)]
pub struct FaceSample {
    pub x: f32,
    pub y: f32,
    /// LED faces the viewer (`fwd > 0`). Parts are evaluated when true.
    pub front: bool,
    /// LED lies inside the face disk (`fwd >= cos R`). Background is painted when true.
    pub in_face_disk: bool,
}

/// 各 LED の経度 `u` を `yaw_deg` だけ回してから顔平面へ射影する。
/// `yaw_deg` が 0 なら正面固定、非 0 なら顔全体を球の縦軸まわりに回した見え方になる
/// （遷移中のスピン演出に使用）。
pub fn build_face_samples_yawed(
    ledmap_uv: &[(f32, f32)],
    frame: &FaceFrame,
    yaw_deg: f32,
) -> Vec<FaceSample> {
    let sin_r = frame.ang_radius_rad.sin().max(1e-4);
    let cos_r = frame.ang_radius_rad.cos();
    ledmap_uv
        .iter()
        .map(|&(u, v)| {
            let u = crate::sphere::apply_front_yaw_u(u, yaw_deg);
            let d = unit_dir_from_equirect_uv_y_up(u, v);
            let fwd = dot3(d, frame.forward);
            if fwd <= 0.0 {
                return FaceSample {
                    x: 0.0,
                    y: 0.0,
                    front: false,
                    in_face_disk: false,
                };
            }
            let x = dot3(d, frame.right) / sin_r;
            let y = dot3(d, frame.up) / sin_r;
            FaceSample {
                x,
                y,
                front: true,
                in_face_disk: fwd >= cos_r,
            }
        })
        .collect()
}

pub fn layout_supported(compiled_dir: &Path, layout_id: &str) -> bool {
    layouts::read_led_count(compiled_dir, layout_id)
        .map(|n| n >= MATE_MIN_LED_COUNT)
        .unwrap_or(false)
}

// --- Preset / parts ---

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Layer {
    Background,
    Cheeks,
    Mouth,
    Eyes,
    Brows,
    Accessories,
}

impl Layer {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "background" => Some(Self::Background),
            "cheeks" => Some(Self::Cheeks),
            "mouth" => Some(Self::Mouth),
            "eyes" => Some(Self::Eyes),
            "brows" => Some(Self::Brows),
            "accessories" => Some(Self::Accessories),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub enum PartKind {
    Ellipse {
        pos: [f32; 2],
        size: [f32; 2],
        rotation_deg: f32,
    },
    Polyline {
        points: Vec<[f32; 2]>,
        thickness: f32,
    },
    Stamp {
        mask: StampMask,
        /// Output color per stamp palette slot, resolved from the preset.
        recolor: Vec<[u8; 3]>,
        pos: [f32; 2],
        half_size: [f32; 2],
        rotation_deg: f32,
    },
}

/// Per-frame transform contributed by declarative part motions.
#[derive(Debug, Clone, Copy, Default)]
pub struct MotionSample {
    pub dx: f32,
    pub dy: f32,
    pub d_rotation_deg: f32,
    pub alpha_mul: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PartMotion {
    FollowBreathing,
    Blink,
    RotateWobble {
        amplitude_deg: f32,
        period_ms: u32,
    },
    TearFall {
        travel: f32,
        period_ms: u32,
        phase_frac: f32,
        regen_frac: f32,
    },
}

#[derive(Debug, Clone)]
pub struct Part {
    pub slot: String,
    pub layer: Layer,
    pub kind: PartKind,
    /// During expression transitions, blend coverage toward this geometry.
    pub morph_to: Option<PartKind>,
    pub morph_t: f32,
    pub color: [u8; 3],
    pub intensity: f32,
    pub edge_softness: f32,
    pub motions: Vec<PartMotion>,
    /// 呼吸に合わせた明るさの脈動を掛けるか。`false` の場合、`followBreathing`
    /// による拡縮は残しつつ色（明るさ）は一定に保つ。
    pub breathe_brightness: bool,
}

#[derive(Debug, Clone)]
pub struct Expression {
    pub background: [u8; 3],
    pub parts: Vec<Part>,
    pub breathing_period_ms: u32,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatePresetSummary {
    pub id: String,
    pub display_name: String,
    pub part_count: usize,
    pub source: &'static str,
    pub breathing_period_ms: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FacePresetJson {
    format: String,
    version: u32,
    id: String,
    display_name: String,
    background: [u8; 3],
    #[serde(default = "default_breath_period_ms")]
    breathing_period_ms: u32,
    parts: Vec<FacePartJson>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FacePartJson {
    slot: String,
    layer: String,
    kind: String,
    color: [u8; 3],
    #[serde(default = "default_intensity")]
    intensity: f32,
    #[serde(default = "default_edge_softness")]
    edge_softness: f32,
    #[serde(default)]
    pos: Option<[f32; 2]>,
    #[serde(default)]
    size: Option<[f32; 2]>,
    #[serde(default)]
    rotation_deg: Option<f32>,
    #[serde(default)]
    points: Option<Vec<[f32; 2]>>,
    #[serde(default)]
    thickness: Option<f32>,
    #[serde(default)]
    asset: Option<String>,
    /// Optional recolor for stamp palette slots; defaults to `color` (single
    /// slot) or the stamp's own design colors.
    #[serde(default)]
    palette: Option<Vec<[u8; 3]>>,
    #[serde(default)]
    motions: Option<Vec<MotionJson>>,
    #[serde(default = "default_true")]
    breathe_brightness: bool,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum MotionJson {
    FollowBreathing,
    Blink,
    RotateWobble {
        #[serde(rename = "amplitudeDeg")]
        amplitude_deg: f32,
        #[serde(rename = "periodMs")]
        period_ms: u32,
    },
    TearFall {
        travel: f32,
        #[serde(rename = "periodMs")]
        period_ms: u32,
        #[serde(rename = "phaseFrac", default)]
        phase_frac: f32,
        #[serde(rename = "regenFrac", default = "default_tear_regen_frac")]
        regen_frac: f32,
    },
}

fn default_tear_regen_frac() -> f32 {
    0.25
}

fn default_true() -> bool {
    true
}

fn default_breath_period_ms() -> u32 {
    DEFAULT_BREATH_PERIOD_MS
}

fn default_intensity() -> f32 {
    1.0
}

fn default_edge_softness() -> f32 {
    0.06
}

pub struct PresetRegistry {
    expressions: HashMap<String, Expression>,
    summaries: Vec<MatePresetSummary>,
}

impl PresetRegistry {
    pub fn load(user_dir: &Path) -> Result<Self> {
        let stamps_dir = user_dir.join("stamps");
        let stamps = StampRegistry::load(&stamps_dir)?;
        let mut expressions = HashMap::new();
        let mut summaries = Vec::new();
        for raw in BUILTIN_PRESETS {
            if let Err(e) =
                Self::insert_preset(&stamps, &mut expressions, &mut summaries, raw, "builtin")
            {
                warn!("skip builtin mate preset: {e:#}");
            }
        }
        if user_dir.is_dir() {
            for entry in std::fs::read_dir(user_dir)
                .with_context(|| format!("read mate dir {}", user_dir.display()))?
            {
                let entry = entry?;
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
                if !name.ends_with(".face.json") {
                    continue;
                }
                let raw = std::fs::read_to_string(&path)
                    .with_context(|| format!("read mate preset {}", path.display()))?;
                if let Err(e) =
                    Self::insert_preset(&stamps, &mut expressions, &mut summaries, &raw, "user")
                {
                    warn!("skip mate preset {}: {e:#}", path.display());
                }
            }
        }
        summaries.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(Self {
            expressions,
            summaries,
        })
    }

    fn insert_preset(
        stamps: &StampRegistry,
        expressions: &mut HashMap<String, Expression>,
        summaries: &mut Vec<MatePresetSummary>,
        raw: &str,
        source: &'static str,
    ) -> Result<()> {
        let preset: FacePresetJson = serde_json::from_str(raw).context("parse mate preset")?;
        if preset.format != "glowbe-mate-face" || preset.version != 1 {
            bail!("unsupported preset format");
        }
        if preset.id.is_empty() || preset.id.contains('/') || preset.id.contains('\\') {
            bail!("preset id must be non-empty and path-safe");
        }
        let expr = resolve_preset(&preset, stamps)?;
        let summary = MatePresetSummary {
            id: preset.id.clone(),
            display_name: preset.display_name,
            part_count: expr.parts.len(),
            source,
            breathing_period_ms: expr.breathing_period_ms,
        };
        expressions.insert(preset.id.clone(), expr);
        summaries.retain(|s| s.id != preset.id);
        summaries.push(summary);
        Ok(())
    }

    pub fn summaries(&self) -> &[MatePresetSummary] {
        &self.summaries
    }

    pub fn get(&self, id: &str) -> Option<&Expression> {
        self.expressions.get(id)
    }
}

#[derive(Clone)]
pub struct MateTransition {
    pub from: Expression,
    pub to: Expression,
    pub started: Instant,
    pub duration: Duration,
    /// 遷移中に顔全体を球面上で 1 回転させるか。
    pub rotate: bool,
}

impl MateTransition {
    pub fn expr_at(&self, now: Instant) -> Expression {
        if self.duration.is_zero() {
            return self.to.clone();
        }
        let elapsed = now.saturating_duration_since(self.started);
        if elapsed >= self.duration {
            return self.to.clone();
        }
        let t = ease_in_out_cubic(elapsed.as_secs_f32() / self.duration.as_secs_f32());
        lerp_expression(&self.from, &self.to, t)
    }

    /// 遷移進捗に応じた顔のヨー角（度）。`rotate` 有効時のみ 0→360° を返す。
    /// `easeInOutBack` により序盤で少し巻き戻し、終盤は 360° を少し越えてから
    /// 戻る。完了時は 360°≡0° に収まるため継ぎ目なく元の正面へ戻る。
    pub fn yaw_deg_at(&self, now: Instant) -> f32 {
        if !self.rotate || self.duration.is_zero() {
            return 0.0;
        }
        let elapsed = now.saturating_duration_since(self.started);
        if elapsed >= self.duration {
            return 0.0;
        }
        let t = elapsed.as_secs_f32() / self.duration.as_secs_f32();
        360.0 * ease_in_out_back(t)
    }

    pub fn is_complete(&self, now: Instant) -> bool {
        !self.duration.is_zero() && now.saturating_duration_since(self.started) >= self.duration
    }
}

pub fn ease_in_out_cubic(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    if t < 0.5 {
        4.0 * t * t * t
    } else {
        1.0 - (-2.0 * t + 2.0).powi(3) / 2.0
    }
}

/// 行き過ぎ（オーバーシュート）を伴うイージング。端点は 0/1 だが、序盤は少し
/// 手前へ、終盤は目標を少し越えてから戻る。回転演出の「巻き戻して回り、
/// 行き過ぎて収まる」動きに使う。
pub fn ease_in_out_back(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    const C1: f32 = 1.70158;
    const C2: f32 = C1 * 1.525;
    if t < 0.5 {
        let x = 2.0 * t;
        (x * x * ((C2 + 1.0) * x - C2)) / 2.0
    } else {
        let x = 2.0 * t - 2.0;
        (x * x * ((C2 + 1.0) * x + C2) + 2.0) / 2.0
    }
}

pub fn lerp_expression(from: &Expression, to: &Expression, t: f32) -> Expression {
    let t = t.clamp(0.0, 1.0);
    let background = lerp_rgb(from.background, to.background, t);
    let mut slots = BTreeSet::new();
    for p in &from.parts {
        slots.insert(p.slot.as_str());
    }
    for p in &to.parts {
        slots.insert(p.slot.as_str());
    }
    let from_map: HashMap<&str, &Part> = from.parts.iter().map(|p| (p.slot.as_str(), p)).collect();
    let to_map: HashMap<&str, &Part> = to.parts.iter().map(|p| (p.slot.as_str(), p)).collect();
    let mut parts = Vec::new();
    for slot in slots {
        match (from_map.get(slot), to_map.get(slot)) {
            (Some(a), Some(b)) => parts.extend(lerp_slot_parts(a, b, t)),
            (Some(a), None) => parts.push(fade_part(a, 1.0 - t)),
            (None, Some(b)) => parts.push(fade_part(b, t)),
            (None, None) => {}
        }
    }
    parts.sort_by_key(|p| p.layer);
    let breathing_period_ms = lerp_f32(
        from.breathing_period_ms as f32,
        to.breathing_period_ms as f32,
        t,
    )
    .round()
    .clamp(500.0, 30_000.0) as u32;
    Expression {
        background,
        parts,
        breathing_period_ms,
    }
}

fn lerp_slot_parts(from: &Part, to: &Part, t: f32) -> Vec<Part> {
    vec![lerp_part(from, to, t)]
}

fn lerp_part(from: &Part, to: &Part, t: f32) -> Part {
    let mut part = Part {
        slot: from.slot.clone(),
        layer: if t < 0.5 { from.layer } else { to.layer },
        kind: from.kind.clone(),
        morph_to: None,
        morph_t: 0.0,
        color: lerp_rgb(from.color, to.color, t),
        intensity: lerp_f32(from.intensity, to.intensity, t),
        edge_softness: lerp_f32(from.edge_softness, to.edge_softness, t),
        breathe_brightness: if t < 0.5 {
            from.breathe_brightness
        } else {
            to.breathe_brightness
        },
        motions: if t < 0.5 {
            from.motions.clone()
        } else {
            to.motions.clone()
        },
    };

    if std::mem::discriminant(&from.kind) != std::mem::discriminant(&to.kind) {
        part.morph_to = Some(to.kind.clone());
        part.morph_t = t;
        return part;
    }

    match (&from.kind, &to.kind) {
        (
            PartKind::Polyline {
                points: pts0,
                thickness: _,
            },
            PartKind::Polyline {
                points: pts1,
                thickness: _,
            },
        ) if pts0.len() != pts1.len() => {
            part.morph_to = Some(to.kind.clone());
            part.morph_t = t;
        }
        (PartKind::Stamp { mask: m0, .. }, PartKind::Stamp { mask: m1, .. }) if m0.id != m1.id => {
            part.morph_to = Some(to.kind.clone());
            part.morph_t = t;
        }
        _ => {
            part.kind = lerp_part_kind(&from.kind, &to.kind, t);
        }
    }
    part
}

fn fade_part(part: &Part, factor: f32) -> Part {
    let mut p = part.clone();
    p.intensity *= factor.clamp(0.0, 1.0);
    p.morph_to = None;
    p.morph_t = 0.0;
    p
}

fn lerp_part_kind(from: &PartKind, to: &PartKind, t: f32) -> PartKind {
    match (from, to) {
        (
            PartKind::Ellipse {
                pos: p0,
                size: s0,
                rotation_deg: r0,
            },
            PartKind::Ellipse {
                pos: p1,
                size: s1,
                rotation_deg: r1,
            },
        ) => PartKind::Ellipse {
            pos: lerp2(*p0, *p1, t),
            size: lerp2(*s0, *s1, t),
            rotation_deg: lerp_f32(*r0, *r1, t),
        },
        (
            PartKind::Polyline {
                points: pts0,
                thickness: th0,
            },
            PartKind::Polyline {
                points: pts1,
                thickness: th1,
            },
        ) => {
            let points = pts0
                .iter()
                .zip(pts1.iter())
                .map(|(a, b)| lerp2(*a, *b, t))
                .collect();
            PartKind::Polyline {
                points,
                thickness: lerp_f32(*th0, *th1, t),
            }
        }
        (
            PartKind::Stamp {
                mask: m0,
                recolor: rc0,
                pos: p0,
                half_size: s0,
                rotation_deg: r0,
            },
            PartKind::Stamp {
                pos: p1,
                half_size: s1,
                rotation_deg: r1,
                ..
            },
        ) => PartKind::Stamp {
            mask: m0.clone(),
            recolor: rc0.clone(),
            pos: lerp2(*p0, *p1, t),
            half_size: lerp2(*s0, *s1, t),
            rotation_deg: lerp_f32(*r0, *r1, t),
        },
        _ => from.clone(),
    }
}

#[inline]
fn lerp_f32(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

#[inline]
fn lerp2(a: [f32; 2], b: [f32; 2], t: f32) -> [f32; 2] {
    [lerp_f32(a[0], b[0], t), lerp_f32(a[1], b[1], t)]
}

#[inline]
fn lerp_rgb(a: [u8; 3], b: [u8; 3], t: f32) -> [u8; 3] {
    [
        lerp_f32(a[0] as f32, b[0] as f32, t)
            .round()
            .clamp(0.0, 255.0) as u8,
        lerp_f32(a[1] as f32, b[1] as f32, t)
            .round()
            .clamp(0.0, 255.0) as u8,
        lerp_f32(a[2] as f32, b[2] as f32, t)
            .round()
            .clamp(0.0, 255.0) as u8,
    ]
}

/// Map a stamp's design palette to output colors.
///
/// Priority: explicit preset `palette` (index-matched, missing slots keep the
/// stamp's own color) → single-color stamps recolored to `color` → the stamp's
/// embedded design colors.
fn resolve_recolor(
    mask: &StampMask,
    preset_palette: Option<&[[u8; 3]]>,
    color: [u8; 3],
) -> Vec<[u8; 3]> {
    let source = mask.palette();
    if let Some(palette) = preset_palette {
        return (0..source.len())
            .map(|i| palette.get(i).copied().unwrap_or(source[i]))
            .collect();
    }
    if source.len() == 1 {
        return vec![color];
    }
    source.to_vec()
}

fn parse_motions(raw: &[MotionJson]) -> Result<Vec<PartMotion>> {
    raw.iter().map(parse_motion).collect()
}

fn parse_motion(raw: &MotionJson) -> Result<PartMotion> {
    Ok(match raw {
        MotionJson::FollowBreathing => PartMotion::FollowBreathing,
        MotionJson::Blink => PartMotion::Blink,
        MotionJson::RotateWobble {
            amplitude_deg,
            period_ms,
        } => PartMotion::RotateWobble {
            amplitude_deg: amplitude_deg.max(0.0),
            period_ms: (*period_ms).max(1),
        },
        MotionJson::TearFall {
            travel,
            period_ms,
            phase_frac,
            regen_frac,
        } => PartMotion::TearFall {
            travel: travel.max(0.0),
            period_ms: (*period_ms).max(1),
            phase_frac: phase_frac.rem_euclid(1.0),
            regen_frac: regen_frac.clamp(0.01, 0.99),
        },
    })
}

fn default_motions_for_part(layer: Layer, kind: &str) -> Vec<PartMotion> {
    let mut motions = vec![PartMotion::FollowBreathing];
    if layer == Layer::Eyes && kind == "ellipse" {
        motions.push(PartMotion::Blink);
    }
    motions
}

fn resolve_motions(p: &FacePartJson, layer: Layer) -> Result<Vec<PartMotion>> {
    match &p.motions {
        Some(list) if !list.is_empty() => parse_motions(list),
        _ => Ok(default_motions_for_part(layer, p.kind.as_str())),
    }
}

fn part_follows_breathing(part: &Part) -> bool {
    part.motions
        .iter()
        .any(|m| matches!(m, PartMotion::FollowBreathing))
}

fn part_blinks(part: &Part) -> bool {
    part.motions.iter().any(|m| matches!(m, PartMotion::Blink))
}

fn resolve_preset(preset: &FacePresetJson, stamps: &StampRegistry) -> Result<Expression> {
    let mut parts = Vec::with_capacity(preset.parts.len());
    for p in &preset.parts {
        let layer =
            Layer::parse(p.layer.as_str()).with_context(|| format!("unknown layer {}", p.layer))?;
        let kind = match p.kind.as_str() {
            "ellipse" => {
                let pos = p.pos.context("ellipse requires pos")?;
                let size = p.size.context("ellipse requires size")?;
                PartKind::Ellipse {
                    pos,
                    size,
                    rotation_deg: p.rotation_deg.unwrap_or(0.0),
                }
            }
            "polyline" => {
                let points = p.points.clone().context("polyline requires points")?;
                if points.len() < 2 {
                    bail!("polyline needs at least 2 points");
                }
                PartKind::Polyline {
                    points,
                    thickness: p.thickness.unwrap_or(0.08),
                }
            }
            "stamp" => {
                let asset = p.asset.as_deref().context("stamp requires asset")?;
                let mask = stamps
                    .get(asset)
                    .with_context(|| format!("unknown stamp asset: {asset}"))?
                    .clone();
                let pos = p.pos.context("stamp requires pos")?;
                let half_size = p.size.context("stamp requires size")?;
                let recolor = resolve_recolor(&mask, p.palette.as_deref(), p.color);
                PartKind::Stamp {
                    mask,
                    recolor,
                    pos,
                    half_size,
                    rotation_deg: p.rotation_deg.unwrap_or(0.0),
                }
            }
            other => bail!("unsupported part kind: {other}"),
        };
        parts.push(Part {
            slot: p.slot.clone(),
            layer,
            kind,
            morph_to: None,
            morph_t: 0.0,
            color: p.color,
            intensity: p.intensity.clamp(0.0, 1.0),
            edge_softness: p.edge_softness.clamp(0.01, 0.25),
            motions: resolve_motions(p, layer)?,
            breathe_brightness: p.breathe_brightness,
        });
    }
    parts.sort_by_key(|p| p.layer);
    let breathing_period_ms = preset.breathing_period_ms.clamp(500, 30_000);
    Ok(Expression {
        background: preset.background,
        parts,
        breathing_period_ms,
    })
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BreathingParams {
    pub enabled: bool,
}

pub const DEFAULT_BREATH_PERIOD_MS: u32 = 4200;
/// Fixed breathing strength for brightness, scale, and vertical bob.
const BREATH_INTENSITY: f32 = 0.06;
const BREATH_BRIGHTNESS_GAIN: f32 = 2.4;
const BREATH_FACE_SCALE_GAIN: f32 = 0.72;
const BREATH_SHIFT_GAIN: f32 = 0.55;
/// Exhale uses a slightly softer dim so inhale reads as a lift.
const BREATH_EXHALE_BRIGHTNESS_FACTOR: f32 = 0.75;
const BLINK_DURATION_MS: u64 = 120;
const BLINK_MIN_INTERVAL_MS: u64 = 2500;
const BLINK_MAX_INTERVAL_MS: u64 = 6000;

impl Default for BreathingParams {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl BreathingParams {
    /// Perceptual breathing envelope for the current frame.
    ///
    /// `phase` は積分済みの呼吸位相 (ラジアン)。周期が表情遷移中に変わっても、
    /// 呼び出し側が位相を毎フレーム積分することで連続性が保たれる。
    pub fn sample_wave(&self, phase: f32) -> BreathingWave {
        if !self.enabled {
            return BreathingWave::neutral();
        }
        let s = phase.sin();
        let i = BREATH_INTENSITY;
        let brightness_gain = if s >= 0.0 {
            1.0 + s * i * BREATH_BRIGHTNESS_GAIN
        } else {
            1.0 + s * i * BREATH_BRIGHTNESS_GAIN * BREATH_EXHALE_BRIGHTNESS_FACTOR
        };
        let face_scale = 1.0 + s * i * BREATH_FACE_SCALE_GAIN;
        let face_offset_y = s * i * BREATH_SHIFT_GAIN;
        BreathingWave {
            brightness_gain,
            face_scale,
            face_offset_y,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct BreathingWave {
    pub brightness_gain: f32,
    pub face_scale: f32,
    /// +y lifts the face on inhale (face-plane units).
    pub face_offset_y: f32,
}

impl BreathingWave {
    pub fn neutral() -> Self {
        Self {
            brightness_gain: 1.0,
            face_scale: 1.0,
            face_offset_y: 0.0,
        }
    }
}

struct BlinkAnim {
    started: Instant,
    duration: Duration,
}

pub struct BlinkState {
    next_blink_at: Instant,
    active: Option<BlinkAnim>,
    queue_double: bool,
    tick_seed: u64,
}

impl BlinkState {
    pub fn new(now: Instant) -> Self {
        let tick_seed = seed_from_instant(now);
        let delay = random_blink_delay_ms(tick_seed);
        Self {
            next_blink_at: now + Duration::from_millis(delay),
            active: None,
            queue_double: false,
            tick_seed,
        }
    }

    pub fn trigger(&mut self, now: Instant) {
        self.active = Some(BlinkAnim {
            started: now,
            duration: Duration::from_millis(BLINK_DURATION_MS),
        });
        self.queue_double = false;
    }

    pub fn tick(&mut self, now: Instant) {
        if let Some(ref anim) = self.active {
            if now.saturating_duration_since(anim.started) < anim.duration {
                return;
            }
            self.active = None;
            self.tick_seed = self.tick_seed.wrapping_add(1);
            if self.queue_double {
                self.queue_double = false;
                self.next_blink_at = now + Duration::from_millis(160);
            } else if pseudo_rand01(self.tick_seed) < 0.22 {
                self.queue_double = true;
                self.next_blink_at = now + Duration::from_millis(160);
            } else {
                self.schedule_next(now);
            }
            return;
        }
        if now >= self.next_blink_at {
            self.active = Some(BlinkAnim {
                started: now,
                duration: Duration::from_millis(BLINK_DURATION_MS),
            });
        }
    }

    fn schedule_next(&mut self, now: Instant) {
        self.tick_seed = self.tick_seed.wrapping_add(seed_from_instant(now));
        let delay = random_blink_delay_ms(self.tick_seed);
        self.next_blink_at = now + Duration::from_millis(delay);
    }

    pub fn openness(&self, now: Instant) -> f32 {
        let Some(ref anim) = self.active else {
            return 1.0;
        };
        let dur = anim.duration.as_secs_f32().max(1e-4);
        let t = now.saturating_duration_since(anim.started).as_secs_f32() / dur;
        if t < 0.5 {
            1.0 - ease_in_out_cubic(t * 2.0)
        } else {
            ease_in_out_cubic((t - 0.5) * 2.0)
        }
    }
}

pub fn compute_modulation(
    now: Instant,
    origin: Instant,
    breathing: &BreathingParams,
    breath_phase: f32,
    blink: &mut BlinkState,
) -> Modulation {
    blink.tick(now);
    let wave = breathing.sample_wave(breath_phase);
    Modulation {
        breathe_brightness: wave.brightness_gain,
        breathe_face_scale: wave.face_scale,
        breathe_face_offset_y: wave.face_offset_y,
        blink_openness: blink.openness(now),
        anim_time_secs: now.saturating_duration_since(origin).as_secs_f32(),
    }
}

fn random_blink_delay_ms(seed: u64) -> u64 {
    let r = pseudo_rand01(seed);
    let span = (BLINK_MAX_INTERVAL_MS - BLINK_MIN_INTERVAL_MS) as f32;
    BLINK_MIN_INTERVAL_MS + (r * span) as u64
}

fn pseudo_rand01(seed: u64) -> f32 {
    let x = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
    ((x >> 33) as f32) / (1u64 << 31) as f32
}

fn seed_from_instant(now: Instant) -> u64 {
    now.elapsed().as_nanos() as u64
}

#[derive(Debug, Clone, Copy)]
pub struct Modulation {
    /// Linear RGB multiplier for face parts (`breathe:true`), not coverage.
    pub breathe_brightness: f32,
    /// Radial expansion around face origin in the face plane (1 = neutral).
    pub breathe_face_scale: f32,
    /// Vertical shift in face plane (+y = up on inhale).
    pub breathe_face_offset_y: f32,
    pub blink_openness: f32,
    /// Elapsed animation time since the device mate origin (seconds).
    pub anim_time_secs: f32,
}

impl Default for Modulation {
    fn default() -> Self {
        Self {
            breathe_brightness: 1.0,
            breathe_face_scale: 1.0,
            breathe_face_offset_y: 0.0,
            blink_openness: 1.0,
            anim_time_secs: 0.0,
        }
    }
}

pub fn render(
    samples: &[FaceSample],
    frame: &FaceFrame,
    expr: &Expression,
    mods: &Modulation,
    out_rgb: &mut [u8],
) {
    debug_assert_eq!(samples.len() * 3, out_rgb.len());

    for (i, sample) in samples.iter().enumerate() {
        if !sample.front {
            let o = i * 3;
            out_rgb[o] = 0;
            out_rgb[o + 1] = 0;
            out_rgb[o + 2] = 0;
            continue;
        }
        let bg_mask = if sample.in_face_disk { 1.0 } else { 0.0 };
        let bg = expr.background;
        let mut acc = [
            crate::output::srgb_byte_to_linear(bg[0]) * bg_mask,
            crate::output::srgb_byte_to_linear(bg[1]) * bg_mask,
            crate::output::srgb_byte_to_linear(bg[2]) * bg_mask,
        ];

        for part in &expr.parts {
            let face_scale = if part_follows_breathing(part) {
                mods.breathe_face_scale.max(0.5)
            } else {
                1.0
            };
            let face_offset_y = if part_follows_breathing(part) {
                mods.breathe_face_offset_y
            } else {
                0.0
            };
            let brightness_gain = if part_follows_breathing(part) && part.breathe_brightness {
                mods.breathe_brightness.max(0.0)
            } else {
                1.0
            };
            let blink_o = if part_blinks(part) {
                mods.blink_openness.clamp(0.04, 1.0)
            } else {
                1.0
            };
            let motion = part_motion_sample(part, mods.anim_time_secs);
            let (mut fx, mut fy) =
                face_coords_with_breath(sample.x, sample.y, face_scale, face_offset_y);
            fx -= motion.dx;
            fy -= motion.dy;
            let Some((cov0, col)) =
                part_sample(fx, fy, part, blink_o, frame, motion.d_rotation_deg)
            else {
                continue;
            };
            let cov = cov0 * part.intensity * motion.alpha_mul;
            if cov <= 1e-5 {
                continue;
            }
            acc[0] += cov * col[0] * brightness_gain;
            acc[1] += cov * col[1] * brightness_gain;
            acc[2] += cov * col[2] * brightness_gain;
        }

        let m = acc[0].max(acc[1]).max(acc[2]);
        if m > 1.0 {
            let s = 1.0 / m;
            acc[0] *= s;
            acc[1] *= s;
            acc[2] *= s;
        }
        let o = i * 3;
        out_rgb[o] = crate::output::linear_to_srgb_u8(acc[0]);
        out_rgb[o + 1] = crate::output::linear_to_srgb_u8(acc[1]);
        out_rgb[o + 2] = crate::output::linear_to_srgb_u8(acc[2]);
    }
}

/// Inverse-scale and vertically shift sample coords for breathing motion.
fn face_coords_with_breath(x: f32, y: f32, face_scale: f32, offset_y: f32) -> (f32, f32) {
    let (x, y) = if (face_scale - 1.0).abs() < 1e-6 {
        (x, y)
    } else {
        (x / face_scale, y / face_scale)
    };
    (x, y - offset_y)
}

fn part_motion_sample(part: &Part, anim_time_secs: f32) -> MotionSample {
    let mut sample = MotionSample {
        dx: 0.0,
        dy: 0.0,
        d_rotation_deg: 0.0,
        alpha_mul: 1.0,
    };
    for motion in &part.motions {
        match motion {
            PartMotion::FollowBreathing | PartMotion::Blink => {}
            PartMotion::RotateWobble {
                amplitude_deg,
                period_ms,
            } => {
                let period = (*period_ms).max(1) as f32 / 1000.0;
                sample.d_rotation_deg +=
                    (anim_time_secs / period * std::f32::consts::TAU).sin() * amplitude_deg;
            }
            PartMotion::TearFall {
                travel,
                period_ms,
                phase_frac,
                regen_frac,
            } => {
                let period = (*period_ms).max(1) as f32 / 1000.0;
                let phase = (anim_time_secs / period + phase_frac).rem_euclid(1.0);
                sample.dy += -travel * phase;
                if phase > 1.0 - regen_frac {
                    sample.alpha_mul *= ((1.0 - phase) / regen_frac).clamp(0.0, 1.0);
                }
            }
        }
    }
    sample
}

/// Coverage plus linear output color for a part at a face-space point.
///
/// Stamps return their per-pixel recolored palette entry; other kinds return
/// their flat part color modulated by coverage.
fn part_sample(
    fx: f32,
    fy: f32,
    part: &Part,
    blink_openness: f32,
    frame: &FaceFrame,
    extra_rotation_deg: f32,
) -> Option<(f32, [f32; 3])> {
    if part.morph_to.is_none() {
        if let PartKind::Stamp {
            mask,
            recolor,
            pos,
            half_size,
            rotation_deg,
        } = &part.kind
        {
            let (lx, ly, half) = stamp_tangent_xy(
                fx,
                fy,
                pos,
                half_size,
                rotation_deg + extra_rotation_deg,
                frame,
            );
            let idx = mask.sample_index(lx, ly, half)?;
            let rgb = recolor.get(idx).copied().unwrap_or(part.color);
            return Some((1.0, linear_rgb(rgb)));
        }
    }
    let cov = part_coverage(fx, fy, part, blink_openness, frame, extra_rotation_deg);
    if cov <= 0.0 {
        return None;
    }
    Some((cov, linear_rgb(part.color)))
}

#[inline]
fn linear_rgb(c: [u8; 3]) -> [f32; 3] {
    [
        crate::output::srgb_byte_to_linear(c[0]),
        crate::output::srgb_byte_to_linear(c[1]),
        crate::output::srgb_byte_to_linear(c[2]),
    ]
}

fn part_coverage(
    fx: f32,
    fy: f32,
    part: &Part,
    blink_openness: f32,
    frame: &FaceFrame,
    extra_rotation_deg: f32,
) -> f32 {
    if part.morph_to.is_none() {
        if let PartKind::Stamp {
            mask,
            pos,
            half_size,
            rotation_deg,
            ..
        } = &part.kind
        {
            let (lx, ly, half) = stamp_tangent_xy(
                fx,
                fy,
                pos,
                half_size,
                rotation_deg + extra_rotation_deg,
                frame,
            );
            return mask.coverage_angular(lx, ly, half);
        }
    }

    let blink = part_blinks(part);
    let sdf = if let Some(ref to_kind) = part.morph_to {
        let s0 = kind_sdf(
            fx,
            fy,
            &part.kind,
            blink,
            blink_openness,
            frame,
            extra_rotation_deg,
        );
        let s1 = kind_sdf(
            fx,
            fy,
            to_kind,
            blink,
            blink_openness,
            frame,
            extra_rotation_deg,
        );
        let t = part.morph_t.clamp(0.0, 1.0);
        (1.0 - t) * s0 + t * s1
    } else {
        kind_sdf(
            fx,
            fy,
            &part.kind,
            blink,
            blink_openness,
            frame,
            extra_rotation_deg,
        )
    };
    coverage_from_sdf(sdf, part.edge_softness)
}

fn stamp_tangent_xy(
    fx: f32,
    fy: f32,
    pos: &[f32; 2],
    half_size: &[f32; 2],
    rotation_deg: f32,
    frame: &FaceFrame,
) -> (f32, f32, f32) {
    let half = half_size[0].min(half_size[1]).max(1e-4);
    let d0 = face_dir_from_xy(pos[0], pos[1], frame);
    let d = face_dir_from_xy(fx, fy, frame);
    let (tx, ty) = sphere_log_map(d0, d, frame.up);
    let mut lx = tx;
    let mut ly = ty;
    if rotation_deg.abs() > 1e-4 {
        let r = (-rotation_deg).to_radians();
        let c = r.cos();
        let s = r.sin();
        lx = c * tx - s * ty;
        ly = s * tx + c * ty;
    }
    (lx, ly, half)
}

fn blink_eye_radii(size: [f32; 2], openness: f32) -> [f32; 2] {
    let o = openness.clamp(0.04, 1.0);
    const WIDTH_AT_CLOSED: f32 = 0.3;
    [
        size[0] * (WIDTH_AT_CLOSED + (1.0 - WIDTH_AT_CLOSED) * o),
        size[1] * o,
    ]
}

fn kind_sdf(
    fx: f32,
    fy: f32,
    kind: &PartKind,
    blink: bool,
    blink_openness: f32,
    frame: &FaceFrame,
    extra_rotation_deg: f32,
) -> f32 {
    match kind {
        PartKind::Stamp {
            mask,
            pos,
            half_size,
            rotation_deg,
            ..
        } => {
            let (lx, ly, half) = stamp_tangent_xy(
                fx,
                fy,
                pos,
                half_size,
                rotation_deg + extra_rotation_deg,
                frame,
            );
            mask.sdf_angular(lx, ly, half)
        }
        PartKind::Ellipse {
            pos,
            size,
            rotation_deg,
        } => {
            let size = if blink {
                blink_eye_radii(*size, blink_openness)
            } else {
                *size
            };
            sdf_ellipse([fx, fy], *pos, size, *rotation_deg + extra_rotation_deg)
        }
        PartKind::Polyline { points, thickness } => sdf_polyline([fx, fy], points, *thickness),
    }
}

fn sdf_ellipse(p: [f32; 2], center: [f32; 2], radii: [f32; 2], rot_deg: f32) -> f32 {
    let mut q = [p[0] - center[0], p[1] - center[1]];
    if rot_deg.abs() > 1e-4 {
        let r = (-rot_deg).to_radians();
        let c = r.cos();
        let s = r.sin();
        q = [c * q[0] - s * q[1], s * q[0] + c * q[1]];
    }
    let rx = radii[0].max(1e-4);
    let ry = radii[1].max(1e-4);
    q[0] /= rx;
    q[1] /= ry;
    let len = (q[0] * q[0] + q[1] * q[1]).sqrt();
    (len - 1.0) * rx.min(ry)
}

fn sdf_polyline(p: [f32; 2], points: &[[f32; 2]], thickness: f32) -> f32 {
    let mut min_d = f32::MAX;
    for w in points.windows(2) {
        let d = dist_to_segment(p, w[0], w[1]);
        min_d = min_d.min(d);
    }
    min_d - thickness * 0.5
}

fn dist_to_segment(p: [f32; 2], a: [f32; 2], b: [f32; 2]) -> f32 {
    let ab = [b[0] - a[0], b[1] - a[1]];
    let ap = [p[0] - a[0], p[1] - a[1]];
    let ab2 = ab[0] * ab[0] + ab[1] * ab[1];
    if ab2 < 1e-10 {
        return (ap[0] * ap[0] + ap[1] * ap[1]).sqrt();
    }
    let t = ((ap[0] * ab[0] + ap[1] * ab[1]) / ab2).clamp(0.0, 1.0);
    let q = [a[0] + ab[0] * t, a[1] + ab[1] * t];
    let dx = p[0] - q[0];
    let dy = p[1] - q[1];
    (dx * dx + dy * dy).sqrt()
}

fn coverage_from_sdf(sdf: f32, softness: f32) -> f32 {
    smoothstep(softness, -softness, sdf)
}

#[inline]
fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    if (edge1 - edge0).abs() < 1e-8 {
        return if x >= edge1 { 1.0 } else { 0.0 };
    }
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[inline]
fn dot3(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

#[inline]
fn cross3(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

#[inline]
fn normalize3(v: [f32; 3]) -> [f32; 3] {
    let n = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt().max(1e-6);
    [v[0] / n, v[1] / n, v[2] / n]
}

pub fn face_dir_from_xy(fx: f32, fy: f32, frame: &FaceFrame) -> [f32; 3] {
    let sin_r = frame.ang_radius_rad.sin().max(1e-6);
    let a = fx * sin_r;
    let b = fy * sin_r;
    let fwd = (1.0 - a * a - b * b).max(0.0).sqrt();
    normalize3([
        fwd * frame.forward[0] + a * frame.right[0] + b * frame.up[0],
        fwd * frame.forward[1] + a * frame.right[1] + b * frame.up[1],
        fwd * frame.forward[2] + a * frame.right[2] + b * frame.up[2],
    ])
}

/// Geodesic normal coordinates (inverse exponential map / "log map") of `d`
/// in the tangent plane at `d0`, expressed in radians.
///
/// A local orthonormal tangent basis is built at `d0` (aligned to the face's
/// right/up as seen from that point). Returning true geodesic arc length along
/// each local axis makes the mapping isotropic — a circle on the sphere maps to
/// a circle in `(tx, ty)` regardless of how far `d0` is from the face center.
/// Projecting onto the global right/up basis (as a flat tangent plane at the
/// face center) instead introduces foreshortening that stretches stamps.
fn sphere_log_map(d0: [f32; 3], d: [f32; 3], face_up: [f32; 3]) -> (f32, f32) {
    let up_dot = dot3(face_up, d0);
    let e_v = normalize3([
        face_up[0] - up_dot * d0[0],
        face_up[1] - up_dot * d0[1],
        face_up[2] - up_dot * d0[2],
    ]);
    let e_u = normalize3(cross3(e_v, d0));
    let dot0 = dot3(d, d0).clamp(-1.0, 1.0);
    let ang = dot0.acos();
    let t = [
        d[0] - dot0 * d0[0],
        d[1] - dot0 * d0[1],
        d[2] - dot0 * d0[2],
    ];
    let t_len = (t[0] * t[0] + t[1] * t[1] + t[2] * t[2]).sqrt();
    if t_len < 1e-9 {
        return (0.0, 0.0);
    }
    let scale = ang / t_len;
    (dot3(t, e_u) * scale, dot3(t, e_v) * scale)
}

pub struct MateSamplesCache {
    pub layout_id: String,
    pub frame_key: u64,
    pub front_yaw_bits: u32,
    pub front_yaw_deg: f32,
    pub frame: FaceFrame,
    /// 正面ヨーのみ適用済みの LED 経度緯度（回転演出時に追加ヨーを重ねる元データ）。
    pub uv: Vec<(f32, f32)>,
    pub samples: Vec<FaceSample>,
}

/// レイアウトの LED を `(u, v)` 表に読み出す（正面ヨー未適用の生値）。
pub fn load_layout_uv_table(
    compiled_dir: &std::path::Path,
    layout_id: &str,
) -> Result<Vec<(f32, f32)>> {
    let layout = media::load_layout_uv(compiled_dir, layout_id)?;
    let mut uv = vec![(0.5f32, 0.5f32); layout.led_count];
    for p in layout.leds {
        if p.i < uv.len() {
            uv[p.i] = (p.u, p.v);
        }
    }
    Ok(uv)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media;

    fn product_uv_table() -> Vec<(f32, f32)> {
        let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let compiled = repo.join("assets/compiled");
        let layout = media::load_layout_uv(&compiled, MATE_LAYOUT_ID).expect("product ledmap");
        let mut uv = vec![(0.5f32, 0.5f32); layout.led_count];
        for p in layout.leds {
            if p.i < uv.len() {
                uv[p.i] = (p.u, p.v);
            }
        }
        uv
    }

    fn test_registry() -> PresetRegistry {
        PresetRegistry::load(Path::new("/nonexistent")).unwrap()
    }

    fn empty_expr() -> Expression {
        Expression {
            background: [0, 0, 0],
            parts: Vec::new(),
            breathing_period_ms: DEFAULT_BREATH_PERIOD_MS,
        }
    }

    #[test]
    fn transition_yaw_spins_one_turn_when_enabled() {
        let started = Instant::now();
        let duration = Duration::from_millis(400);
        let tr = MateTransition {
            from: empty_expr(),
            to: empty_expr(),
            started,
            duration,
            rotate: true,
        };
        assert_eq!(tr.yaw_deg_at(started), 0.0);
        let mid = tr.yaw_deg_at(started + Duration::from_millis(200));
        assert!(
            mid > 90.0 && mid < 270.0,
            "mid yaw should be ~180, got {mid}"
        );
        // 完了時は 0（=360°）へ戻る。
        assert_eq!(tr.yaw_deg_at(started + duration), 0.0);
    }

    #[test]
    fn transition_yaw_is_zero_when_rotate_disabled() {
        let started = Instant::now();
        let tr = MateTransition {
            from: empty_expr(),
            to: empty_expr(),
            started,
            duration: Duration::from_millis(400),
            rotate: false,
        };
        assert_eq!(tr.yaw_deg_at(started + Duration::from_millis(200)), 0.0);
    }

    #[test]
    fn full_turn_yaw_matches_no_yaw() {
        let frame = FaceFrame::from_params(FaceFrameParams::default());
        let uv = product_uv_table();
        let base = build_face_samples_yawed(&uv, &frame, 0.0);
        let full = build_face_samples_yawed(&uv, &frame, 360.0);
        for (a, b) in base.iter().zip(full.iter()) {
            assert_eq!(a.front, b.front);
            assert_eq!(a.in_face_disk, b.in_face_disk);
            assert!((a.x - b.x).abs() < 1e-4 && (a.y - b.y).abs() < 1e-4);
        }
    }

    #[test]
    fn face_samples_front_have_weight_back_are_zero() {
        let frame = FaceFrame::from_params(FaceFrameParams::default());
        let uv = product_uv_table();
        let samples = build_face_samples_yawed(&uv, &frame, 0.0);
        assert_eq!(samples.len(), uv.len());
        let front_count = samples.iter().filter(|s| s.front).count();
        assert!(
            front_count > 100,
            "expected many front-facing LEDs, got {front_count}"
        );
        let disk_count = samples.iter().filter(|s| s.in_face_disk).count();
        assert!(
            disk_count < front_count,
            "face disk should be smaller than front hemisphere"
        );
        let beyond_disk = samples
            .iter()
            .filter(|s| s.front && !s.in_face_disk)
            .count();
        assert!(
            beyond_disk > 0,
            "expected front LEDs outside face disk for edge parts"
        );
        let max_back = samples
            .iter()
            .zip(uv.iter())
            .filter(|(_, (_, v))| *v > 0.85)
            .map(|(s, _)| u8::from(s.front))
            .fold(0u8, u8::max);
        assert!(max_back == 0, "lower hemisphere should be behind face");
    }

    #[test]
    fn neutral_preset_renders_non_black_pixels() {
        let registry = test_registry();
        let expr = registry.get(DEFAULT_PRESET_ID).unwrap();
        let frame = FaceFrame::from_params(FaceFrameParams::default());
        let uv = product_uv_table();
        let samples = build_face_samples_yawed(&uv, &frame, 0.0);
        let mut rgb = vec![0u8; samples.len() * 3];
        render(&samples, &frame, expr, &Modulation::default(), &mut rgb);
        let lit = rgb
            .chunks(3)
            .filter(|px| (px[0] as u16) + (px[1] as u16) + (px[2] as u16) > 0)
            .count();
        assert!(
            lit > 40,
            "neutral face should light multiple LEDs, got {lit}"
        );
    }

    #[test]
    fn ellipse_eyes_are_left_right_symmetric() {
        let registry = test_registry();
        let expr = registry.get(DEFAULT_PRESET_ID).unwrap();
        let frame = FaceFrame::from_params(FaceFrameParams::default());
        let left_eye = expr.parts.iter().find(|p| p.slot == "eye.l").unwrap();
        let right_eye = expr.parts.iter().find(|p| p.slot == "eye.r").unwrap();
        if let (
            PartKind::Ellipse {
                pos: lpos,
                size: lsize,
                ..
            },
            PartKind::Ellipse {
                pos: rpos,
                size: rsize,
                ..
            },
        ) = (&left_eye.kind, &right_eye.kind)
        {
            assert!((lpos[0] + rpos[0]).abs() < 0.02);
            assert!((lsize[0] - rsize[0]).abs() < 0.01);
            assert!((lsize[1] - rsize[1]).abs() < 0.01);
        } else {
            panic!("eyes should be ellipses");
        }
        let _ = frame;
    }

    #[test]
    fn lerp_expression_endpoints_match() {
        let registry = test_registry();
        let neutral = registry.get("neutral").unwrap().clone();
        let happy = registry.get("happy").unwrap().clone();
        let at0 = lerp_expression(&neutral, &happy, 0.0);
        let at1 = lerp_expression(&neutral, &happy, 1.0);
        assert_eq!(at0.background, neutral.background);
        assert_eq!(at1.background, happy.background);
        let eye_l0 = at0.parts.iter().find(|p| p.slot == "eye.l").unwrap();
        let eye_l_n = neutral.parts.iter().find(|p| p.slot == "eye.l").unwrap();
        if let (PartKind::Ellipse { pos: p0, .. }, PartKind::Ellipse { pos: pn, .. }) =
            (&eye_l0.kind, &eye_l_n.kind)
        {
            assert!((p0[0] - pn[0]).abs() < 1e-4);
        }
        let cheek_l0 = at0.parts.iter().find(|p| p.slot == "cheek.l");
        assert!(
            cheek_l0.map(|p| p.intensity).unwrap_or(0.0) < 1e-4,
            "cheeks should be faded out at t=0"
        );
        let eye_l1 = at1.parts.iter().find(|p| p.slot == "eye.l").unwrap();
        let eye_l_h = happy.parts.iter().find(|p| p.slot == "eye.l").unwrap();
        if let (PartKind::Ellipse { pos: p1, .. }, PartKind::Ellipse { pos: ph, .. }) =
            (&eye_l1.kind, &eye_l_h.kind)
        {
            assert!((p1[0] - ph[0]).abs() < 1e-4);
        }
        let cheek_l1 = at1.parts.iter().find(|p| p.slot == "cheek.l").unwrap();
        let cheek_l_h = happy.parts.iter().find(|p| p.slot == "cheek.l").unwrap();
        assert!((cheek_l1.intensity - cheek_l_h.intensity).abs() < 1e-4);
    }

    #[test]
    fn sad_preset_json_parses() {
        let raw = include_str!("presets/sad.face.json");
        let preset: FacePresetJson = serde_json::from_str(raw).expect("parse sad preset");
        assert_eq!(preset.id, "sad");
        assert_eq!(preset.parts.len(), 5);
    }

    #[test]
    fn preset_registry_loads_all_builtins() {
        let registry = test_registry();
        assert!(registry.get("neutral").is_some());
        assert!(registry.get("happy").is_some());
        assert!(registry.get("sad").is_some());
        assert!(registry.get("angry").is_some());
        assert!(registry.get("surprised").is_some());
        assert!(registry.get("sleepy").is_some());
        assert!(registry.get("love").is_some());
        assert_eq!(registry.summaries().len(), 7);
    }

    #[test]
    fn love_preset_uses_heart_stamps() {
        let registry = test_registry();
        let expr = registry.get("love").unwrap();
        let left = expr.parts.iter().find(|p| p.slot == "eye.l").unwrap();
        assert!(!part_blinks(left));
        assert!(matches!(&left.kind, PartKind::Stamp { mask, .. } if mask.id == "heart"));
    }

    #[test]
    fn love_heart_recolors_single_slot_to_part_color() {
        let registry = test_registry();
        let expr = registry.get("love").unwrap();
        let left = expr.parts.iter().find(|p| p.slot == "eye.l").unwrap();
        let PartKind::Stamp { recolor, .. } = &left.kind else {
            panic!("expected stamp eye");
        };
        assert_eq!(recolor.as_slice(), &[left.color]);
    }

    #[test]
    fn resolve_recolor_prefers_preset_palette() {
        let stamps = StampRegistry::load(Path::new("/nonexistent")).unwrap();
        let heart = stamps.get("heart").unwrap();
        let preset = [[10u8, 20, 30]];
        let recolor = resolve_recolor(heart, Some(&preset), [0, 0, 0]);
        assert_eq!(recolor, vec![[10, 20, 30]]);
    }

    #[test]
    fn resolve_recolor_single_slot_uses_color() {
        let stamps = StampRegistry::load(Path::new("/nonexistent")).unwrap();
        let heart = stamps.get("heart").unwrap();
        let recolor = resolve_recolor(heart, None, [200, 50, 90]);
        assert_eq!(recolor, vec![[200, 50, 90]]);
    }

    #[test]
    fn cross_kind_slot_morphs_shape_and_color() {
        let registry = test_registry();
        let neutral = registry.get("neutral").unwrap().clone();
        let love = registry.get("love").unwrap().clone();
        let mid = lerp_expression(&neutral, &love, 0.5);
        let eye = mid.parts.iter().find(|p| p.slot == "eye.l").unwrap();
        assert!(
            eye.morph_to.is_some(),
            "ellipse→stamp should crossfade geometry"
        );
        assert!((eye.morph_t - 0.5).abs() < 1e-4);
        assert!(
            eye.color[0] >= 120 && eye.color[2] > 120,
            "color should blend"
        );
    }

    #[test]
    fn love_heart_stamp_matches_eye_size() {
        let registry = test_registry();
        let expr = registry.get("love").unwrap();
        let eye = expr.parts.iter().find(|p| p.slot == "eye.l").unwrap();
        if let PartKind::Stamp { half_size, .. } = &eye.kind {
            assert!((half_size[0] - 0.30).abs() < 0.01);
            assert!((half_size[1] - 0.30).abs() < 0.01);
        } else {
            panic!("expected stamp eye");
        }
    }

    #[test]
    fn morph_sdf_avoids_midpoint_dimming() {
        let registry = test_registry();
        let neutral = registry.get("neutral").unwrap().clone();
        let love = registry.get("love").unwrap().clone();
        let mid = lerp_expression(&neutral, &love, 0.5);
        let eye = mid.parts.iter().find(|p| p.slot == "eye.l").unwrap();
        let frame = FaceFrame::from_params(FaceFrameParams::default());
        let uv = product_uv_table();
        let samples = build_face_samples_yawed(&uv, &frame, 0.0);
        let target = [-0.42f32, 0.26];
        let sample = samples
            .iter()
            .filter(|s| s.front)
            .min_by(|a, b| {
                let da = (a.x - target[0]).powi(2) + (a.y - target[1]).powi(2);
                let db = (b.x - target[0]).powi(2) + (b.y - target[1]).powi(2);
                da.partial_cmp(&db).unwrap()
            })
            .expect("eye-center sample");
        let dist_sq = (sample.x - target[0]).powi(2) + (sample.y - target[1]).powi(2);
        assert!(dist_sq < 0.05, "no LED near eye center, dist_sq={dist_sq}");
        let cov = part_coverage(sample.x, sample.y, eye, 1.0, &frame, 0.0);
        assert!(cov > 0.35, "morphed eye center should stay lit, got {cov}");
    }

    #[test]
    fn angry_stamp_renders_on_product_layout() {
        let registry = test_registry();
        let expr = registry.get("angry").unwrap();
        let anger = expr.parts.iter().find(|p| p.slot == "anger").unwrap();
        let frame = FaceFrame::from_params(FaceFrameParams::default());
        let uv = product_uv_table();
        let samples = build_face_samples_yawed(&uv, &frame, 0.0);
        let hits = samples.iter().any(|sample| {
            sample.front && part_sample(sample.x, sample.y, anger, 1.0, &frame, 0.0).is_some()
        });
        assert!(hits, "anger stamp should light at least one front LED");
        let mut rgb = vec![0u8; samples.len() * 3];
        render(&samples, &frame, expr, &Modulation::default(), &mut rgb);
        let lit = samples
            .iter()
            .zip(rgb.chunks(3))
            .filter(|(sample, _)| sample.front)
            .filter(|(sample, _)| {
                part_sample(sample.x, sample.y, anger, 1.0, &frame, 0.0).is_some()
            })
            .filter(|(_, px)| (px[0] as u16) + (px[1] as u16) + (px[2] as u16) > 0)
            .count();
        assert!(lit > 0, "anger stamp should render at full brightness");
    }

    #[test]
    fn angry_preset_includes_anger_stamp() {
        let registry = test_registry();
        let expr = registry.get("angry").unwrap();
        let anger = expr.parts.iter().find(|p| p.slot == "anger").unwrap();
        assert!(matches!(&anger.kind, PartKind::Stamp { mask, .. } if mask.id == "anger"));
        assert!(
            !part_follows_breathing(anger),
            "anger stamp should not follow breathing motion"
        );
        assert!(
            anger
                .motions
                .iter()
                .any(|m| matches!(m, PartMotion::RotateWobble { .. })),
            "anger stamp should wobble in place"
        );
    }

    #[test]
    fn anger_stamp_wobble_changes_rotation() {
        let registry = test_registry();
        let expr = registry.get("angry").unwrap();
        let anger = expr.parts.iter().find(|p| p.slot == "anger").unwrap();
        let PartKind::Stamp { pos, .. } = &anger.kind else {
            panic!("expected anger stamp");
        };
        let frame = FaceFrame::from_params(FaceFrameParams::default());
        // 怒りマークは左右反転（pos.x と rotationDeg を反転）しているため、
        // ローブを突くプローブも水平方向に反転させる。
        let fx = pos[0] - 0.06;
        let fy = pos[1] + 0.02;
        let m0 = part_motion_sample(anger, 0.0);
        let m1 = part_motion_sample(anger, 0.5);
        assert!(m0.d_rotation_deg.abs() < 1e-4);
        assert!(m1.d_rotation_deg.abs() > 1.0);
        let at_zero = part_sample(fx, fy, anger, 1.0, &frame, m0.d_rotation_deg);
        let at_peak = part_sample(fx, fy, anger, 1.0, &frame, m1.d_rotation_deg);
        assert!(at_zero.is_some(), "anger stamp edge should be visible");
        assert!(
            at_peak.is_some(),
            "anger stamp should stay visible while wobbling"
        );
    }

    #[test]
    fn sad_preset_includes_alternating_tear_motions() {
        let registry = test_registry();
        let expr = registry.get("sad").unwrap();
        let tear_l = expr.parts.iter().find(|p| p.slot == "tear.l").unwrap();
        let tear_r = expr.parts.iter().find(|p| p.slot == "tear.r").unwrap();
        let tear_motion = |part: &Part| {
            part.motions.iter().find_map(|m| {
                if let PartMotion::TearFall {
                    period_ms,
                    phase_frac,
                    ..
                } = m
                {
                    Some((*period_ms, *phase_frac))
                } else {
                    None
                }
            })
        };
        let (period_l, phase_l) = tear_motion(tear_l).expect("tear.l tearFall");
        let (period_r, phase_r) = tear_motion(tear_r).expect("tear.r tearFall");
        assert_eq!(period_l, period_r);
        assert!((phase_l - phase_r).abs() > 0.4);
        let m_l = part_motion_sample(tear_l, 0.0);
        let m_r = part_motion_sample(tear_r, 0.0);
        assert!(m_r.dy.abs() < 1e-4);
        assert!(m_l.dy < -0.1);
        assert!((m_l.dy - m_r.dy).abs() > 0.1);
    }

    #[test]
    fn eyes_blink_by_default() {
        let registry = test_registry();
        let expr = registry.get(DEFAULT_PRESET_ID).unwrap();
        let left = expr.parts.iter().find(|p| p.slot == "eye.l").unwrap();
        assert!(part_blinks(left));
    }

    #[test]
    fn breathing_wave_uses_fixed_subtle_motion() {
        let breathing = BreathingParams { enabled: true };
        // 位相 TAU/4 = 吸気ピーク。
        let wave = breathing.sample_wave(std::f32::consts::FRAC_PI_2);
        assert!(
            wave.brightness_gain > 1.1 && wave.brightness_gain < 1.2,
            "fixed brightness swing, got {}",
            wave.brightness_gain
        );
        assert!(
            wave.face_scale > 1.03 && wave.face_scale < 1.05,
            "fixed scale swing, got {}",
            wave.face_scale
        );
        assert!(
            wave.face_offset_y > 0.02 && wave.face_offset_y < 0.04,
            "fixed vertical bob, got {}",
            wave.face_offset_y
        );
    }

    #[test]
    fn breathing_modulates_rendered_brightness() {
        let registry = test_registry();
        let expr = registry.get(DEFAULT_PRESET_ID).unwrap();
        let frame = FaceFrame::from_params(FaceFrameParams::default());
        let uv = product_uv_table();
        let samples = build_face_samples_yawed(&uv, &frame, 0.0);
        let mut dim = vec![0u8; samples.len() * 3];
        let mut bright = vec![0u8; samples.len() * 3];
        render(
            &samples,
            &frame,
            expr,
            &Modulation {
                breathe_brightness: 0.65,
                breathe_face_scale: 1.0,
                breathe_face_offset_y: 0.0,
                blink_openness: 1.0,
                anim_time_secs: 0.0,
            },
            &mut dim,
        );
        render(
            &samples,
            &frame,
            expr,
            &Modulation {
                breathe_brightness: 1.85,
                breathe_face_scale: 1.0,
                breathe_face_offset_y: 0.0,
                blink_openness: 1.0,
                anim_time_secs: 0.0,
            },
            &mut bright,
        );
        let dim_sum: u32 = dim.iter().map(|&b| u32::from(b)).sum();
        let bright_sum: u32 = bright.iter().map(|&b| u32::from(b)).sum();
        assert!(
            bright_sum > dim_sum * 13 / 10,
            "brightness gain should be clearly visible: dim={dim_sum} bright={bright_sum}"
        );
    }

    #[test]
    fn stamp_center_is_inside_at_offset_eye() {
        let reg = test_registry();
        let expr = reg.get("love").unwrap();
        let frame = FaceFrame::from_params(FaceFrameParams::default());
        let eye = expr.parts.iter().find(|p| p.slot == "eye.l").unwrap();
        let PartKind::Stamp { pos, .. } = &eye.kind else {
            panic!("expected stamp eye");
        };
        let d_center = kind_sdf(pos[0], pos[1], &eye.kind, false, 1.0, &frame, 0.0);
        assert!(d_center < 0.0, "heart center inside, got {d_center}");
    }

    #[test]
    fn log_map_is_isotropic_at_offset_center() {
        // A circle of constant geodesic radius around an off-center stamp center
        // must map to a circle (constant radius) in log-map coords. The previous
        // global-tangent projection produced ~13% anisotropy here.
        let frame = FaceFrame::from_params(FaceFrameParams::default());
        let d0 = face_dir_from_xy(-0.42, 0.26, &frame);
        let up_dot = dot3(frame.up, d0);
        let e_v = normalize3([
            frame.up[0] - up_dot * d0[0],
            frame.up[1] - up_dot * d0[1],
            frame.up[2] - up_dot * d0[2],
        ]);
        let e_u = normalize3(cross3(e_v, d0));
        let rad = 0.20f32;
        let mut min_r = f32::MAX;
        let mut max_r = 0.0f32;
        for k in 0..24 {
            let a = k as f32 * std::f32::consts::TAU / 24.0;
            let tdir = [
                e_u[0] * a.cos() + e_v[0] * a.sin(),
                e_u[1] * a.cos() + e_v[1] * a.sin(),
                e_u[2] * a.cos() + e_v[2] * a.sin(),
            ];
            let d = normalize3([
                d0[0] * rad.cos() + tdir[0] * rad.sin(),
                d0[1] * rad.cos() + tdir[1] * rad.sin(),
                d0[2] * rad.cos() + tdir[2] * rad.sin(),
            ]);
            let (tx, ty) = sphere_log_map(d0, d, frame.up);
            let r = (tx * tx + ty * ty).sqrt();
            min_r = min_r.min(r);
            max_r = max_r.max(r);
        }
        assert!(
            (min_r - rad).abs() < 1e-3,
            "radius should equal geodesic dist"
        );
        assert!(
            max_r / min_r < 1.01,
            "log map must be isotropic, ratio {}",
            max_r / min_r
        );
    }

    #[test]
    fn blink_narrows_eye_width_when_closed() {
        let open = blink_eye_radii([0.19, 0.23], 1.0);
        let closed = blink_eye_radii([0.19, 0.23], 0.04);
        assert_eq!(open, [0.19, 0.23]);
        assert!(
            closed[0] < open[0] * 0.55,
            "width should narrow: {:?}",
            closed
        );
        assert!(
            closed[1] < open[1] * 0.1,
            "height should squash: {:?}",
            closed
        );
    }

    #[test]
    fn blink_squashes_eye_height_when_closed() {
        let registry = test_registry();
        let expr = registry.get(DEFAULT_PRESET_ID).unwrap();
        let frame = FaceFrame::from_params(FaceFrameParams::default());
        let uv = product_uv_table();
        let samples = build_face_samples_yawed(&uv, &frame, 0.0);
        let mut open = vec![0u8; samples.len() * 3];
        let mut closed = vec![0u8; samples.len() * 3];
        render(
            &samples,
            &frame,
            expr,
            &Modulation {
                breathe_brightness: 1.0,
                breathe_face_scale: 1.0,
                breathe_face_offset_y: 0.0,
                blink_openness: 1.0,
                anim_time_secs: 0.0,
            },
            &mut open,
        );
        render(
            &samples,
            &frame,
            expr,
            &Modulation {
                breathe_brightness: 1.0,
                breathe_face_scale: 1.0,
                breathe_face_offset_y: 0.0,
                blink_openness: 0.05,
                anim_time_secs: 0.0,
            },
            &mut closed,
        );
        let open_sum: u32 = open.iter().map(|&b| u32::from(b)).sum();
        let closed_sum: u32 = closed.iter().map(|&b| u32::from(b)).sum();
        assert!(
            closed_sum < open_sum,
            "closed blink should reduce lit pixels: open={open_sum} closed={closed_sum}"
        );
    }
}
