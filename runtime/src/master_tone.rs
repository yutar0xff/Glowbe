pub const DEFAULT_MASTER_BRIGHTNESS: f64 = 1.0;
pub const DEFAULT_MASTER_GAMMA: f64 = 1.0;
pub const MIN_MASTER_GAMMA: f64 = 0.45;
pub const MAX_MASTER_GAMMA: f64 = 3.5;

pub fn clamp_brightness(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}

pub fn clamp_gamma(v: f64) -> f64 {
    v.clamp(MIN_MASTER_GAMMA, MAX_MASTER_GAMMA)
}

pub fn clamp_brightness_f32(v: f32) -> f32 {
    v.clamp(0.0, 1.0)
}

pub fn clamp_gamma_f32(v: f32) -> f32 {
    v.clamp(MIN_MASTER_GAMMA as f32, MAX_MASTER_GAMMA as f32)
}
