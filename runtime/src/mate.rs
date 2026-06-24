//! 相棒（mate）モード: 球面クォータニオン顔フレーム、液体追従、待機コレオ、SDF パーツ描画。
//! 設計: `docs/MATE-MODE.md`

use std::f32::consts::PI;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

use crate::device_slot::DeviceSlot;
use crate::sphere::unit_dir_from_equirect_uv_y_up;

// --- クォータニオン (w, x, y, z) = w + xi + yj + zk、ハミルトン積 ---

#[inline]
fn quat_normalize(q: [f32; 4]) -> [f32; 4] {
    let n = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
    if n < 1e-8 {
        return [1.0, 0.0, 0.0, 0.0];
    }
    [q[0] / n, q[1] / n, q[2] / n, q[3] / n]
}

#[inline]
fn quat_mul(a: [f32; 4], b: [f32; 4]) -> [f32; 4] {
    let aw = a[0];
    let ax = a[1];
    let ay = a[2];
    let az = a[3];
    let bw = b[0];
    let bx = b[1];
    let by = b[2];
    let bz = b[3];
    [
        aw * bw - ax * bx - ay * by - az * bz,
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
    ]
}

#[inline]
fn quat_conj(q: [f32; 4]) -> [f32; 4] {
    [q[0], -q[1], -q[2], -q[3]]
}

/// `q` はローカル→世界。`v` を世界座標とみなし、ローカルへ回す: q* ⊗ v ⊗ q
#[inline]
fn rotate_vec_world_to_local(q: [f32; 4], v: [f32; 3]) -> [f32; 3] {
    let qc = quat_conj(q);
    rotate_vec_by_quat_pure(qc, v)
}

/// 純粋クォータ (0,v) を q で共役: q * (0,v) * q*
fn rotate_vec_by_quat_pure(q: [f32; 4], v: [f32; 3]) -> [f32; 3] {
    let p = [0.0, v[0], v[1], v[2]];
    let t = quat_mul(quat_mul(q, p), quat_conj(q));
    [t[1], t[2], t[3]]
}

fn slerp_quat(a: [f32; 4], b: [f32; 4], t: f32) -> [f32; 4] {
    let t = t.clamp(0.0, 1.0);
    let mut dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    let mut b_use = b;
    if dot < 0.0 {
        b_use = [-b[0], -b[1], -b[2], -b[3]];
        dot = -dot;
    }
    if dot > 0.9995 {
        let w = a[0] + t * (b_use[0] - a[0]);
        let x = a[1] + t * (b_use[1] - a[1]);
        let y = a[2] + t * (b_use[2] - a[2]);
        let z = a[3] + t * (b_use[3] - a[3]);
        return quat_normalize([w, x, y, z]);
    }
    let theta_0 = dot.clamp(-1.0, 1.0).acos();
    let theta = theta_0 * t;
    let sin_theta = theta.sin();
    let sin_theta_0 = theta_0.sin().max(1e-8);
    let s0 = (theta_0 - theta).sin() / sin_theta_0;
    let s1 = sin_theta / sin_theta_0;
    quat_normalize([
        a[0] * s0 + b_use[0] * s1,
        a[1] * s0 + b_use[1] * s1,
        a[2] * s0 + b_use[2] * s1,
        a[3] * s0 + b_use[3] * s1,
    ])
}

fn normalize3(v: [f32; 3]) -> [f32; 3] {
    let n = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if n < 1e-8 {
        return [0.0, 0.0, 1.0];
    }
    [v[0] / n, v[1] / n, v[2] / n]
}

fn slerp_dirs(a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    let a = normalize3(a);
    let b = normalize3(b);
    let t = t.clamp(0.0, 1.0);
    let dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]).clamp(-1.0, 1.0);
    let omega = dot.acos();
    if omega.abs() < 1e-4 {
        return normalize3([
            a[0] + t * (b[0] - a[0]),
            a[1] + t * (b[1] - a[1]),
            a[2] + t * (b[2] - a[2]),
        ]);
    }
    let so = omega.sin();
    let s0 = ((1.0 - t) * omega).sin() / so;
    let s1 = (t * omega).sin() / so;
    normalize3([
        a[0] * s0 + b[0] * s1,
        a[1] * s0 + b[1] * s1,
        a[2] * s0 + b[2] * s1,
    ])
}

/// ローカル +Z が `forward`（世界）へ向く正規直交基底からクォータニオン。
fn look_quaternion_forward(forward: [f32; 3]) -> [f32; 4] {
    let f = normalize3(forward);
    let mut up = [0.0f32, 1.0, 0.0];
    if (f[0] * up[0] + f[1] * up[1] + f[2] * up[2]).abs() > 0.92 {
        up = [1.0, 0.0, 0.0];
    }
    let r = normalize3(cross3(up, f));
    let u = normalize3(cross3(f, r));
    mat3_cols_to_quat(r, u, f)
}

fn cross3(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

/// 列が右・上・前（ローカル X,Y,Z が世界へ写る）
fn mat3_cols_to_quat(c0: [f32; 3], c1: [f32; 3], c2: [f32; 3]) -> [f32; 4] {
    let m00 = c0[0];
    let m01 = c1[0];
    let m02 = c2[0];
    let m10 = c0[1];
    let m11 = c1[1];
    let m12 = c2[1];
    let m20 = c0[2];
    let m21 = c1[2];
    let m22 = c2[2];
    let tr = m00 + m11 + m22;
    let q = if tr > 0.0 {
        let s = 0.5 / (tr + 1.0).sqrt();
        [0.25 / s, (m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s]
    } else if m00 > m11 && m00 > m22 {
        let s = 2.0 * (1.0 + m00 - m11 - m22).sqrt();
        [(m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s]
    } else if m11 > m22 {
        let s = 2.0 * (1.0 + m11 - m00 - m22).sqrt();
        [(m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s]
    } else {
        let s = 2.0 * (1.0 + m22 - m00 - m11).sqrt();
        [(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s]
    };
    quat_normalize([
        if q[0].is_finite() { q[0] } else { 0.0 },
        if q[1].is_finite() { q[1] } else { 0.0 },
        if q[2].is_finite() { q[2] } else { 0.0 },
        if q[3].is_finite() { q[3] } else { 0.0 },
    ])
}

#[inline]
fn approach(current: f32, target: f32, dt: f32, tau: f32) -> f32 {
    if tau < 1e-4 {
        return target;
    }
    let k = 1.0 - (-dt / tau).exp();
    current + (target - current) * k
}

#[inline]
fn smooth01(x: f32) -> f32 {
    let x = x.clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}

#[inline]
fn srgb_byte_to_linear(c: u8) -> f32 {
    let s = c as f32 / 255.0;
    if s <= 0.04045 {
        s / 12.92
    } else {
        ((s + 0.055) / 1.055).powf(2.4)
    }
}

#[inline]
fn linear_to_srgb_u8(l: f32) -> u8 {
    let l = l.clamp(0.0, 1.0);
    let s = if l <= 0.0031308 {
        12.92 * l
    } else {
        1.055 * l.powf(1.0 / 2.4) - 0.055
    };
    (s * 255.0).round().clamp(0.0, 255.0) as u8
}

fn add_tinted_to_accum(acc: &mut [f32], led_i: usize, wave: f32, pr: u8, pg: u8, pb: u8) {
    let o = led_i * 3;
    if o + 2 >= acc.len() {
        return;
    }
    let w = wave.max(0.0);
    if w <= 1e-6 {
        return;
    }
    acc[o] += w * srgb_byte_to_linear(pr);
    acc[o + 1] += w * srgb_byte_to_linear(pg);
    acc[o + 2] += w * srgb_byte_to_linear(pb);
}

fn finalize_black_base(acc: &[f32]) -> Vec<u8> {
    let mut rgb = vec![0u8; acc.len()];
    for i in (0..acc.len()).step_by(3) {
        let mut r_lin = acc[i];
        let mut g_lin = acc[i + 1];
        let mut b_lin = acc[i + 2];
        let m = r_lin.max(g_lin).max(b_lin);
        if m > 1.0 {
            let s = 1.0 / m;
            r_lin *= s;
            g_lin *= s;
            b_lin *= s;
        }
        rgb[i] = linear_to_srgb_u8(r_lin);
        rgb[i + 1] = linear_to_srgb_u8(g_lin);
        rgb[i + 2] = linear_to_srgb_u8(b_lin);
    }
    rgb
}

// --- 表情・ムード・コレオ ---

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Expression {
    Neutral,
    Happy,
    Sad,
    Angry,
    Sleepy,
    Surprised,
    Curious,
    Playful,
}

impl Expression {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "neutral" => Some(Self::Neutral),
            "happy" => Some(Self::Happy),
            "sad" => Some(Self::Sad),
            "angry" => Some(Self::Angry),
            "sleepy" => Some(Self::Sleepy),
            "surprised" => Some(Self::Surprised),
            "curious" => Some(Self::Curious),
            "playful" => Some(Self::Playful),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Neutral => "neutral",
            Self::Happy => "happy",
            Self::Sad => "sad",
            Self::Angry => "angry",
            Self::Sleepy => "sleepy",
            Self::Surprised => "surprised",
            Self::Curious => "curious",
            Self::Playful => "playful",
        }
    }

    fn target_channels(self) -> ExprChannels {
        match self {
            Self::Neutral => ExprChannels {
                eye_curve: 0.0,
                eye_open: 1.0,
                mouth_curve: 0.0,
                mouth_open: 0.05,
                mouth_width: 0.55,
                cr: 200,
                cg: 240,
                cb: 255,
                tremor: 0.0,
                melt: 0.0,
                cheek_flush: 0.0,
            },
            Self::Happy => ExprChannels {
                eye_curve: 0.75,
                eye_open: 0.92,
                mouth_curve: 0.75,
                mouth_open: 0.22,
                mouth_width: 0.62,
                cr: 255,
                cg: 230,
                cb: 200,
                tremor: 0.0,
                melt: 0.0,
                cheek_flush: 0.82,
            },
            Self::Sad => ExprChannels {
                eye_curve: -0.15,
                eye_open: 0.72,
                mouth_curve: -0.55,
                mouth_open: 0.05,
                mouth_width: 0.48,
                cr: 160,
                cg: 200,
                cb: 255,
                tremor: 0.0,
                melt: 0.25,
                cheek_flush: 0.0,
            },
            Self::Angry => ExprChannels {
                eye_curve: -0.65,
                eye_open: 1.0,
                mouth_curve: -0.35,
                mouth_open: 0.12,
                mouth_width: 0.52,
                cr: 255,
                cg: 120,
                cb: 100,
                tremor: 0.35,
                melt: 0.0,
                cheek_flush: 0.0,
            },
            Self::Sleepy => ExprChannels {
                eye_curve: 0.0,
                eye_open: 0.28,
                mouth_curve: 0.0,
                mouth_open: 0.0,
                mouth_width: 0.45,
                cr: 180,
                cg: 190,
                cb: 220,
                tremor: 0.0,
                melt: 0.1,
                cheek_flush: 0.0,
            },
            Self::Surprised => ExprChannels {
                eye_curve: 0.0,
                eye_open: 1.0,
                mouth_curve: 0.0,
                mouth_open: 0.65,
                mouth_width: 0.5,
                cr: 255,
                cg: 255,
                cb: 240,
                tremor: 0.08,
                melt: 0.0,
                cheek_flush: 0.0,
            },
            Self::Curious => ExprChannels {
                eye_curve: 0.2,
                eye_open: 1.0,
                mouth_curve: 0.15,
                mouth_open: 0.1,
                mouth_width: 0.58,
                cr: 220,
                cg: 250,
                cb: 255,
                tremor: 0.05,
                melt: 0.0,
                cheek_flush: 0.0,
            },
            Self::Playful => ExprChannels {
                eye_curve: 0.45,
                eye_open: 0.88,
                mouth_curve: 0.55,
                mouth_open: 0.25,
                mouth_width: 0.65,
                cr: 255,
                cg: 200,
                cb: 255,
                tremor: 0.12,
                melt: 0.0,
                cheek_flush: 0.58,
            },
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct ExprChannels {
    eye_curve: f32,
    eye_open: f32,
    mouth_curve: f32,
    mouth_open: f32,
    mouth_width: f32,
    cr: u8,
    cg: u8,
    cb: u8,
    tremor: f32,
    melt: f32,
    cheek_flush: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mood {
    Calm,
    Curious,
    Playful,
    Sleepy,
    Alert,
}

impl Mood {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "calm" => Some(Self::Calm),
            "curious" => Some(Self::Curious),
            "playful" => Some(Self::Playful),
            "sleepy" => Some(Self::Sleepy),
            "alert" => Some(Self::Alert),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Calm => "calm",
            Self::Curious => "curious",
            Self::Playful => "playful",
            Self::Sleepy => "sleepy",
            Self::Alert => "alert",
        }
    }

    fn spring_mul(self) -> f32 {
        match self {
            Self::Calm => 0.85,
            Self::Curious => 1.15,
            Self::Playful => 1.25,
            Self::Sleepy => 0.55,
            Self::Alert => 1.4,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdleRoutine {
    Drift,
    Orbit,
    Figure8,
    SpiralPole,
    Wander,
}

impl IdleRoutine {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "drift" => Some(Self::Drift),
            "orbit" => Some(Self::Orbit),
            "figure8" => Some(Self::Figure8),
            "spiralPole" | "spiral_pole" => Some(Self::SpiralPole),
            "wander" => Some(Self::Wander),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Drift => "drift",
            Self::Orbit => "orbit",
            Self::Figure8 => "figure8",
            Self::SpiralPole => "spiralPole",
            Self::Wander => "wander",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicsCfg {
    pub stiffness: f32,
    pub damping: f32,
    pub floatiness: f32,
    pub trail_lag: f32,
}

impl Default for DynamicsCfg {
    fn default() -> Self {
        Self {
            stiffness: 6.0,
            damping: 0.72,
            floatiness: 0.35,
            trail_lag: 0.28,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct AutoFlags {
    pub breath: bool,
    pub blink: bool,
    pub saccade: bool,
    pub tremor: bool,
}

impl Default for AutoFlags {
    fn default() -> Self {
        Self {
            breath: true,
            blink: true,
            saccade: true,
            tremor: false,
        }
    }
}

/// 相棒モードの可変状態。
#[derive(Debug, Clone)]
pub struct MateState {
    pub expression: Expression,
    pub mood: Mood,
    pub routine: IdleRoutine,
    /// コレオ位相速度（ラジアン/秒相当スケール）
    pub idle_speed: f32,
    pub orbit_axis: [f32; 3],
    pub gaze_u: f32,
    pub gaze_v: f32,
    pub gaze_pull: f32,
    pub cluster: f32,
    pub dynamics: DynamicsCfg,
    /// 顔キャンバスの球面半開角（度）。パーツ配置・クリップ領域。製品 1260 LED 向け既定 58°。
    pub face_angular_radius_deg: f32,
    /// 目・口などパーツの大きさ（顔半径に対する比）。
    pub feature_scale: f32,
    /// 両目の間隔（顔直径に対する比、0–1）。
    pub eye_spacing: f32,
    pub brightness: f32,
    pub color: [u8; 3],
    pub color_override: Option<[u8; 3]>,
    pub manual_mouth_open: Option<f32>,
    pub auto: AutoFlags,
    /// クォータニオン: ローカル→世界
    pub q_face: [f32; 4],
    pub omega: [f32; 3],
    /// 表情チャンネル現在値（補間後）
    pub cur_eye_curve: f32,
    pub cur_eye_open: f32,
    pub cur_mouth_curve: f32,
    pub cur_mouth_open: f32,
    pub cur_mouth_width: f32,
    pub cur_tremor: f32,
    pub cur_melt: f32,
    pub cur_cheek_flush: f32,
    pub blink_mul: f32,
    pub breath_phase: f32,
    pub orbit_phase: f32,
    pub wander_dir: [f32; 3],
    pub next_blink: Instant,
    pub next_saccade: Instant,
    pub next_wander_step: Instant,
    pub rng: u64,
}

impl Default for MateState {
    fn default() -> Self {
        let now = Instant::now();
        Self {
            expression: Expression::Neutral,
            mood: Mood::Calm,
            routine: IdleRoutine::Orbit,
            idle_speed: 0.35,
            orbit_axis: [0.0, 1.0, 0.0],
            gaze_u: 0.5,
            gaze_v: 0.42,
            gaze_pull: 0.55,
            cluster: 0.15,
            dynamics: DynamicsCfg::default(),
            face_angular_radius_deg: 58.0,
            feature_scale: 0.32,
            eye_spacing: 0.52,
            brightness: 0.92,
            color: [200, 240, 255],
            color_override: None,
            manual_mouth_open: None,
            auto: AutoFlags::default(),
            q_face: [1.0, 0.0, 0.0, 0.0],
            omega: [0.0; 3],
            cur_eye_curve: 0.0,
            cur_eye_open: 1.0,
            cur_mouth_curve: 0.0,
            cur_mouth_open: 0.05,
            cur_mouth_width: 0.55,
            cur_tremor: 0.0,
            cur_melt: 0.0,
            cur_cheek_flush: 0.0,
            blink_mul: 1.0,
            breath_phase: 0.0,
            orbit_phase: 0.0,
            wander_dir: [0.0, 0.0, 1.0],
            next_blink: now + Duration::from_millis(2800),
            next_saccade: now + Duration::from_millis(900),
            next_wander_step: now + Duration::from_millis(400),
            rng: 0xC0FFEEDEADBEEF,
        }
    }
}

impl MateState {
    fn xor_rng(&mut self) -> f32 {
        self.rng ^= self.rng << 13;
        self.rng ^= self.rng >> 7;
        self.rng ^= self.rng << 17;
        (self.rng as f64 / u64::MAX as f64) as f32
    }

    fn rng_range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + (hi - lo) * self.xor_rng()
    }

    pub fn gaze_dir_world(&self) -> [f32; 3] {
        normalize3(unit_dir_from_equirect_uv_y_up(self.gaze_u, self.gaze_v))
    }

    fn anchor_dir(&mut self, t: f32) -> [f32; 3] {
        let ax = normalize3(self.orbit_axis);
        let w = self.idle_speed * t + self.orbit_phase;
        match self.routine {
            IdleRoutine::Drift => {
                let a = (t * 0.31).sin();
                let b = (t * 0.23).cos() * 0.35;
                let c = (t * 0.27).cos();
                normalize3([a, b, c])
            }
            IdleRoutine::Orbit => {
                let side = normalize3(cross3([0.0, 1.0, 0.0], ax));
                if side[0].abs() + side[1].abs() + side[2].abs() < 1e-4 {
                    let side = [1.0, 0.0, 0.0];
                    normalize3([
                        side[0] * w.cos() + ax[0] * w.sin(),
                        side[1] * w.cos() + ax[1] * w.sin(),
                        side[2] * w.cos() + ax[2] * w.sin(),
                    ])
                } else {
                    let s = w.sin();
                    let c = w.cos();
                    normalize3([
                        side[0] * c + ax[0] * s,
                        side[1] * c + ax[1] * s,
                        side[2] * c + ax[2] * s,
                    ])
                }
            }
            IdleRoutine::Figure8 => {
                let a = w.sin();
                let b = (2.0 * w).sin() * 0.28;
                let c = w.cos();
                normalize3([a, b, c])
            }
            IdleRoutine::SpiralPole => {
                let u = w * 0.4;
                let lat = u.sin().clamp(-1.0, 1.0) * PI * 0.45;
                let lon = w * 1.1;
                let y = lat.sin();
                let r = lat.cos().max(1e-6);
                normalize3([r * lon.cos(), y, r * lon.sin()])
            }
            IdleRoutine::Wander => normalize3(self.wander_dir),
        }
    }

    pub fn tick(&mut self, dt: f32, loop_t: f32, now: Instant) {
        let dt = dt.max(0.0);
        let t = loop_t;

        let tgt = self.expression.target_channels();
        let tau_shape = 0.16 / self.mood.spring_mul();
        self.cur_eye_curve = approach(self.cur_eye_curve, tgt.eye_curve, dt, tau_shape);
        self.cur_eye_open = approach(self.cur_eye_open, tgt.eye_open, dt, tau_shape);
        self.cur_mouth_curve = approach(self.cur_mouth_curve, tgt.mouth_curve, dt, tau_shape);
        let mouth_tgt = self.manual_mouth_open.unwrap_or(tgt.mouth_open);
        self.cur_mouth_open = approach(self.cur_mouth_open, mouth_tgt, dt, tau_shape);
        self.cur_mouth_width = approach(self.cur_mouth_width, tgt.mouth_width, dt, tau_shape);
        self.cur_tremor = approach(self.cur_tremor, tgt.tremor, dt, tau_shape);
        self.cur_melt = approach(self.cur_melt, tgt.melt, dt, tau_shape);
        self.cur_cheek_flush = approach(self.cur_cheek_flush, tgt.cheek_flush, dt, tau_shape);

        let tau_color = 0.38 / self.mood.spring_mul();
        if let Some(c) = self.color_override {
            self.color = c;
        } else {
            self.color[0] = (approach(self.color[0] as f32, tgt.cr as f32, dt, tau_color).round()
                as i32)
                .clamp(0, 255) as u8;
            self.color[1] = (approach(self.color[1] as f32, tgt.cg as f32, dt, tau_color).round()
                as i32)
                .clamp(0, 255) as u8;
            self.color[2] = (approach(self.color[2] as f32, tgt.cb as f32, dt, tau_color).round()
                as i32)
                .clamp(0, 255) as u8;
        }

        if self.auto.breath {
            self.breath_phase = (t * 2.0 * PI / 4.2).sin() * 0.5 + 0.5;
        } else {
            self.breath_phase = 0.5;
        }

        if self.auto.blink {
            if now >= self.next_blink {
                self.blink_mul = if self.blink_mul > 0.5 { 0.08 } else { 1.0 };
                let open_ms = if self.blink_mul > 0.5 {
                    self.rng_range(2200.0, 4200.0) as u64
                } else {
                    self.rng_range(90.0, 160.0) as u64
                };
                self.next_blink = now + Duration::from_millis(open_ms.max(40));
            }
        } else {
            self.blink_mul = 1.0;
        }

        if self.auto.saccade && now >= self.next_saccade {
            self.gaze_u = (self.gaze_u + self.rng_range(-0.06, 0.06)).rem_euclid(1.0);
            self.gaze_v = (self.gaze_v + self.rng_range(-0.04, 0.04)).clamp(0.08, 0.92);
            self.next_saccade = now + Duration::from_millis(self.rng_range(520.0, 1300.0) as u64);
        }

        if self.routine == IdleRoutine::Wander && now >= self.next_wander_step {
            let nudge = normalize3([
                self.wander_dir[0] + self.rng_range(-0.2, 0.2),
                self.wander_dir[1] + self.rng_range(-0.2, 0.2),
                self.wander_dir[2] + self.rng_range(-0.2, 0.2),
            ]);
            self.wander_dir = nudge;
            self.next_wander_step =
                now + Duration::from_millis(self.rng_range(280.0, 720.0) as u64);
        }

        let anchor = self.anchor_dir(t);
        let gdir = self.gaze_dir_world();
        let blended = slerp_dirs(anchor, gdir, self.gaze_pull);
        let q_tgt = look_quaternion_forward(blended);
        let k = (self.dynamics.stiffness
            * 0.12
            * self.mood.spring_mul()
            * (1.0 + self.dynamics.floatiness))
            .clamp(0.5, 24.0);
        let alpha = 1.0 - (-dt * k).exp();
        self.q_face = slerp_quat(self.q_face, q_tgt, alpha);

        let wmag = (self.omega[0] * self.omega[0]
            + self.omega[1] * self.omega[1]
            + self.omega[2] * self.omega[2])
            .sqrt();
        let damp = self.dynamics.damping.clamp(0.0, 0.999);
        self.omega[0] *= damp;
        self.omega[1] *= damp;
        self.omega[2] *= damp;
        if wmag > 1e-4 {
            let dq = [
                1.0,
                0.5 * dt * self.omega[0],
                0.5 * dt * self.omega[1],
                0.5 * dt * self.omega[2],
            ];
            self.q_face = quat_normalize(quat_mul(quat_normalize(dq), self.q_face));
        }

        self.orbit_phase += dt * 0.02;
    }

    pub fn apply_json_patch(&mut self, v: &Value) -> Result<(), String> {
        if let Some(mo) = v.get("mouthOpen").and_then(|x| x.as_f64()) {
            self.manual_mouth_open = Some((mo as f32).clamp(0.0, 1.0));
        }
        if v.get("clearMouthOpen").and_then(|x| x.as_bool()) == Some(true) {
            self.manual_mouth_open = None;
        }
        if let Some(s) = v.get("expression").and_then(|x| x.as_str()) {
            if let Some(e) = Expression::parse(s) {
                self.expression = e;
            }
        }
        if let Some(s) = v.get("mood").and_then(|x| x.as_str()) {
            if let Some(m) = Mood::parse(s) {
                self.mood = m;
            }
        }
        if v.get("useExpressionTint").and_then(|x| x.as_bool()) == Some(true) {
            self.color_override = None;
            let tgt = self.expression.target_channels();
            self.color = [tgt.cr, tgt.cg, tgt.cb];
        }
        if let Some(idle) = v.get("idle").and_then(|x| x.as_object()) {
            if let Some(r) = idle.get("routine").and_then(|x| x.as_str()) {
                if let Some(ir) = IdleRoutine::parse(r) {
                    self.routine = ir;
                }
            }
            if let Some(sp) = idle.get("speed").and_then(|x| x.as_f64()) {
                self.idle_speed = (sp as f32).clamp(0.02, 2.5);
            }
            if let Some(ax) = idle.get("axis").and_then(|x| x.as_array()) {
                if ax.len() == 3 {
                    let ox = ax[0].as_f64().unwrap_or(0.0) as f32;
                    let oy = ax[1].as_f64().unwrap_or(1.0) as f32;
                    let oz = ax[2].as_f64().unwrap_or(0.0) as f32;
                    self.orbit_axis = normalize3([ox, oy, oz]);
                }
            }
        }
        if let Some(g) = v.get("gaze").and_then(|x| x.as_object()) {
            if let Some(u) = g.get("u").and_then(|x| x.as_f64()) {
                self.gaze_u = (u as f32).clamp(0.0, 1.0);
            }
            if let Some(vv) = g.get("v").and_then(|x| x.as_f64()) {
                self.gaze_v = (vv as f32).clamp(0.0, 1.0);
            }
        }
        if let Some(gp) = v.get("gazePull").and_then(|x| x.as_f64()) {
            self.gaze_pull = (gp as f32).clamp(0.0, 1.0);
        }
        if let Some(c) = v.get("cluster").and_then(|x| x.as_f64()) {
            self.cluster = (c as f32).clamp(0.0, 1.0);
        }
        if let Some(d) = v.get("dynamics").and_then(|x| x.as_object()) {
            if let Some(x) = d.get("stiffness").and_then(|x| x.as_f64()) {
                self.dynamics.stiffness = (x as f32).clamp(0.5, 30.0);
            }
            if let Some(x) = d.get("damping").and_then(|x| x.as_f64()) {
                self.dynamics.damping = (x as f32).clamp(0.0, 0.999);
            }
            if let Some(x) = d.get("floatiness").and_then(|x| x.as_f64()) {
                self.dynamics.floatiness = (x as f32).clamp(0.0, 2.0);
            }
            if let Some(x) = d.get("trailLag").and_then(|x| x.as_f64()) {
                self.dynamics.trail_lag = (x as f32).clamp(0.0, 0.95);
            }
        }
        if let Some(ap) = v.get("appearance").and_then(|x| x.as_object()) {
            if ap.get("useExpressionTint").and_then(|x| x.as_bool()) == Some(true) {
                self.color_override = None;
                let tgt = self.expression.target_channels();
                self.color = [tgt.cr, tgt.cg, tgt.cb];
            }
            if let Some(c) = ap.get("color").and_then(|x| x.as_array()) {
                if c.len() >= 3 {
                    let r = c[0].as_u64().unwrap_or(200).min(255) as u8;
                    let g = c[1].as_u64().unwrap_or(240).min(255) as u8;
                    let b = c[2].as_u64().unwrap_or(255).min(255) as u8;
                    self.color_override = Some([r, g, b]);
                    self.color = [r, g, b];
                }
            }
            if let Some(b) = ap.get("brightness").and_then(|x| x.as_f64()) {
                self.brightness = (b as f32).clamp(0.0, 2.0);
            }
            if let Some(a) = ap.get("faceAngularRadiusDeg").and_then(|x| x.as_f64()) {
                self.face_angular_radius_deg = (a as f32).clamp(30.0, 85.0);
            }
            if let Some(a) = ap.get("featureScale").and_then(|x| x.as_f64()) {
                self.feature_scale = (a as f32).clamp(0.12, 0.65);
            }
            if let Some(a) = ap.get("eyeSpacing").and_then(|x| x.as_f64()) {
                self.eye_spacing = (a as f32).clamp(0.30, 0.75);
            }
            if let Some(fs) = ap.get("faceScale").and_then(|x| x.as_f64()) {
                if ap.get("faceAngularRadiusDeg").is_none() {
                    self.face_angular_radius_deg = (2.0 * (0.25 * fs as f32).atan())
                        .to_degrees()
                        .clamp(30.0, 85.0);
                }
            }
            if let Some(ps) = ap.get("partsScale").and_then(|x| x.as_f64()) {
                if ap.get("featureScale").is_none() {
                    self.feature_scale = (0.32 * ps as f32).clamp(0.12, 0.65);
                }
            }
        }
        if let Some(a) = v.get("auto").and_then(|x| x.as_object()) {
            if let Some(x) = a.get("breath").and_then(|x| x.as_bool()) {
                self.auto.breath = x;
            }
            if let Some(x) = a.get("blink").and_then(|x| x.as_bool()) {
                self.auto.blink = x;
            }
            if let Some(x) = a.get("saccade").and_then(|x| x.as_bool()) {
                self.auto.saccade = x;
            }
            if let Some(x) = a.get("tremor").and_then(|x| x.as_bool()) {
                self.auto.tremor = x;
            }
        }
        Ok(())
    }

    pub fn summary(&self) -> MateSummary {
        MateSummary {
            expression: self.expression.as_str().to_string(),
            mood: self.mood.as_str().to_string(),
            idle_routine: self.routine.as_str().to_string(),
            gaze_u: self.gaze_u,
            gaze_v: self.gaze_v,
            gaze_pull: self.gaze_pull,
            cluster: self.cluster,
            idle_speed: self.idle_speed,
            color: self.color,
            brightness: self.brightness,
            face_angular_radius_deg: self.face_angular_radius_deg,
            feature_scale: self.feature_scale,
            eye_spacing: self.eye_spacing,
            dynamics: self.dynamics,
            auto_breath: self.auto.breath,
            auto_blink: self.auto.blink,
            auto_saccade: self.auto.saccade,
            auto_tremor: self.auto.tremor,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MateSummary {
    pub expression: String,
    pub mood: String,
    pub idle_routine: String,
    pub gaze_u: f32,
    pub gaze_v: f32,
    pub gaze_pull: f32,
    pub cluster: f32,
    pub idle_speed: f32,
    pub color: [u8; 3],
    pub brightness: f32,
    pub face_angular_radius_deg: f32,
    pub feature_scale: f32,
    pub eye_spacing: f32,
    pub dynamics: DynamicsCfg,
    pub auto_breath: bool,
    pub auto_blink: bool,
    pub auto_saccade: bool,
    pub auto_tremor: bool,
}

/// 製品 `product-geodesic-2v-60`（1260 LED）の平均角ピッチに合わせたフェザー幅（ラジアン）。
fn product_feather_rad() -> f32 {
    const LED_COUNT: f32 = 1260.0;
    let led_angular = (4.0 * PI / LED_COUNT).sqrt();
    (2.5_f32.to_radians()).max(0.45 * led_angular)
}

struct FaceGeom {
    layout: f32,
    alpha_rad: f32,
    feather_rad: f32,
    feather_norm: f32,
    feature: f32,
    eye_ex: f32,
    eye_y: f32,
    brow_y: f32,
    mouth_y: f32,
}

impl FaceGeom {
    fn from_state(state: &MateState) -> Self {
        let alpha_rad = state.face_angular_radius_deg.to_radians();
        let layout = (alpha_rad * 0.5).tan();
        let feather_rad = product_feather_rad();
        let layout_safe = layout.max(1e-4);
        let feature = state.feature_scale;
        Self {
            layout,
            alpha_rad,
            feather_rad,
            feather_norm: feather_rad.tan().max(0.04) / layout_safe,
            feature,
            eye_ex: state.eye_spacing * 0.5,
            eye_y: 0.22,
            brow_y: 0.22 + feature * 0.52,
            mouth_y: -0.38,
        }
    }
}

#[inline]
fn sd_ellipse_norm(x: f32, y: f32, cx: f32, cy: f32, rx: f32, ry: f32) -> f32 {
    let dx = (x - cx) / rx.max(1e-4);
    let dy = (y - cy) / ry.max(1e-4);
    (dx * dx + dy * dy).sqrt() - 1.0
}

#[inline]
fn sd_circle_norm(x: f32, y: f32, cx: f32, cy: f32, r: f32) -> f32 {
    let dx = x - cx;
    let dy = y - cy;
    (dx * dx + dy * dy).sqrt() - r.max(1e-4)
}

/// 線分 ab 周りのカプセル SDF（半径 r）。
fn sd_capsule_seg(px: f32, py: f32, ax: f32, ay: f32, bx: f32, by: f32, r: f32) -> f32 {
    let pax = px - ax;
    let pay = py - ay;
    let bax = bx - ax;
    let bay = by - ay;
    let denom = bax * bax + bay * bay + 1e-8;
    let h = ((pax * bax + pay * bay) / denom).clamp(0.0, 1.0);
    let dx = pax - bax * h;
    let dy = pay - bay * h;
    (dx * dx + dy * dy).sqrt() - r.max(1e-4)
}

fn sd_rounded_x_capsule_norm(x: f32, y: f32, half_w: f32, half_h: f32, curve: f32) -> f32 {
    let yy = y + curve * (x / half_w.max(1e-4)).clamp(-1.0, 1.0) * half_h * 0.5;
    let px = x.abs() - half_w;
    let py = yy.abs() - half_h;
    let qx = px.max(0.0);
    let qy = py.max(0.0);
    let outside = (qx * qx + qy * qy).sqrt();
    let inside = px.max(py).min(0.0);
    outside + inside
}

#[inline]
fn sdf_to_weight(d: f32, edge: f32, feather: f32) -> f32 {
    smooth01((-d - edge) / feather.max(1e-4))
}

pub fn render_mate_face(state: &MateState, uv: &[(f32, f32)], rgb: &mut [u8]) {
    if uv.len() * 3 != rgb.len() {
        return;
    }
    let mut acc = vec![0f32; rgb.len()];
    let q = quat_normalize(state.q_face);
    let geom = FaceGeom::from_state(state);
    let g_world = state.gaze_dir_world();
    let g_local = normalize3(rotate_vec_world_to_local(q, g_world));
    let cluster_s = g_local[0] * state.cluster * geom.layout * 0.07;
    let cluster_t = g_local[1] * state.cluster * geom.layout * 0.07;
    let breath_t = (state.breath_phase - 0.5) * geom.layout * 0.04;
    let trem = if state.auto.tremor || state.cur_tremor > 0.05 {
        state.cur_tremor * 0.009 * geom.layout * ((state.breath_phase * 37.0).sin())
    } else {
        0.0
    };

    let eye_open = (state.cur_eye_open * state.blink_mul).clamp(0.06, 1.0);
    let feature = geom.feature;
    let sclera_rx = feature * 0.44 * eye_open;
    let sclera_ry = feature * 0.40 * eye_open;
    let pupil_r = feature * 0.17 * eye_open.sqrt();
    let brow_r = feature * 0.125;
    let mouth_w = state.cur_mouth_width * feature * 1.02;
    let mouth_h = (0.058 + state.cur_mouth_open * 0.16) * feature;
    let curve = state.cur_eye_curve;
    let pull = state.gaze_pull;
    let pupil_ox = g_local[0] * feature * 0.32 * (1.0 - pull * 0.6);
    let pupil_oy = g_local[1] * feature * 0.28 * (1.0 - pull * 0.6);

    let pr = (state.color[0] as f32 * state.brightness).round() as u8;
    let pg = (state.color[1] as f32 * state.brightness).round() as u8;
    let pb = (state.color[2] as f32 * state.brightness).round() as u8;
    let cheek_r = (pr as f32 * 0.72 + 24.0).round() as u8;
    let cheek_g = (pg as f32 * 0.58 + 12.0).round() as u8;
    let cheek_b = (pb as f32 * 0.55 + 8.0).round() as u8;
    let cheek_strength = state.cur_cheek_flush;

    let feather = geom.feather_norm;
    let brow_tilt = curve * feature * 0.22;

    for (i, &(u, v)) in uv.iter().enumerate() {
        let n = unit_dir_from_equirect_uv_y_up(u, v);
        let nl = rotate_vec_world_to_local(q, n);
        if nl[2] < 0.0 {
            continue;
        }
        let cos_theta = nl[2].clamp(-1.0, 1.0);
        let theta = cos_theta.acos();
        if theta > geom.alpha_rad + geom.feather_rad {
            continue;
        }

        let inv = 1.0 / (1.0 + nl[2]).max(1e-4);
        let s = nl[0] * inv * geom.layout + cluster_s + trem;
        let t = nl[1] * inv * geom.layout + cluster_t + breath_t + trem * 0.7;
        let mut nx = s / geom.layout;
        let mut ny = t / geom.layout;
        let melt = state.cur_melt;
        nx *= 1.0 - melt * 0.12;
        ny += melt * 0.08 * nx.abs();

        let mut acc_i = 0.0f32;
        let mut cheek_w_max = 0.0f32;

        if cheek_strength > 0.02 {
            let cheek_y = geom.eye_y - feature * 0.38;
            let cheek_x = geom.eye_ex + feature * 0.28;
            let cheek_rx = feature * 0.24;
            let cheek_ry = feature * 0.18;
            for side in [-1.0f32, 1.0] {
                let d_cheek = sd_ellipse_norm(nx, ny, side * cheek_x, cheek_y, cheek_rx, cheek_ry);
                let w_cheek = sdf_to_weight(d_cheek, 0.02, feather * 1.1) * cheek_strength;
                cheek_w_max = cheek_w_max.max(w_cheek);
                acc_i = acc_i.max(w_cheek * 0.38);
            }
        }

        for side in [-1.0f32, 1.0] {
            let cx = side * geom.eye_ex;
            let cy = geom.eye_y;
            let mut d_sclera = sd_ellipse_norm(nx, ny, cx, cy, sclera_rx, sclera_ry);
            if curve > 0.1 {
                d_sclera += curve * 0.30 * (ny - cy - sclera_ry * 0.15).max(0.0);
            } else if curve < -0.1 {
                d_sclera -= curve * 0.30 * (ny - cy + sclera_ry * 0.12).max(0.0);
            }
            let w_sclera = sdf_to_weight(d_sclera, 0.012, feather);
            acc_i = acc_i.max(w_sclera * 0.82);

            let pcx = cx + pupil_ox;
            let pcy = cy + pupil_oy;
            let d_pupil = sd_circle_norm(nx, ny, pcx, pcy, pupil_r);
            let w_pupil = sdf_to_weight(d_pupil, 0.008, feather * 0.85);
            acc_i = acc_i.max(w_pupil * 1.0);

            let hcx = pcx - pupil_r * 0.35;
            let hcy = pcy + pupil_r * 0.30;
            let d_hi = sd_circle_norm(nx, ny, hcx, hcy, pupil_r * 0.28);
            let w_hi = sdf_to_weight(d_hi, 0.004, feather * 0.7);
            acc_i = acc_i.max(w_hi * 1.12);
        }

        let brow_lx = -geom.eye_ex - feature * 0.08;
        let brow_rx = geom.eye_ex + feature * 0.08;
        let brow_ly = geom.brow_y + brow_tilt;
        let brow_ry = geom.brow_y - brow_tilt;
        let d_brow = sd_capsule_seg(nx, ny, brow_lx, brow_ly, brow_rx, brow_ry, brow_r);
        let w_brow = sdf_to_weight(d_brow, 0.010, feather * 1.05);
        acc_i = acc_i.max(w_brow * 0.92);

        let mx = nx;
        let my = ny - geom.mouth_y;
        let mut d_m =
            sd_rounded_x_capsule_norm(mx, my, mouth_w, mouth_h, state.cur_mouth_curve * 0.10);
        d_m -= state.cur_mouth_open * 0.012;
        let w_mouth = sdf_to_weight(d_m, 0.014, feather * 1.05);
        acc_i = acc_i.max(w_mouth * 0.95);

        if acc_i > 1e-4 {
            let (tr, tg, tb) = if cheek_w_max > 0.12 {
                (cheek_r, cheek_g, cheek_b)
            } else {
                (pr, pg, pb)
            };
            add_tinted_to_accum(&mut acc, i, acc_i, tr, tg, tb);
        }
    }
    let out = finalize_black_base(&acc);
    rgb.copy_from_slice(&out);
}

pub fn tick_and_render_mate(
    slot: &DeviceSlot,
    compiled_dir: &std::path::Path,
    loop_start: Instant,
    now: Instant,
    dt: f32,
    rgb: &mut [u8],
) {
    let Ok(mut guard) = slot.mate_state.write() else {
        rgb.fill(0);
        return;
    };
    let loop_t = loop_start.elapsed().as_secs_f32();
    guard.tick(dt, loop_t, now);
    let st = guard.clone();
    drop(guard);

    let layout_id = slot
        .state
        .try_read()
        .ok()
        .map(|s| s.layout_id.clone())
        .unwrap_or_default();
    let led_count = rgb.len() / 3;
    if let Err(e) = slot.ensure_interactive_uv(compiled_dir, &layout_id, led_count) {
        tracing::warn!("mate: ensure_interactive_uv: {e:#}");
        rgb.fill(0);
        return;
    }

    let uv_lock = slot.interactive_uv.read().ok();
    let Some(uv) = uv_lock.as_ref().and_then(|g| g.as_ref()) else {
        rgb.fill(0);
        return;
    };
    if uv.len() * 3 != rgb.len() {
        rgb.fill(0);
        return;
    }
    render_mate_face(&st, uv, rgb);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::path::PathBuf;

    fn product_uv() -> Vec<(f32, f32)> {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../assets/compiled/product-geodesic-2v-60.ledmap.json");
        let raw = std::fs::read_to_string(&path).expect("product ledmap");
        let v: Value = serde_json::from_str(&raw).expect("ledmap json");
        v["leds"]
            .as_array()
            .expect("leds array")
            .iter()
            .map(|led| {
                let u = led["u"].as_f64().unwrap() as f32;
                let vv = led["v"].as_f64().unwrap() as f32;
                (u, vv)
            })
            .collect()
    }

    fn count_lit(rgb: &[u8]) -> usize {
        rgb.chunks_exact(3)
            .filter(|px| px[0] > 8 || px[1] > 8 || px[2] > 8)
            .count()
    }

    #[test]
    fn product_parts_only_light_up() {
        let uv = product_uv();
        assert_eq!(uv.len(), 1260);
        let mut state = MateState::default();
        state.q_face = [1.0, 0.0, 0.0, 0.0];
        state.blink_mul = 1.0;
        state.cur_eye_open = 1.0;
        let mut rgb = vec![0u8; uv.len() * 3];
        render_mate_face(&state, &uv, &mut rgb);
        let lit = count_lit(&rgb);
        assert!(
            lit >= 45 && lit <= 200,
            "expected parts-only lighting (no canvas fill), got {lit} lit LEDs"
        );
    }

    #[test]
    fn product_eyes_have_enough_leds() {
        let uv = product_uv();
        let mut state = MateState::default();
        state.q_face = [1.0, 0.0, 0.0, 0.0];
        state.blink_mul = 1.0;
        state.cur_eye_open = 1.0;
        let mut rgb = vec![0u8; uv.len() * 3];
        render_mate_face(&state, &uv, &mut rgb);
        let geom = FaceGeom::from_state(&state);
        let feature = geom.feature;
        let sclera_rx = feature * 0.44;
        let sclera_ry = feature * 0.40;
        let mut left_eye = 0usize;
        let mut right_eye = 0usize;
        for (i, &(u, vv)) in uv.iter().enumerate() {
            let n = unit_dir_from_equirect_uv_y_up(u, vv);
            let nl = rotate_vec_world_to_local(state.q_face, n);
            if nl[2] < 0.0 {
                continue;
            }
            let inv = 1.0 / (1.0 + nl[2]).max(1e-4);
            let nx = nl[0] * inv;
            let ny = nl[1] * inv;
            let o = i * 3;
            if rgb[o] < 12 && rgb[o + 1] < 12 && rgb[o + 2] < 12 {
                continue;
            }
            let dl = sd_ellipse_norm(nx, ny, -geom.eye_ex, geom.eye_y, sclera_rx, sclera_ry);
            let dr = sd_ellipse_norm(nx, ny, geom.eye_ex, geom.eye_y, sclera_rx, sclera_ry);
            if dl < 0.15 {
                left_eye += 1;
            }
            if dr < 0.15 {
                right_eye += 1;
            }
        }
        assert!(
            left_eye >= 20 && right_eye >= 20,
            "expected >=20 LEDs per sclera, got L={left_eye} R={right_eye}"
        );
    }
}
