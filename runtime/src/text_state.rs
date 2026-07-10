//! Per-device text mode runtime state (content, flow params, glyph ribbon cache).
//!
//! テキストは帯中心（`yawDeg` / `pitchDeg`）の正面を中心に、真裏の継ぎ目から出現・消失する
//! 帯として球面に流す。色は各 LED の yaw 適用済み `(u,v)` から生成するため、frontYawDeg
//! に自動追従する。真裏付近は明るさフェードで背景色に戻す。

use std::f32::consts::PI;
use std::sync::RwLock as StdRwLock;
use std::time::Instant;

use fontdue::layout::{CoordinateSystem, Layout, LayoutSettings, TextStyle};
use fontdue::Font;

use crate::orientation;
use crate::sphere;

/// リボン画素高（固定）。`text_size_deg` はサンプリング時の度→画素換算にのみ使う。
const RIBBON_HEIGHT_PX: usize = 64;
/// リボン上下の余白（グリフが縁で切れないように）。
const RIBBON_PAD_Y_PX: f32 = 6.0;

pub const TEXT_SIZE_DEG_MIN: f32 = 10.0;
pub const TEXT_SIZE_DEG_MAX: f32 = 180.0;
pub const SPEED_DEG_PER_SEC_MIN: f32 = -360.0;
pub const SPEED_DEG_PER_SEC_MAX: f32 = 360.0;
pub const YAW_DEG_MIN: f32 = -180.0;
pub const YAW_DEG_MAX: f32 = 180.0;
pub const PITCH_DEG_MIN: f32 = -80.0;
pub const PITCH_DEG_MAX: f32 = 80.0;
pub const ROLL_DEG_MIN: f32 = -180.0;
pub const ROLL_DEG_MAX: f32 = 180.0;
/// フェード開始/終了角（真裏からの経度、度）。0=真裏。
pub const FADE_ANGLE_DEG_MIN: f32 = 0.0;
pub const FADE_ANGLE_DEG_MAX: f32 = 180.0;
/// 文字の太さ（リボン被覆のダイレーション量。小数可）。
pub const THICKNESS_MIN: f32 = 0.0;
pub const THICKNESS_MAX: f32 = 6.0;
/// 次ループ開始までのインターバル（秒）。全文字が流れ切ってから空白を挟む。
pub const LOOP_INTERVAL_SEC_MIN: f32 = 0.0;
pub const LOOP_INTERVAL_SEC_MAX: f32 = 30.0;

#[derive(Debug, Clone)]
pub struct TextParams {
    pub content: String,
    pub text_size_deg: f32,
    pub speed_deg_per_sec: f32,
    /// Band mid-front orientation: RH yaw about +Y (deg).
    pub yaw_deg: f32,
    /// Band mid-front elevation toward +Y (deg).
    pub pitch_deg: f32,
    /// Twist about band-center outward axis (deg, RH).
    pub roll_deg: f32,
    /// 真裏からの経度で、この角度まで明るさ 0（背景色）。
    pub fade_start_deg: f32,
    /// 真裏からの経度で、この角度で明るさ最大（文字色）。start→end で線形にグラデーション。
    pub fade_end_deg: f32,
    /// 文字の太さ（リボン被覆のダイレーション量。小数可、0 で素の字形）。
    pub thickness: f32,
    /// 次ループ開始までのインターバル（秒）。全文字が流れ切ってから空白を挟む。
    pub loop_interval_sec: f32,
    pub bg_color: [u8; 3],
    pub text_color: [u8; 3],
}

impl Default for TextParams {
    fn default() -> Self {
        Self {
            content: "Hello, World. This is Glowbe, a spherical display created by Yutar0xff."
                .to_string(),
            text_size_deg: 130.0,
            speed_deg_per_sec: 150.0,
            yaw_deg: 0.0,
            pitch_deg: 15.0,
            roll_deg: 0.0,
            fade_start_deg: 0.0,
            fade_end_deg: 120.0,
            thickness: 1.0,
            loop_interval_sec: 2.0,
            bg_color: [0, 0, 0],
            text_color: [59, 130, 246],
        }
    }
}

impl TextParams {
    #[must_use]
    pub fn clamped(mut self) -> Self {
        self.text_size_deg = self
            .text_size_deg
            .clamp(TEXT_SIZE_DEG_MIN, TEXT_SIZE_DEG_MAX);
        self.speed_deg_per_sec = self
            .speed_deg_per_sec
            .clamp(SPEED_DEG_PER_SEC_MIN, SPEED_DEG_PER_SEC_MAX);
        self.yaw_deg = self.yaw_deg.clamp(YAW_DEG_MIN, YAW_DEG_MAX);
        self.pitch_deg = self.pitch_deg.clamp(PITCH_DEG_MIN, PITCH_DEG_MAX);
        self.roll_deg = self.roll_deg.clamp(ROLL_DEG_MIN, ROLL_DEG_MAX);
        self.fade_start_deg = self
            .fade_start_deg
            .clamp(FADE_ANGLE_DEG_MIN, FADE_ANGLE_DEG_MAX);
        self.fade_end_deg = self
            .fade_end_deg
            .clamp(FADE_ANGLE_DEG_MIN, FADE_ANGLE_DEG_MAX);
        self.thickness = self.thickness.clamp(THICKNESS_MIN, THICKNESS_MAX);
        self.loop_interval_sec = self
            .loop_interval_sec
            .clamp(LOOP_INTERVAL_SEC_MIN, LOOP_INTERVAL_SEC_MAX);
        self
    }
}

struct Ribbon {
    content: String,
    thickness: f32,
    width_px: usize,
    height_px: usize,
    /// `width_px * height_px` のグレースケール被覆（0..255）。
    cov: Vec<u8>,
}

/// サンプル表の再計算要否を判定するキャッシュキー。float は `to_bits` で厳密比較する。
#[derive(Clone, PartialEq)]
struct SamplesKey {
    layout_id: String,
    led_count: usize,
    front_yaw_bits: u32,
    yaw_bits: u32,
    pitch_bits: u32,
    roll_bits: u32,
}

impl SamplesKey {
    fn new(
        layout_id: &str,
        led_count: usize,
        front_yaw_deg: f32,
        yaw_deg: f32,
        pitch_deg: f32,
        roll_deg: f32,
    ) -> Self {
        Self {
            layout_id: layout_id.to_string(),
            led_count,
            front_yaw_bits: f32::to_bits(front_yaw_deg),
            yaw_bits: f32::to_bits(yaw_deg),
            pitch_bits: f32::to_bits(pitch_deg),
            roll_bits: f32::to_bits(roll_deg),
        }
    }
}

struct TextSamples {
    key: SamplesKey,
    /// LED ごと: (`s` = 真裏起点の経度 0..1、`t_deg` = 帯中心からの緯度オフセット度)。
    per_led: Vec<(f32, f32)>,
}

pub struct TextRuntimeState {
    params: StdRwLock<TextParams>,
    ribbon: StdRwLock<Option<Ribbon>>,
    samples: StdRwLock<Option<TextSamples>>,
    /// スクロール原点。text モードへ切り替えたときに now へリセットして先頭から流す。
    origin: StdRwLock<Instant>,
}

impl Default for TextRuntimeState {
    fn default() -> Self {
        Self::new()
    }
}

impl TextRuntimeState {
    pub fn new() -> Self {
        Self {
            params: StdRwLock::new(TextParams::default()),
            ribbon: StdRwLock::new(None),
            samples: StdRwLock::new(None),
            origin: StdRwLock::new(Instant::now()),
        }
    }

    /// スクロール原点を現在時刻に戻す（先頭の文字から表示し直す）。
    pub fn restart(&self, now: Instant) {
        if let Ok(mut g) = self.origin.write() {
            *g = now;
        }
    }

    pub fn params(&self) -> TextParams {
        self.params.read().map(|g| g.clone()).unwrap_or_default()
    }

    pub fn set_params(&self, params: TextParams) {
        if let Ok(mut g) = self.params.write() {
            *g = params.clamped();
        }
    }

    pub fn clear_samples(&self) {
        if let Ok(mut g) = self.samples.write() {
            *g = None;
        }
    }

    fn ensure_ribbon(&self, font: &Font, content: &str, thickness: f32) {
        if let Ok(g) = self.ribbon.read() {
            if g.as_ref()
                .is_some_and(|r| r.content == content && r.thickness == thickness)
            {
                return;
            }
        }
        let ribbon = build_ribbon(font, content, thickness);
        if let Ok(mut g) = self.ribbon.write() {
            *g = Some(ribbon);
        }
    }

    fn ensure_samples(
        &self,
        layout_uv: &[(f32, f32)],
        layout_id: &str,
        front_yaw_deg: f32,
        yaw_deg: f32,
        pitch_deg: f32,
        roll_deg: f32,
    ) {
        let want = SamplesKey::new(
            layout_id,
            layout_uv.len(),
            front_yaw_deg,
            yaw_deg,
            pitch_deg,
            roll_deg,
        );
        if let Ok(g) = self.samples.read() {
            if g.as_ref().is_some_and(|c| c.key == want) {
                return;
            }
        }
        let per_led = compute_samples(layout_uv, yaw_deg, pitch_deg, roll_deg);
        if let Ok(mut g) = self.samples.write() {
            *g = Some(TextSamples { key: want, per_led });
        }
    }

    /// text モードの 1 フレーム描画。`font` が `None`／空文字なら背景色のみ。
    /// スクロール量は `now` と原点（`restart` でリセット）の差から算出する。
    pub fn render(
        &self,
        font: Option<&Font>,
        layout_uv: &[(f32, f32)],
        layout_id: &str,
        front_yaw_deg: f32,
        now: Instant,
        out_rgb: &mut [u8],
    ) {
        let params = self.params();
        for px in out_rgb.chunks_exact_mut(3) {
            px.copy_from_slice(&params.bg_color);
        }
        let Some(font) = font else {
            return;
        };
        if params.content.is_empty() {
            return;
        }
        self.ensure_ribbon(font, &params.content, params.thickness);
        self.ensure_samples(
            layout_uv,
            layout_id,
            front_yaw_deg,
            params.yaw_deg,
            params.pitch_deg,
            params.roll_deg,
        );

        let (Ok(ribbon_g), Ok(samples_g)) = (self.ribbon.read(), self.samples.read()) else {
            return;
        };
        let (Some(ribbon), Some(samples)) = (ribbon_g.as_ref(), samples_g.as_ref()) else {
            return;
        };
        if ribbon.width_px == 0 {
            return;
        }

        let size_deg = params.text_size_deg.max(1.0);
        let h = ribbon.height_px as f32;
        let p = h / size_deg;
        let ribbon_width_deg = ribbon.width_px as f32 / p;
        // スクロール周期。文字列全長のあとにインターバル分の空白を足し、周長(360°)を下限にして
        // 自身との重なりを防ぐ（全文字が流れ切ってから空白を挟み先頭が再登場する）。
        // インターバルは秒指定なので、走査速度で角度に換算する。
        let gap_deg = params.loop_interval_sec.max(0.0) * params.speed_deg_per_sec.abs();
        let period_deg = (ribbon_width_deg + gap_deg).max(360.0);
        let elapsed = {
            let origin = self.origin.read().map(|g| *g).unwrap_or(now);
            now.saturating_duration_since(origin).as_secs_f32()
        };
        // 原点リセット直後（elapsed=0）に先頭文字 (phase 0) が裏側の継ぎ目に来て fade in を
        // 開始するよう、スクロールに初期オフセットを与える。
        let scroll0_deg = initial_scroll_offset_deg(period_deg, params.speed_deg_per_sec);
        let scroll_deg = scroll0_deg + elapsed * params.speed_deg_per_sec;
        let fade_lo = params.fade_start_deg.min(params.fade_end_deg);
        let fade_hi = params.fade_start_deg.max(params.fade_end_deg);

        for (i, &(s, t_deg)) in samples.per_led.iter().enumerate() {
            let o = i * 3;
            if o + 3 > out_rgb.len() {
                break;
            }
            if t_deg.abs() > size_deg * 0.5 {
                continue;
            }
            let a_deg = s * 360.0;
            let phase_deg = (a_deg + scroll_deg).rem_euclid(period_deg);
            if phase_deg >= ribbon_width_deg {
                continue;
            }
            let x_px = phase_deg * p;
            let y_px = (0.5 - t_deg / size_deg) * h;
            let cov = sample_ribbon_bilinear(ribbon, x_px, y_px);
            if cov <= 0.0 {
                continue;
            }
            let fade =
                smoothstep(fade_lo, fade_hi, a_deg) * smoothstep(fade_lo, fade_hi, 360.0 - a_deg);
            let lit = cov * fade;
            if lit <= 0.0 {
                continue;
            }
            for c in 0..3 {
                out_rgb[o + c] = blend_channel(params.bg_color[c], params.text_color[c], lit);
            }
        }
    }
}

fn build_ribbon(font: &Font, content: &str, thickness: f32) -> Ribbon {
    let height_px = RIBBON_HEIGHT_PX;
    if content.is_empty() {
        return Ribbon {
            content: String::new(),
            thickness,
            width_px: 0,
            height_px,
            cov: Vec::new(),
        };
    }
    // フォントの行ボックス（ascent−descent+line_gap）が余白込みで H に収まるグリフサイズを選ぶ。
    // 固定サイズだとディセンダや全角グリフ下端がブリット時に見切れるため。
    let usable = (height_px as f32 - 2.0 * RIBBON_PAD_Y_PX).max(1.0);
    let ref_px = 100.0f32;
    let line_ratio = font
        .horizontal_line_metrics(ref_px)
        .map(|m| m.new_line_size / ref_px)
        .filter(|r| *r > 0.0)
        .unwrap_or(1.35);
    let glyph_px = (usable / line_ratio).max(1.0);
    let mut layout = Layout::new(CoordinateSystem::PositiveYDown);
    layout.reset(&LayoutSettings {
        x: 0.0,
        y: RIBBON_PAD_Y_PX,
        ..LayoutSettings::default()
    });
    layout.append(&[font], &TextStyle::new(content, glyph_px, 0));

    let glyphs = layout.glyphs();
    let mut width = 0f32;
    for g in glyphs {
        width = width.max(g.x + g.width as f32);
    }
    let width_px = (width.ceil() as usize).max(1);
    let mut cov = vec![0u8; width_px * height_px];
    for g in glyphs {
        if g.width == 0 || g.height == 0 {
            continue;
        }
        let (_, bitmap) = font.rasterize_config(g.key);
        for gy in 0..g.height {
            for gx in 0..g.width {
                let a = bitmap[gy * g.width + gx];
                if a == 0 {
                    continue;
                }
                let px = g.x as isize + gx as isize;
                let py = g.y as isize + gy as isize;
                if px < 0 || py < 0 || px as usize >= width_px || py as usize >= height_px {
                    continue;
                }
                let i = py as usize * width_px + px as usize;
                cov[i] = cov[i].max(a);
            }
        }
    }
    let cov = apply_thickness(cov, width_px, height_px, thickness);
    Ribbon {
        content: content.to_string(),
        thickness,
        width_px,
        height_px,
        cov,
    }
}

/// 太さ適用。整数半径のダイレーションを行い、小数部は半径 `r` と `r+1` を線形補間する。
fn apply_thickness(cov: Vec<u8>, w: usize, h: usize, thickness: f32) -> Vec<u8> {
    if thickness <= 0.0 || w == 0 || h == 0 {
        return cov;
    }
    let r0 = thickness.floor() as usize;
    let frac = thickness - r0 as f32;
    if frac <= 1e-3 {
        return dilate(&cov, w, h, r0);
    }
    let a = dilate(&cov, w, h, r0);
    let b = dilate(&cov, w, h, r0 + 1);
    a.iter()
        .zip(b.iter())
        .map(|(&x, &y)| {
            (f32::from(x) + (f32::from(y) - f32::from(x)) * frac)
                .round()
                .clamp(0.0, 255.0) as u8
        })
        .collect()
}

/// 分離型 max フィルタ（半径 `r` の四角形ダイレーション）で文字を太らせた新しい被覆を返す。
fn dilate(src: &[u8], w: usize, h: usize, r: usize) -> Vec<u8> {
    if r == 0 || w == 0 || h == 0 {
        return src.to_vec();
    }
    let mut tmp = vec![0u8; w * h];
    for y in 0..h {
        let row = &src[y * w..y * w + w];
        let out = &mut tmp[y * w..y * w + w];
        for (x, o) in out.iter_mut().enumerate() {
            let x0 = x.saturating_sub(r);
            let x1 = (x + r).min(w - 1);
            *o = row[x0..=x1].iter().copied().max().unwrap_or(0);
        }
    }
    let mut out = vec![0u8; w * h];
    for y in 0..h {
        let y0 = y.saturating_sub(r);
        let y1 = (y + r).min(h - 1);
        for x in 0..w {
            let mut m = 0u8;
            for yi in y0..=y1 {
                m = m.max(tmp[yi * w + x]);
            }
            out[y * w + x] = m;
        }
    }
    out
}

/// 各 LED の yaw 適用済み `(u,v)` から、帯中心原点の `(s, t_deg)` を求める。
///
/// 帯中心方向 `c = yaw/pitch`、接平面の east/north に `rollDeg` を掛けたフレームで:
/// - `s = atan2(east·d, c·d)/(2π) + 0.5`（中心で 0.5、真裏で継ぎ目）
/// - `t_deg = asin(north·d)`（度、帯高さ方向）
fn compute_samples(
    layout_uv: &[(f32, f32)],
    yaw_deg: f32,
    pitch_deg: f32,
    roll_deg: f32,
) -> Vec<(f32, f32)> {
    let c = orientation::unit_dir_from_yaw_pitch_deg(yaw_deg, pitch_deg);
    let (e0, n0) = orientation::tangent_east_north(c);
    let (east, north) = orientation::roll_tangent_basis(e0, n0, roll_deg);
    layout_uv
        .iter()
        .map(|&(u, v)| {
            let d = sphere::unit_dir_from_equirect_uv_y_up(u, v);
            let x = d[0] * east[0] + d[1] * east[1] + d[2] * east[2];
            let y = d[0] * north[0] + d[1] * north[1] + d[2] * north[2];
            let z = d[0] * c[0] + d[1] * c[1] + d[2] * c[2];
            let s = (x.atan2(z) / (2.0 * PI) + 0.5).rem_euclid(1.0);
            let t_deg = y.clamp(-1.0, 1.0).asin().to_degrees();
            (s, t_deg)
        })
        .collect()
}

fn sample_ribbon_bilinear(ribbon: &Ribbon, x: f32, y: f32) -> f32 {
    let w = ribbon.width_px;
    let h = ribbon.height_px;
    if w == 0 || h == 0 {
        return 0.0;
    }
    let x = x.clamp(0.0, w as f32 - 1.0);
    let y = y.clamp(0.0, h as f32 - 1.0);
    let x0 = x.floor() as usize;
    let y0 = y.floor() as usize;
    let x1 = (x0 + 1).min(w - 1);
    let y1 = (y0 + 1).min(h - 1);
    let fx = x - x0 as f32;
    let fy = y - y0 as f32;
    let at = |xi: usize, yi: usize| f32::from(ribbon.cov[yi * w + xi]) / 255.0;
    let top = at(x0, y0) * (1.0 - fx) + at(x1, y0) * fx;
    let bot = at(x0, y1) * (1.0 - fx) + at(x1, y1) * fx;
    top * (1.0 - fy) + bot * fy
}

/// 背景色 `bg` と文字色 `fg` を明るさ `t`（0..1）で線形補間した 1 チャンネル値。
fn blend_channel(bg: u8, fg: u8, t: f32) -> u8 {
    let bg = f32::from(bg);
    let fg = f32::from(fg);
    (bg + (fg - bg) * t).round().clamp(0.0, 255.0) as u8
}

/// 先頭文字を裏側の継ぎ目（fade 開始点）に置くためのスクロール初期オフセット（度）。
/// 順方向 (speed>=0) は先頭が a_deg=360 側から、逆方向は a_deg=0 側から流入する。
fn initial_scroll_offset_deg(period_deg: f32, speed_deg_per_sec: f32) -> f32 {
    if speed_deg_per_sec >= 0.0 {
        period_deg - 360.0
    } else {
        0.0
    }
}

fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    if edge0 == edge1 {
        return if x < edge0 { 0.0 } else { 1.0 };
    }
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn load_font() -> Font {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../assets/text/NotoSansJP.ttf");
        let bytes = std::fs::read(&path).expect("read font");
        Font::from_bytes(bytes.as_slice(), fontdue::FontSettings::default()).expect("parse font")
    }

    #[test]
    fn ribbon_has_coverage_for_ascii_and_japanese() {
        let font = load_font();
        let ribbon = build_ribbon(&font, "A球", 0.0);
        assert!(ribbon.width_px > 0, "ribbon width should be > 0");
        let nonzero = ribbon.cov.iter().filter(|&&c| c > 0).count();
        assert!(nonzero > 0, "ribbon should have some coverage");
    }

    #[test]
    fn empty_content_yields_zero_width() {
        let font = load_font();
        let ribbon = build_ribbon(&font, "", 0.0);
        assert_eq!(ribbon.width_px, 0);
    }

    #[test]
    fn descenders_are_not_clipped_at_bottom_edge() {
        let font = load_font();
        let ribbon = build_ribbon(&font, "gjpqy", 0.0);
        let w = ribbon.width_px;
        let h = ribbon.height_px;
        assert!(w > 0 && h > 0);
        let row_has_ink = |row: usize| ribbon.cov[row * w..row * w + w].iter().any(|&c| c > 0);
        assert!(
            !row_has_ink(h - 1),
            "bottom edge row must stay blank (no clip)"
        );
        let lower_ink = (h / 2..h).any(row_has_ink);
        assert!(lower_ink, "descenders should render in the lower half");
    }

    #[test]
    fn thickness_increases_coverage() {
        let font = load_font();
        let thin = build_ribbon(&font, "A", 0.0);
        let bold = build_ribbon(&font, "A", 3.0);
        let thin_n = thin.cov.iter().filter(|&&c| c > 0).count();
        let bold_n = bold.cov.iter().filter(|&&c| c > 0).count();
        assert!(
            bold_n > thin_n,
            "thickness should dilate coverage ({bold_n} > {thin_n})"
        );
    }

    #[test]
    fn front_maps_to_mid_band_at_zero_orientation() {
        let samples = compute_samples(&[(0.5, 0.5)], 0.0, 0.0, 0.0);
        let (s, t) = samples[0];
        assert!((s - 0.5).abs() < 1e-3, "front s should be ~0.5, got {s}");
        assert!(t.abs() < 1e-2, "front t_deg should be ~0, got {t}");
    }

    #[test]
    fn back_stays_on_flow_seam() {
        let b = compute_samples(&[(0.0, 0.5)], 0.0, 0.0, 0.0)[0].0;
        assert!(b.min(1.0 - b) < 1e-3, "back s should stay at seam, got {b}");
    }

    #[test]
    fn pitch_moves_equator_point_off_band_center() {
        let (s, t) = compute_samples(&[(0.5, 0.5)], 0.0, 30.0, 0.0)[0];
        assert!((s - 0.5).abs() < 1e-3, "front s should stay ~0.5, got {s}");
        assert!(
            (t + 30.0).abs() < 0.5,
            "equator front should be ~−pitch in band frame, got {t}"
        );
    }

    #[test]
    fn yaw_keeps_front_u_at_mid_s() {
        // Content at u matching yaw-shifted front still maps to s=0.5.
        let (u, _) = orientation::uv_from_yaw_pitch_deg(45.0, 0.0);
        let (s, t) = compute_samples(&[(u, 0.5)], 45.0, 0.0, 0.0)[0];
        assert!(
            (s - 0.5).abs() < 1e-3,
            "yawed front s should be 0.5, got {s}"
        );
        assert!(t.abs() < 1e-2, "yawed front t should be ~0, got {t}");
    }

    #[test]
    fn roll_changes_mapping() {
        let a = compute_samples(&[(0.6, 0.45)], 0.0, 0.0, 0.0)[0];
        let b = compute_samples(&[(0.6, 0.45)], 0.0, 0.0, 45.0)[0];
        let d = (a.0 - b.0).abs() + (a.1 - b.1).abs();
        assert!(d > 1e-2, "roll should change mapping, diff={d}");
    }

    #[test]
    fn frame_zero_places_head_at_back_seam() {
        for &(period, speed, want) in &[
            (720.0f32, 150.0f32, 360.0f32),
            (360.0, 150.0, 0.0),
            (720.0, -150.0, 0.0),
        ] {
            let scroll0 = initial_scroll_offset_deg(period, speed);
            let head_a_deg = (-scroll0).rem_euclid(period);
            assert!(
                (head_a_deg - want).abs() < 1e-3,
                "period={period} speed={speed}: head a_deg {head_a_deg} != {want}"
            );
        }
    }
}
