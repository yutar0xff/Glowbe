//! Shared types for audio visualizer mode.

use serde::{Deserialize, Serialize};

pub const SAMPLE_RATE: u32 = 48_000;
pub const FFT_SIZE: usize = 1024;
pub const BAND_COUNT: usize = 32;
pub const RING_CAPACITY: usize = SAMPLE_RATE as usize; // 1s

pub const DEFAULT_INTENSITY: f32 = 1.0;
pub const DEFAULT_MOTION: f32 = 1.0;
pub const DEFAULT_PERSISTENCE: f32 = 0.55;
pub const DEFAULT_GAMMA: f32 = 1.75;
pub const DEFAULT_ATTACK: f32 = 0.35;
pub const DEFAULT_RELEASE: f32 = 0.12;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum AudioVisualizerPattern {
    #[default]
    RadialSpectrum,
    AuroraGlobe,
    OrbitalSpectrum,
    ImpactConstellation,
    SpectrumBars,
    WobblyRing,
}

impl AudioVisualizerPattern {
    /// Parse scene id. Known aliases resolve to the current scene.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "radial-spectrum" => Some(Self::RadialSpectrum),
            "aurora-globe" | "spectrum-rings" => Some(Self::AuroraGlobe),
            "orbital-spectrum" | "wave-ribbon" => Some(Self::OrbitalSpectrum),
            "impact-constellation" | "bass-pulse" => Some(Self::ImpactConstellation),
            "spectrum-bars" => Some(Self::SpectrumBars),
            "wobbly-ring" => Some(Self::WobblyRing),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::RadialSpectrum => "radial-spectrum",
            Self::AuroraGlobe => "aurora-globe",
            Self::OrbitalSpectrum => "orbital-spectrum",
            Self::ImpactConstellation => "impact-constellation",
            Self::SpectrumBars => "spectrum-bars",
            Self::WobblyRing => "wobbly-ring",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum AudioVisualizerPalette {
    #[default]
    Rainbow,
    Aurora,
    Nebula,
    Solar,
    Ice,
}

impl AudioVisualizerPalette {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "rainbow" => Some(Self::Rainbow),
            "aurora" => Some(Self::Aurora),
            "nebula" => Some(Self::Nebula),
            "solar" => Some(Self::Solar),
            "ice" => Some(Self::Ice),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Rainbow => "rainbow",
            Self::Aurora => "aurora",
            Self::Nebula => "nebula",
            Self::Solar => "solar",
            Self::Ice => "ice",
        }
    }

    /// Three linear-RGB stops plus a white-hot accent (linear, from sRGB × gain).
    /// Rainbow is continuous; stops are representative samples for scenes that only
    /// interpolate three colors.
    pub fn colors(self) -> ([[f32; 3]; 3], [f32; 3]) {
        const ACCENT_GAIN: f32 = 1.35;
        match self {
            Self::Rainbow => (
                [
                    rainbow_hue_linear(0.0),
                    rainbow_hue_linear(0.33),
                    rainbow_hue_linear(0.66),
                ],
                scale3(srgb_u8_to_linear([250, 250, 255]), ACCENT_GAIN),
            ),
            Self::Aurora => (
                [
                    srgb_u8_to_linear([8, 76, 92]),
                    srgb_u8_to_linear([34, 211, 153]),
                    srgb_u8_to_linear([91, 156, 255]),
                ],
                scale3(srgb_u8_to_linear([218, 255, 244]), ACCENT_GAIN),
            ),
            Self::Nebula => (
                [
                    srgb_u8_to_linear([35, 24, 94]),
                    srgb_u8_to_linear([182, 64, 220]),
                    srgb_u8_to_linear([255, 105, 135]),
                ],
                scale3(srgb_u8_to_linear([255, 226, 246]), ACCENT_GAIN),
            ),
            Self::Solar => (
                [
                    srgb_u8_to_linear([113, 24, 28]),
                    srgb_u8_to_linear([245, 92, 38]),
                    srgb_u8_to_linear([255, 196, 64]),
                ],
                scale3(srgb_u8_to_linear([255, 244, 205]), ACCENT_GAIN),
            ),
            Self::Ice => (
                [
                    srgb_u8_to_linear([19, 54, 92]),
                    srgb_u8_to_linear([65, 190, 225]),
                    srgb_u8_to_linear([184, 235, 255]),
                ],
                scale3(srgb_u8_to_linear([240, 252, 255]), ACCENT_GAIN),
            ),
        }
    }

    /// Continuous palette sample in `t` ∈ [0,1) (wraps). Rainbow is spectral;
    /// other palettes loop their three stops.
    pub fn sample_at(self, t: f32) -> [f32; 3] {
        let t = t.rem_euclid(1.0);
        match self {
            Self::Rainbow => rainbow_hue_linear(t),
            _ => {
                let (stops, _) = self.colors();
                let x = t * 2.0;
                if x <= 1.0 {
                    lerp3(stops[0], stops[1], x)
                } else {
                    lerp3(stops[1], stops[2], x - 1.0)
                }
            }
        }
    }
}

fn scale3(rgb: [f32; 3], gain: f32) -> [f32; 3] {
    [rgb[0] * gain, rgb[1] * gain, rgb[2] * gain]
}

fn lerp3(a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    let t = t.clamp(0.0, 1.0);
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]
}

/// Soft spectral hue 0..1 → linear RGB for LED-friendly rainbow.
pub(crate) fn rainbow_hue_linear(hue: f32) -> [f32; 3] {
    let h = hue.rem_euclid(1.0) * 6.0;
    let i = h.floor();
    let f = h - i;
    let q = 1.0 - f;
    let (r, g, b) = match i as i32 {
        0 => (1.0, f, 0.0),
        1 => (q, 1.0, 0.0),
        2 => (0.0, 1.0, f),
        3 => (0.0, q, 1.0),
        4 => (f, 0.0, 1.0),
        _ => (1.0, 0.0, q),
    };
    let sat = 0.62;
    let lift = 0.14;
    let mix = |c: f32| lift + c * sat;
    [
        srgb01_to_linear(mix(r)),
        srgb01_to_linear(mix(g)),
        srgb01_to_linear(mix(b)),
    ]
}

fn srgb01_to_linear(c: f32) -> f32 {
    let c = c.clamp(0.0, 1.0);
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AudioInputKind {
    Source,
    Monitor,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioInputDevice {
    pub id: String,
    pub name: String,
    pub kind: AudioInputKind,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioPlatformInfo {
    pub available: bool,
    pub reason: Option<String>,
    pub backend: &'static str,
}

#[derive(Debug, Clone)]
pub struct AudioVisualizerParams {
    pub pattern: AudioVisualizerPattern,
    pub palette: AudioVisualizerPalette,
    pub intensity: f32,
    pub motion: f32,
    pub persistence: f32,
    pub gamma: f32,
    pub attack: f32,
    pub release: f32,
}

impl Default for AudioVisualizerParams {
    fn default() -> Self {
        Self {
            pattern: AudioVisualizerPattern::default(),
            palette: AudioVisualizerPalette::default(),
            intensity: DEFAULT_INTENSITY,
            motion: DEFAULT_MOTION,
            persistence: DEFAULT_PERSISTENCE,
            gamma: DEFAULT_GAMMA,
            attack: DEFAULT_ATTACK,
            release: DEFAULT_RELEASE,
        }
    }
}

impl AudioVisualizerParams {
    pub fn clamp_mut(&mut self) {
        self.intensity = self.intensity.clamp(0.25, 2.0);
        self.motion = self.motion.clamp(0.0, 2.0);
        self.persistence = self.persistence.clamp(0.0, 1.0);
        self.gamma = self.gamma.clamp(1.0, 2.6);
        self.attack = self.attack.clamp(0.01, 1.0);
        self.release = self.release.clamp(0.01, 1.0);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioVisualizerSnapshot {
    pub connected: bool,
    pub input_id: Option<String>,
    pub input_name: Option<String>,
    pub input_kind: Option<AudioInputKind>,
    pub rms: f32,
    pub peak: f32,
    pub bass: f32,
    pub beat: bool,
    pub low: f32,
    pub mid: f32,
    pub high: f32,
    pub centroid: f32,
    pub flux: f32,
    pub onset: f32,
    pub bands: Vec<f32>,
    pub pattern: String,
    pub palette: String,
    pub intensity: f32,
    pub motion: f32,
    pub persistence: f32,
    pub gamma: f32,
    pub attack: f32,
    pub release: f32,
    pub error: Option<String>,
}

impl AudioVisualizerSnapshot {
    pub fn idle(params: &AudioVisualizerParams, error: Option<String>) -> Self {
        Self {
            connected: false,
            input_id: None,
            input_name: None,
            input_kind: None,
            rms: 0.0,
            peak: 0.0,
            bass: 0.0,
            beat: false,
            low: 0.0,
            mid: 0.0,
            high: 0.0,
            centroid: 0.0,
            flux: 0.0,
            onset: 0.0,
            bands: vec![0.0; BAND_COUNT],
            pattern: params.pattern.as_str().to_string(),
            palette: params.palette.as_str().to_string(),
            intensity: params.intensity,
            motion: params.motion,
            persistence: params.persistence,
            gamma: params.gamma,
            attack: params.attack,
            release: params.release,
            error,
        }
    }
}

fn srgb_channel_to_linear(c: f32) -> f32 {
    srgb01_to_linear(c / 255.0)
}

pub(crate) fn srgb_u8_to_linear(rgb: [u8; 3]) -> [f32; 3] {
    [
        srgb_channel_to_linear(rgb[0] as f32),
        srgb_channel_to_linear(rgb[1] as f32),
        srgb_channel_to_linear(rgb[2] as f32),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rainbow_hue_matches_at_wrap() {
        let a = rainbow_hue_linear(0.0);
        let b = rainbow_hue_linear(1.0 - 1e-6);
        let c = rainbow_hue_linear(1.0);
        for i in 0..3 {
            assert!((a[i] - c[i]).abs() < 1e-5, "0 vs 1: {a:?} {c:?}");
            assert!((a[i] - b[i]).abs() < 0.08, "0 vs near-1: {a:?} {b:?}");
        }
    }
}
