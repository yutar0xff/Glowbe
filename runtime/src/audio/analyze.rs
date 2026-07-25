//! FFT / band / beat / perceptual feature analysis.

use rustfft::num_complex::Complex;
use rustfft::{Fft, FftPlanner};
use std::f32::consts::PI;
use std::sync::Arc;

use super::types::{BAND_COUNT, FFT_SIZE, SAMPLE_RATE};

const AGC_K: f32 = 20.0;
/// Peak envelope recovery — short enough that brief dropouts don't mute the display.
const PEAK_TAU_SEC: f32 = 1.1;
const FLOOR_TAU_SEC: f32 = 8.0;
const ONSET_REFRACTORY_SEC: f32 = 0.120;
const FRAME_DT_SEC: f32 = FFT_SIZE as f32 / SAMPLE_RATE as f32;
/// Ignore bands below this fraction of the frame's peak (rejects FFT leakage + empty AGC).
const RELATIVE_BAND_FLOOR: f32 = 0.06;
/// Absolute magnitude gate before AGC (linear FFT units after window norm).
const ABSOLUTE_BAND_GATE: f32 = 0.004;

#[derive(Clone, Copy)]
struct BandAgc {
    peak_env: f32,
    floor_env: f32,
}

impl Default for BandAgc {
    fn default() -> Self {
        Self {
            peak_env: 0.15,
            floor_env: 0.02,
        }
    }
}

pub struct Analyzer {
    fft: Arc<dyn Fft<f32>>,
    window: Vec<f32>,
    scratch: Vec<Complex<f32>>,
    spectrum: Vec<f32>,
    bands_raw: Vec<f32>,
    bands_smooth: Vec<f32>,
    bands_norm: Vec<f32>,
    prev_bands_norm: Vec<f32>,
    band_agc: [BandAgc; BAND_COUNT],
    bass_smooth: f32,
    rms_smooth: f32,
    peak_smooth: f32,
    beat_env: f32,
    beat_hold: u32,
    flux_mean: f32,
    last_onset_sec: f32,
    clock_sec: f32,
    has_prev_flux: bool,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct AnalysisFrame {
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
}

impl Analyzer {
    pub fn new() -> Self {
        let mut planner = FftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(FFT_SIZE);
        let window = (0..FFT_SIZE)
            .map(|i| {
                let x = i as f32 / (FFT_SIZE as f32 - 1.0);
                0.5 - 0.5 * (2.0 * PI * x).cos()
            })
            .collect();
        Self {
            fft,
            window,
            scratch: vec![Complex::new(0.0, 0.0); FFT_SIZE],
            spectrum: vec![0.0; FFT_SIZE / 2],
            bands_raw: vec![0.0; BAND_COUNT],
            bands_smooth: vec![0.0; BAND_COUNT],
            bands_norm: vec![0.0; BAND_COUNT],
            prev_bands_norm: vec![0.0; BAND_COUNT],
            band_agc: [BandAgc::default(); BAND_COUNT],
            bass_smooth: 0.0,
            rms_smooth: 0.0,
            peak_smooth: 0.0,
            beat_env: 0.0,
            beat_hold: 0,
            flux_mean: 0.05,
            last_onset_sec: -1.0,
            clock_sec: 0.0,
            has_prev_flux: false,
        }
    }

    pub fn bands(&self) -> &[f32] {
        &self.bands_norm
    }

    fn current_features(&self, flux: f32, onset: f32, beat: bool) -> AnalysisFrame {
        AnalysisFrame {
            rms: self.rms_smooth,
            peak: self.peak_smooth,
            bass: self.bass_smooth,
            beat,
            low: weighted_band_avg(&self.bands_norm, 0, 8),
            mid: weighted_band_avg(&self.bands_norm, 8, 20),
            high: weighted_band_avg(&self.bands_norm, 20, BAND_COUNT),
            centroid: spectral_centroid(&self.bands_norm),
            flux,
            onset,
        }
    }

    pub fn process(&mut self, samples: &[f32], attack: f32, release: f32) -> AnalysisFrame {
        if samples.len() < FFT_SIZE {
            return self.current_features(0.0, 0.0, self.beat_hold > 0);
        }
        let chunk = &samples[samples.len() - FFT_SIZE..];
        self.clock_sec += FRAME_DT_SEC;

        let mut sum_sq = 0.0f32;
        let mut peak = 0.0f32;
        for (i, &s) in chunk.iter().enumerate() {
            let w = s * self.window[i];
            self.scratch[i] = Complex::new(w, 0.0);
            sum_sq += s * s;
            peak = peak.max(s.abs());
        }
        self.fft.process(&mut self.scratch);

        let norm = 2.0 / FFT_SIZE as f32;
        for i in 0..self.spectrum.len() {
            let c = self.scratch[i];
            let mag = (c.re * c.re + c.im * c.im).sqrt() * norm;
            self.spectrum[i] = mag;
        }

        fill_log_bands(&self.spectrum, &mut self.bands_raw);
        for i in 0..BAND_COUNT {
            let target = self.bands_raw[i];
            let cur = self.bands_smooth[i];
            let a = if target > cur { attack } else { release };
            self.bands_smooth[i] = cur + (target - cur) * a;
        }
        // Suppress side-lobes / empty-band AGC boost so a single tone stays a thin peak.
        let frame_peak = self
            .bands_smooth
            .iter()
            .copied()
            .fold(0.0f32, f32::max);
        for i in 0..BAND_COUNT {
            let mut x = self.bands_smooth[i];
            if frame_peak > 1e-5 && x < frame_peak * RELATIVE_BAND_FLOOR {
                x = 0.0;
            }
            self.bands_norm[i] = normalize_band(x, &mut self.band_agc[i]);
        }

        let bass_raw = self.bands_raw[..4].iter().copied().sum::<f32>() / 4.0;
        self.bass_smooth += (bass_raw - self.bass_smooth)
            * if bass_raw > self.bass_smooth {
                attack
            } else {
                release
            };

        let rms = (sum_sq / FFT_SIZE as f32).sqrt();
        self.rms_smooth += (rms - self.rms_smooth)
            * if rms > self.rms_smooth {
                attack
            } else {
                release
            };
        self.peak_smooth += (peak - self.peak_smooth)
            * if peak > self.peak_smooth {
                attack
            } else {
                release
            };

        // Bass beat flag for Studio meter.
        self.beat_env = self.beat_env * 0.92 + self.bass_smooth * 0.08;
        let mut beat = false;
        if self.beat_hold > 0 {
            self.beat_hold -= 1;
        } else if self.bass_smooth > self.beat_env * 1.35 + 0.04 && self.bass_smooth > 0.08 {
            beat = true;
            self.beat_hold = 6;
        }

        let mut flux = 0.0f32;
        if self.has_prev_flux {
            let mut sum = 0.0f32;
            for i in 0..BAND_COUNT {
                let d = self.bands_norm[i] - self.prev_bands_norm[i];
                if d > 0.0 {
                    sum += d;
                }
            }
            flux = (sum / BAND_COUNT as f32).clamp(0.0, 1.0);
        }
        self.prev_bands_norm.copy_from_slice(&self.bands_norm);
        self.has_prev_flux = true;
        self.flux_mean = self.flux_mean * 0.92 + flux * 0.08;

        let mut onset = 0.0f32;
        let threshold = self.flux_mean * 1.5 + 0.03;
        if flux > threshold && (self.clock_sec - self.last_onset_sec) >= ONSET_REFRACTORY_SEC {
            let excess = ((flux - threshold) / (threshold + 0.05)).clamp(0.0, 1.0);
            onset = (0.35 + 0.65 * excess).clamp(0.0, 1.0);
            self.last_onset_sec = self.clock_sec;
        }

        self.current_features(flux, onset, beat)
    }

    pub fn clear_smooth(&mut self) {
        self.bands_smooth.fill(0.0);
        self.bands_norm.fill(0.0);
        self.prev_bands_norm.fill(0.0);
        self.band_agc = [BandAgc::default(); BAND_COUNT];
        self.bass_smooth = 0.0;
        self.rms_smooth = 0.0;
        self.peak_smooth = 0.0;
        self.beat_env = 0.0;
        self.beat_hold = 0;
        self.flux_mean = 0.05;
        self.last_onset_sec = -1.0;
        self.clock_sec = 0.0;
        self.has_prev_flux = false;
    }
}

fn normalize_band(x: f32, agc: &mut BandAgc) -> f32 {
    let x = x.max(0.0);
    let mapped = if x < ABSOLUTE_BAND_GATE {
        0.0
    } else {
        (1.0 + AGC_K * x).ln()
    };
    // Always update envelopes — including silence — so peak does not stick after dropouts.
    if mapped > agc.peak_env {
        agc.peak_env = mapped;
    } else {
        let a = 1.0 - (-FRAME_DT_SEC / PEAK_TAU_SEC).exp();
        agc.peak_env += (mapped - agc.peak_env) * a;
    }
    let floor_a = 1.0 - (-FRAME_DT_SEC / FLOOR_TAU_SEC).exp();
    agc.floor_env += (mapped - agc.floor_env) * floor_a;
    if agc.floor_env > agc.peak_env {
        agc.floor_env = agc.peak_env * 0.9;
    }
    if mapped < 1e-6 {
        return 0.0;
    }
    let denom = (agc.peak_env - agc.floor_env).max(1e-4);
    ((mapped - agc.floor_env) / denom).clamp(0.0, 1.0)
}

fn weighted_band_avg(bands: &[f32], start: usize, end: usize) -> f32 {
    let end = end.min(bands.len());
    let start = start.min(end);
    if start >= end {
        return 0.0;
    }
    let mut sum = 0.0f32;
    let mut wsum = 0.0f32;
    for (i, &b) in bands.iter().enumerate().take(end).skip(start) {
        let w = 0.65 + 0.35 * ((i - start) as f32 / (end - start) as f32);
        sum += b * w;
        wsum += w;
    }
    if wsum <= 1e-6 {
        0.0
    } else {
        (sum / wsum).clamp(0.0, 1.0)
    }
}

fn spectral_centroid(bands: &[f32]) -> f32 {
    let mut num = 0.0f32;
    let mut den = 0.0f32;
    for (i, &b) in bands.iter().enumerate() {
        let t = (i as f32 + 0.5) / bands.len() as f32;
        num += t * b;
        den += b;
    }
    if den <= 1e-6 {
        0.35
    } else {
        (num / den).clamp(0.0, 1.0)
    }
}

/// Lowest band edge (Hz). Below this, most streamed music has little content.
const BAND_F_MIN_HZ: f32 = 70.0;
/// Highest band edge (Hz). Above ~8 kHz is often empty on typical tracks, which
/// left the sphere's "treble" longitude dark; keep the window music-centric.
const BAND_F_MAX_HZ: f32 = 8_000.0;

fn fill_log_bands(spectrum: &[f32], bands: &mut [f32]) {
    let bin_hz = SAMPLE_RATE as f32 / FFT_SIZE as f32;
    let nyquist = SAMPLE_RATE as f32 / 2.0 - bin_hz;
    let f_min = BAND_F_MIN_HZ.clamp(bin_hz, nyquist * 0.25);
    let f_max = BAND_F_MAX_HZ.clamp(f_min * 2.0, nyquist);
    let log_min = f_min.ln();
    let log_max = f_max.ln();
    for (b, band) in bands.iter_mut().enumerate().take(BAND_COUNT) {
        let t0 = b as f32 / BAND_COUNT as f32;
        let t1 = (b + 1) as f32 / BAND_COUNT as f32;
        let hz0 = (log_min + (log_max - log_min) * t0).exp();
        let hz1 = (log_min + (log_max - log_min) * t1).exp();
        let i0 = ((hz0 / bin_hz).floor() as usize).clamp(1, spectrum.len() - 1);
        let i1 = ((hz1 / bin_hz).ceil() as usize).clamp(i0 + 1, spectrum.len());
        // Max (not mean): a sine occupies ~1 bin; averaging would dilute narrow peaks.
        *band = spectrum[i0..i1]
            .iter()
            .copied()
            .fold(0.0f32, f32::max)
            .min(4.0);
    }
}

#[cfg(test)]
fn make_sine(freq: f32, amp: f32) -> Vec<f32> {
    (0..FFT_SIZE)
        .map(|i| (2.0 * PI * freq * i as f32 / SAMPLE_RATE as f32).sin() * amp)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sine_peaks_in_mid_bands() {
        let mut a = Analyzer::new();
        let samples = make_sine(440.0, 0.5);
        let frame = a.process(&samples, 1.0, 1.0);
        assert!(frame.rms > 0.1, "rms={}", frame.rms);
        let max_band = a
            .bands()
            .iter()
            .enumerate()
            .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap())
            .map(|(i, _)| i)
            .unwrap();
        assert!(
            (4..20).contains(&max_band),
            "unexpected peak band {max_band}"
        );
    }

    #[test]
    fn silence_stays_near_zero() {
        let mut a = Analyzer::new();
        let samples = vec![0.0f32; FFT_SIZE];
        let frame = a.process(&samples, 1.0, 1.0);
        assert!(frame.rms < 1e-4);
        assert!(a.bands().iter().all(|&b| b < 1e-3));
    }

    #[test]
    fn low_sine_emphasizes_low_band() {
        let mut a = Analyzer::new();
        let samples = make_sine(80.0, 0.6);
        for _ in 0..40 {
            let _ = a.process(&samples, 0.5, 0.2);
        }
        let frame = a.process(&samples, 0.5, 0.2);
        assert!(
            frame.low > frame.mid && frame.low > frame.high,
            "low={} mid={} high={}",
            frame.low,
            frame.mid,
            frame.high
        );
    }

    #[test]
    fn high_sine_raises_centroid() {
        let mut low_a = Analyzer::new();
        let mut high_a = Analyzer::new();
        let low = make_sine(120.0, 0.5);
        let high = make_sine(4000.0, 0.5);
        for _ in 0..40 {
            let _ = low_a.process(&low, 0.5, 0.2);
            let _ = high_a.process(&high, 0.5, 0.2);
        }
        let lf = low_a.process(&low, 0.5, 0.2);
        let hf = high_a.process(&high, 0.5, 0.2);
        assert!(
            hf.centroid > lf.centroid + 0.08,
            "low_centroid={} high_centroid={}",
            lf.centroid,
            hf.centroid
        );
    }

    #[test]
    fn silence_to_tone_fires_onset_once() {
        let mut a = Analyzer::new();
        let silence = vec![0.0f32; FFT_SIZE];
        for _ in 0..20 {
            let _ = a.process(&silence, 0.8, 0.3);
        }
        let tone = make_sine(220.0, 0.7);
        let mut onset_count = 0u32;
        for i in 0..30 {
            let frame = a.process(&tone, 0.8, 0.3);
            if frame.onset > 0.2 {
                onset_count += 1;
            }
            if i > 8 {
                assert!(
                    frame.onset < 0.05,
                    "steady tone should not keep firing onset: {}",
                    frame.onset
                );
            }
        }
        assert!(onset_count >= 1, "expected at least one onset");
        assert!(onset_count <= 3, "too many onsets: {onset_count}");
    }

    #[test]
    fn high_sine_stays_as_strong_as_low_sine() {
        let mut low_a = Analyzer::new();
        let mut high_a = Analyzer::new();
        let low = make_sine(200.0, 0.5);
        let high = make_sine(6_000.0, 0.5);
        for _ in 0..50 {
            let _ = low_a.process(&low, 0.6, 0.25);
            let _ = high_a.process(&high, 0.6, 0.25);
        }
        let low_peak = low_a.bands().iter().copied().fold(0.0f32, f32::max);
        let high_peak = high_a.bands().iter().copied().fold(0.0f32, f32::max);
        assert!(
            high_peak > 0.45 && high_peak > low_peak * 0.55,
            "treble sine diluted: low_peak={low_peak} high_peak={high_peak}"
        );
    }

    #[test]
    fn pure_tone_lights_few_bands() {
        let mut a = Analyzer::new();
        let tone = make_sine(1000.0, 0.55);
        for _ in 0..40 {
            let _ = a.process(&tone, 0.6, 0.25);
        }
        let _ = a.process(&tone, 0.6, 0.25);
        let lit = a.bands().iter().filter(|&&b| b > 0.15).count();
        let peak = a.bands().iter().copied().fold(0.0f32, f32::max);
        assert!(peak > 0.5, "peak too low: {peak}");
        assert!(
            lit <= 4,
            "pure tone lit too many bands ({lit}); leakage/AGC boost?"
        );
    }

    #[test]
    fn agc_converges_across_amplitudes() {
        let mut quiet = Analyzer::new();
        let mut loud = Analyzer::new();
        let q = make_sine(440.0, 0.08);
        let l = make_sine(440.0, 0.55);
        for _ in 0..180 {
            let _ = quiet.process(&q, 0.4, 0.2);
            let _ = loud.process(&l, 0.4, 0.2);
        }
        let qf = quiet.process(&q, 0.4, 0.2);
        let lf = loud.process(&l, 0.4, 0.2);
        let qd = quiet.bands().iter().copied().sum::<f32>() / BAND_COUNT as f32;
        let ld = loud.bands().iter().copied().sum::<f32>() / BAND_COUNT as f32;
        assert!(
            (qd - ld).abs() < 0.35,
            "normalized bands diverged: quiet={qd} loud={ld} (low q={} l={})",
            qf.low,
            lf.low
        );
    }
}
