//! Per-device text mode runtime state (content, flow params, glyph ribbon cache).
//!
//! テキストは正面 (`u=0.5`) を中心に、真裏 (`u=0.0/1.0` の継ぎ目) から出現・消失する
//! 帯として球面に流す。色は各 LED の yaw 適用済み `(u,v)` から生成するため、frontYawDeg
//! に自動追従する。真裏付近は明るさフェードで背景色に戻す。

use std::sync::RwLock as StdRwLock;
use std::time::Instant;

use fontdue::layout::{CoordinateSystem, Layout, LayoutSettings, TextStyle};
use fontdue::Font;

use crate::sphere;

/// リボン画素高（固定）。`text_size_deg` はサンプリング時の度→画素換算にのみ使う。
const RIBBON_HEIGHT_PX: usize = 64;
/// リボン上下の余白（グリフが縁で切れないように）。
const RIBBON_PAD_Y_PX: f32 = 6.0;

pub const TEXT_SIZE_DEG_MIN: f32 = 10.0;
pub const TEXT_SIZE_DEG_MAX: f32 = 180.0;
pub const SPEED_DEG_PER_SEC_MIN: f32 = -360.0;
pub const SPEED_DEG_PER_SEC_MAX: f32 = 360.0;
pub const CENTER_LAT_DEG_MIN: f32 = -80.0;
pub const CENTER_LAT_DEG_MAX: f32 = 80.0;
/// 傾き量 θ（0=水平、-90=縦）。
pub const TILT_DEG_MIN: f32 = -90.0;
pub const TILT_DEG_MAX: f32 = 0.0;
/// 傾ける方位角 φ（+X 基準・+Y 軸まわり。0=正面 +X 方向へ倒す）。
pub const TILT_AZIMUTH_DEG_MIN: f32 = -180.0;
pub const TILT_AZIMUTH_DEG_MAX: f32 = 180.0;
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
    pub center_lat_deg: f32,
    /// 傾き量 θ（度、0=水平＝極が +Y、-90=縦）。帯をこの角度だけ倒す。
    pub tilt_deg: f32,
    /// 傾ける方位角 φ（度、+X 基準・+Y 軸まわり右ねじ。0=正面 +X 方向へ倒す）。
    pub tilt_azimuth_deg: f32,
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
            center_lat_deg: 15.0,
            tilt_deg: -20.0,
            tilt_azimuth_deg: 30.0,
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
        self.center_lat_deg = self
            .center_lat_deg
            .clamp(CENTER_LAT_DEG_MIN, CENTER_LAT_DEG_MAX);
        self.tilt_deg = self.tilt_deg.clamp(TILT_DEG_MIN, TILT_DEG_MAX);
        self.tilt_azimuth_deg = self
            .tilt_azimuth_deg
            .clamp(TILT_AZIMUTH_DEG_MIN, TILT_AZIMUTH_DEG_MAX);
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
    tilt_bits: u32,
    tilt_azimuth_bits: u32,
    center_lat_bits: u32,
}

impl SamplesKey {
    fn new(
        layout_id: &str,
        led_count: usize,
        front_yaw_deg: f32,
        tilt_deg: f32,
        tilt_azimuth_deg: f32,
        center_lat_deg: f32,
    ) -> Self {
        Self {
            layout_id: layout_id.to_string(),
            led_count,
            front_yaw_bits: f32::to_bits(front_yaw_deg),
            tilt_bits: f32::to_bits(tilt_deg),
            tilt_azimuth_bits: f32::to_bits(tilt_azimuth_deg),
            center_lat_bits: f32::to_bits(center_lat_deg),
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
        tilt_deg: f32,
        tilt_azimuth_deg: f32,
        center_lat_deg: f32,
    ) {
        let want = SamplesKey::new(
            layout_id,
            layout_uv.len(),
            front_yaw_deg,
            tilt_deg,
            tilt_azimuth_deg,
            center_lat_deg,
        );
        if let Ok(g) = self.samples.read() {
            if g.as_ref().is_some_and(|c| c.key == want) {
                return;
            }
        }
        let per_led = compute_samples(layout_uv, tilt_deg, tilt_azimuth_deg, center_lat_deg);
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
            params.tilt_deg,
            params.tilt_azimuth_deg,
            params.center_lat_deg,
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
                let idx = py as usize * width_px + px as usize;
                cov[idx] = cov[idx].max(a);
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

/// 各 LED の yaw 適用済み `(u,v)` から、tilt を戻した水平帯フレームでの `(s, t_deg)` を求める。
///
/// 帯の極（法線）を球面座標 `n(θ,φ)=(sinθcosφ, cosθ, -sinθsinφ)` に倒す。θ（`tilt_deg`）は
/// 傾け量（0=水平/極=+Y）、φ（`tilt_azimuth_deg`）は傾ける方位角（+X 基準・+Y 軸まわり右ねじ、
/// φ=0 で +X＝正面方向へ倒す）。これを実現する水平な傾き軸は `a=(-sinφ, 0, -cosφ)`。
/// 各方向ベクトルを軸 `a` まわりに `-θ` だけ Rodrigues 回転して帯フレームへ戻す。
fn compute_samples(
    layout_uv: &[(f32, f32)],
    tilt_deg: f32,
    tilt_azimuth_deg: f32,
    center_lat_deg: f32,
) -> Vec<(f32, f32)> {
    let phi = tilt_azimuth_deg.to_radians();
    let (sin_phi, cos_phi) = phi.sin_cos();
    let (ax, az) = (-sin_phi, -cos_phi); // 傾き軸 a=(ax, 0, az)、水平面 (xz) 内
    let alpha = (-tilt_deg).to_radians();
    let (sin_a, cos_a) = alpha.sin_cos();
    let one_minus = 1.0 - cos_a;
    layout_uv
        .iter()
        .map(|&(u, v)| {
            let d = sphere::unit_dir_from_equirect_uv_y_up(u, v);
            let (x, y, z) = (d[0], d[1], d[2]);
            // v' = v·cosα + (a×v)·sinα + a·(a·v)·(1-cosα)、a=(ax,0,az)。
            let dot = ax * x + az * z;
            let (cx, cy, cz) = (-az * y, az * x - ax * z, ax * y);
            let rx = x * cos_a + cx * sin_a + ax * dot * one_minus;
            let ry = y * cos_a + cy * sin_a;
            let rz = z * cos_a + cz * sin_a + az * dot * one_minus;
            let (u2, v2) = sphere::equirect_uv_from_unit_dir_y_up(rx, ry, rz);
            let deg = 90.0 - 180.0 * v2;
            (u2, deg - center_lat_deg)
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
        // ディセンダ付きの字形が下端で見切れないこと（余白行が残る＝クランプされていない）。
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
    fn front_maps_to_mid_band() {
        // 正面 (u=0.5, 赤道) は tilt=0 で s=0.5、t_deg=0 付近。
        let samples = compute_samples(&[(0.5, 0.5)], 0.0, 0.0, 0.0);
        let (s, t) = samples[0];
        assert!((s - 0.5).abs() < 1e-3, "front s should be ~0.5, got {s}");
        assert!(t.abs() < 1e-2, "front t_deg should be ~0, got {t}");
    }

    #[test]
    fn front_and_back_stay_on_flow_seam_for_axis_directions() {
        // 傾き軸が xz 平面内（φ=0/90/180）なら、正面/真裏は s=0.5 / s=0.0 の経度に留まる。
        for &azimuth in &[0.0f32, 90.0, 180.0, -90.0] {
            let s = compute_samples(&[(0.5, 0.5)], 60.0, azimuth, 0.0)[0].0;
            assert!(
                (s - 0.5).abs() < 1e-3,
                "front s should stay 0.5 at φ={azimuth}, got {s}"
            );
            let b = compute_samples(&[(0.0, 0.5)], 60.0, azimuth, 0.0)[0].0;
            assert!(
                b.min(1.0 - b) < 1e-3,
                "back s should stay at seam at φ={azimuth}, got {b}"
            );
        }
    }

    #[test]
    fn frame_zero_places_head_at_back_seam() {
        // elapsed=0 で先頭 (phase 0) が裏側の継ぎ目に来る＝fade 開始点から表示が始まる。
        // 先頭の経度は a_deg = (-scroll0) mod period。
        for &(period, speed, want) in &[
            (720.0f32, 150.0f32, 360.0f32), // 順方向: a_deg=360 側から流入
            (360.0, 150.0, 0.0),            // 短文（period=360）でも継ぎ目
            (720.0, -150.0, 0.0),           // 逆方向: a_deg=0 側から流入
        ] {
            let scroll0 = initial_scroll_offset_deg(period, speed);
            let head_a_deg = (-scroll0).rem_euclid(period);
            assert!(
                (head_a_deg - want).abs() < 1e-3,
                "period={period} speed={speed}: head a_deg {head_a_deg} != {want}"
            );
        }
    }

    #[test]
    fn azimuth_zero_tilts_toward_front() {
        // φ=0 は正面(+X)方向へ倒す：正面点は帯フレームで s=0.5 を保ちつつ緯度が +θ ずれる。
        let theta = 30.0f32;
        let (s, t) = compute_samples(&[(0.5, 0.5)], theta, 0.0, 0.0)[0];
        assert!(
            (s - 0.5).abs() < 1e-3,
            "front should stay at s=0.5, got {s}"
        );
        assert!((t - theta).abs() < 0.1, "front t_deg should be ~θ, got {t}");
        // φ=90 は正面軸(+X)を傾き軸にするため、正面点は緯度が動かない。
        let (s90, t90) = compute_samples(&[(0.5, 0.5)], theta, 90.0, 0.0)[0];
        assert!((s90 - 0.5).abs() < 1e-3, "front should stay at s=0.5");
        assert!(
            t90.abs() < 0.1,
            "front t_deg should stay ~0 at φ=90, got {t90}"
        );
    }

    #[test]
    fn azimuth_changes_tilt_direction() {
        // φ を変えると同じ θ でも帯フレームの写像が変わる（軸方向が効いている）。
        let front_axis = compute_samples(&[(0.6, 0.5)], 45.0, 0.0, 0.0)[0];
        let side_axis = compute_samples(&[(0.6, 0.5)], 45.0, 90.0, 0.0)[0];
        let d = (front_axis.0 - side_axis.0).abs() + (front_axis.1 - side_axis.1).abs();
        assert!(d > 1e-2, "azimuth should change mapping, diff={d}");
    }
}
