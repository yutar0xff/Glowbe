//! Device brightness + clip gamma (loop media only).

pub const DEFAULT_MASTER_BRIGHTNESS: f64 = 1.0;
pub const DEFAULT_CLIP_GAMMA: f64 = 1.0;
pub const MIN_CLIP_GAMMA: f64 = 0.45;
pub const MAX_CLIP_GAMMA: f64 = 3.5;

pub fn clamp_brightness(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}

pub fn clamp_brightness_f32(v: f32) -> f32 {
    v.clamp(0.0, 1.0)
}

pub fn clamp_clip_gamma_f32(v: f32) -> f32 {
    v.clamp(MIN_CLIP_GAMMA as f32, MAX_CLIP_GAMMA as f32)
}

/// Device master brightness: `out = clamp((in/255) × brightness × 255)`.
pub fn apply_brightness_to_rgb(rgb: &mut [u8], brightness: f32) {
    let brightness = clamp_brightness_f32(brightness);
    if (brightness - 1.0).abs() < 1e-6 {
        return;
    }
    for c in rgb.iter_mut() {
        let y = (*c as f32) * brightness;
        *c = y.round().clamp(0.0, 255.0) as u8;
    }
}

/// Clip gamma (loop media): `out = clamp(((in/255)^gamma) × 255)`.
/// gamma > 1 darkens midtones (sRGB wash → denser on LEDs).
pub fn apply_clip_gamma_to_rgb(rgb: &mut [u8], gamma: f32) {
    let gamma = clamp_clip_gamma_f32(gamma).max(0.001);
    if (gamma - 1.0).abs() < 1e-6 {
        return;
    }
    for c in rgb.iter_mut() {
        let x = *c as f32 / 255.0;
        let y = x.max(0.0).powf(gamma);
        *c = (y * 255.0).round().clamp(0.0, 255.0) as u8;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brightness_scales() {
        let mut rgb = [200u8, 200, 200];
        apply_brightness_to_rgb(&mut rgb, 0.5);
        assert_eq!(rgb[0], 100);
    }

    #[test]
    fn gamma_one_is_identity() {
        let mut rgb = [128u8, 64, 200];
        apply_clip_gamma_to_rgb(&mut rgb, 1.0);
        assert_eq!(rgb, [128, 64, 200]);
    }

    #[test]
    fn higher_gamma_darkens_midtones() {
        let mut low = [128u8, 128, 128];
        let mut high = [128u8, 128, 128];
        apply_clip_gamma_to_rgb(&mut low, 1.0);
        apply_clip_gamma_to_rgb(&mut high, 2.0);
        assert!(high[0] < low[0]);
    }
}
