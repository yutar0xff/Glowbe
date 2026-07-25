//! Spherical LED renderers for audio visualizer scenes.

use std::f32::consts::PI;

use crate::sphere;

use super::types::{AudioVisualizerParams, AudioVisualizerPattern, BAND_COUNT};

const MAX_SHOCKWAVES: usize = 8;
const MAX_SPARKS: usize = 48;
const SHOCKWAVE_LIFE_SEC: f32 = 1.4;
const ONSET_LATCH_THRESHOLD: f32 = 0.2;
const TIP_ACCENT_GAIN: f32 = 0.28;
/// Reinhard white point (>1 softens the shoulder / reduces punch).
const TONE_WHITE: f32 = 1.55;
/// Internal exposure for hue-preserving tone map (not an API knob).
const TONE_EXPOSURE: f32 = 0.68;

#[derive(Debug, Clone, Copy)]
struct Shockwave {
    origin: [f32; 3],
    birth: f32,
    strength: f32,
}

#[derive(Debug, Clone, Copy)]
struct Spark {
    pos: [f32; 3],
    vel: [f32; 3],
    birth: f32,
    life: f32,
    strength: f32,
}

/// Stateful scene data retained across frames (ripples, sparks, rotation).
#[derive(Debug, Clone)]
pub struct VisualizerSceneState {
    rotation: f32,
    shockwaves: Vec<Shockwave>,
    sparks: Vec<Spark>,
    last_time_sec: f32,
    last_pattern: Option<AudioVisualizerPattern>,
    impact_phase: u32,
    onset_latch: f32,
    bar_display: [f32; BAND_COUNT],
    ring_tilt: f32,
    wobble_amp: f32,
}

impl Default for VisualizerSceneState {
    fn default() -> Self {
        Self {
            rotation: 0.0,
            shockwaves: Vec::with_capacity(MAX_SHOCKWAVES),
            sparks: Vec::with_capacity(MAX_SPARKS),
            last_time_sec: f32::NAN,
            last_pattern: None,
            impact_phase: 0,
            onset_latch: 0.0,
            bar_display: [0.0; BAND_COUNT],
            ring_tilt: 0.0,
            wobble_amp: 0.015,
        }
    }
}

impl VisualizerSceneState {
    pub fn reset(&mut self) {
        *self = Self::default();
        self.shockwaves.reserve(MAX_SHOCKWAVES);
        self.sparks.reserve(MAX_SPARKS);
    }
}

pub struct RenderInput<'a> {
    pub params: &'a AudioVisualizerParams,
    pub rms: f32,
    pub low: f32,
    pub mid: f32,
    pub high: f32,
    pub centroid: f32,
    pub flux: f32,
    pub onset: f32,
    pub bands: &'a [f32],
    pub uv: &'a [(f32, f32)],
    pub time_sec: f32,
}

/// Canonical device UV → unit direction.
/// Front `u=0.5` maps to +X, north pole `v=0` to +Y, matching Studio sphere preview.
#[must_use]
pub(crate) fn device_uv_to_dir(u: f32, v: f32) -> [f32; 3] {
    let u_sphere = (1.0 - u.rem_euclid(1.0)).rem_euclid(1.0);
    sphere::unit_dir_from_equirect_uv_y_up(u_sphere, v)
}

#[must_use]
fn great_circle(a: [f32; 3], b: [f32; 3]) -> f32 {
    let d = (dot3(a, b)).clamp(-1.0, 1.0);
    d.acos()
}

#[must_use]
fn soft_band(distance: f32, width: f32) -> f32 {
    let w = width.max(1e-4);
    let t = 1.0 - (distance / w).abs();
    smoothstep(0.0, 1.0, t)
}

#[must_use]
fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[must_use]
fn hash_dir(p: [f32; 3], seed: u32) -> f32 {
    let x = p[0] * 12.9898 + p[1] * 78.233 + p[2] * 37.719 + seed as f32 * 0.017;
    let s = (x.sin() * 43_758.547).fract().abs();
    if s.is_finite() {
        s
    } else {
        0.0
    }
}

fn accumulate_linear(acc: &mut [f32; 3], color: [f32; 3], amount: f32) {
    let a = amount.max(0.0);
    acc[0] = sanitize(acc[0] + color[0] * a);
    acc[1] = sanitize(acc[1] + color[1] * a);
    acc[2] = sanitize(acc[2] + color[2] * a);
}

struct BarEnvelope {
    rise_rate: f32,
    fall_base: f32,
    fall_persist_scale: f32,
}

fn update_bar_display(
    bars: &mut [f32; BAND_COUNT],
    bands: &[f32],
    intensity: f32,
    persistence: f32,
    dt: f32,
    env: BarEnvelope,
) {
    let rise = (1.0 - (-dt * env.rise_rate).exp()).clamp(0.05, 1.0);
    let fall = (1.0
        - (-dt * (env.fall_base + (1.0 - persistence) * env.fall_persist_scale)).exp())
    .clamp(0.02, 1.0);
    for (i, cur) in bars.iter_mut().enumerate() {
        let target = bands.get(i).copied().unwrap_or(0.0).clamp(0.0, 1.0) * intensity;
        let a = if target > *cur { rise } else { fall };
        *cur += (target - *cur) * a;
    }
}

/// Latitude of the southernmost LED in `uv`, minus a small margin so any meter
/// rise lights the bottom ring. `v=0` north / `v=1` south → `lat = π·(0.5 − v)`.
/// 15panels ≈ −26°, 60panels ≈ −29° (plus margin).
fn spectrum_bars_base_lat(uv: &[(f32, f32)]) -> f32 {
    let max_v = uv.iter().map(|(_, v)| *v).fold(0.0f32, f32::max);
    if max_v <= 1e-6 {
        return -30.0_f32.to_radians();
    }
    let south = (0.5 - max_v.clamp(0.0, 1.0)) * PI;
    (south - 1.5_f32.to_radians()).clamp(-PI * 0.5, PI * 0.5)
}

/// Soft-circular sample of bar energies at longitude `lon`.
/// Blends neighboring bands (including across ±π) so the low/high wrap stays continuous.
fn spectrum_at_lon(lon: f32, bars: &[f32], half_w_frac: f32) -> (f32, f32) {
    let sector_w = 2.0 * PI / BAND_COUNT as f32;
    let half_w = sector_w * half_w_frac;
    let mut energy = 0.0f32;
    let mut hx = 0.0f32;
    let mut hy = 0.0f32;
    for i in 0..BAND_COUNT {
        let center = -PI + (i as f32 + 0.5) * sector_w;
        let mut d = (lon - center).rem_euclid(2.0 * PI);
        if d > PI {
            d -= 2.0 * PI;
        }
        let w = soft_band(d.abs(), half_w);
        if w <= 1e-5 {
            continue;
        }
        let e = bars.get(i).copied().unwrap_or(0.0).clamp(0.0, 1.5);
        let contrib = e * w;
        energy += contrib;
        let ang = (i as f32 + 0.5) / BAND_COUNT as f32 * 2.0 * PI;
        hx += contrib * ang.cos();
        hy += contrib * ang.sin();
    }
    let color_t = if energy > 1e-5 {
        (hy.atan2(hx) / (2.0 * PI)).rem_euclid(1.0)
    } else {
        ((lon + PI) / (2.0 * PI)).rem_euclid(1.0)
    };
    (energy, color_t)
}

/// Nearest band index at longitude (tests / coarse queries).
#[cfg(test)]
fn lon_nearest_sector(lon: f32) -> usize {
    let sector_f = ((lon + PI) / (2.0 * PI) * BAND_COUNT as f32).rem_euclid(BAND_COUNT as f32);
    sector_f.floor() as usize % BAND_COUNT
}

fn latch_onset(state: &mut VisualizerSceneState, onset: f32, dt: f32, decay_sec: f32) {
    state.onset_latch = (state.onset_latch - dt / decay_sec.max(1e-3)).max(0.0);
    if onset > ONSET_LATCH_THRESHOLD {
        state.onset_latch = 1.0;
    }
}

/// Soften quiet levels so small energy still draws short bars.
fn quiet_lift(energy: f32, power: f32) -> f32 {
    (1.0 - (1.0 - energy.min(1.0)).powf(power)).clamp(0.0, 1.0)
}

#[must_use]
pub(crate) fn tone_map_gamma_u8(linear: [f32; 3], gamma: f32) -> [u8; 3] {
    let r = sanitize(linear[0]) * TONE_EXPOSURE;
    let g = sanitize(linear[1]) * TONE_EXPOSURE;
    let b = sanitize(linear[2]) * TONE_EXPOSURE;
    let m = r.max(g).max(b);
    let gain = if m > 1e-8 {
        let mapped_m = m / (TONE_WHITE + m);
        mapped_m / m
    } else {
        1.0
    };
    let gamma = gamma.clamp(1.0, 2.6);
    [
        soft_display_u8(r * gain, gamma),
        soft_display_u8(g * gain, gamma),
        soft_display_u8(b * gain, gamma),
    ]
}

pub fn render_visualizer(
    out: &mut [u8],
    input: &RenderInput<'_>,
    state: &mut VisualizerSceneState,
) {
    if out.len() != input.uv.len() * 3 {
        out.fill(0);
        return;
    }

    if state.last_pattern != Some(input.params.pattern) {
        state.reset();
        state.last_pattern = Some(input.params.pattern);
    }

    let mut dt = if state.last_time_sec.is_finite() {
        input.time_sec - state.last_time_sec
    } else {
        1.0 / 60.0
    };
    if !(0.0..=0.050).contains(&dt) {
        if dt < 0.0 {
            state.reset();
            state.last_pattern = Some(input.params.pattern);
        }
        dt = (1.0f32 / 60.0).min(0.050);
    }
    state.last_time_sec = input.time_sec;

    match input.params.pattern {
        AudioVisualizerPattern::RadialSpectrum => render_radial_spectrum(out, input, state, dt),
        AudioVisualizerPattern::AuroraGlobe => render_aurora(out, input, state, dt),
        AudioVisualizerPattern::OrbitalSpectrum => render_orbital(out, input, state, dt),
        AudioVisualizerPattern::ImpactConstellation => render_impact(out, input, state, dt),
        AudioVisualizerPattern::SpectrumBars => render_spectrum_bars(out, input, state, dt),
        AudioVisualizerPattern::WobblyRing => render_wobbly_ring(out, input, state, dt),
    }
}

fn render_radial_spectrum(
    out: &mut [u8],
    input: &RenderInput<'_>,
    state: &mut VisualizerSceneState,
    dt: f32,
) {
    let intensity = input.params.intensity;
    let motion = input.params.motion;
    let persistence = input.params.persistence;

    update_bar_display(
        &mut state.bar_display,
        input.bands,
        intensity,
        persistence,
        dt,
        BarEnvelope {
            rise_rate: 16.0,
            fall_base: 0.7,
            fall_persist_scale: 4.0,
        },
    );
    state.rotation += dt * motion * 0.08;

    let north = PI * 0.5;
    // Stop a little past the equator (~108° from the pole).
    let max_span = 108.0_f32.to_radians();
    let color_spin = input.time_sec * (0.035 + motion * 0.045);
    let gamma = input.params.gamma;
    let palette = input.params.palette;
    let (_, accent) = palette.colors();
    let tip_span = max_span / 11.0;

    for (i, &(u, v)) in input.uv.iter().enumerate() {
        let p = device_uv_to_dir(u, v);
        let pr = rotate_y(p, state.rotation);
        let lat = pr[1].clamp(-1.0, 1.0).asin();
        let lon = pr[2].atan2(pr[0]);
        // Kernel ≈ one sector: continuous around the low/high wrap.
        let (energy, color_t) = spectrum_at_lon(lon, &state.bar_display, 1.05);
        let energy = energy.clamp(0.0, 1.5);
        let visual = quiet_lift(energy, 1.85);
        let tip_lat = north - visual * max_span;
        let mut acc = [0.0f32; 3];

        if visual > 0.006 {
            let fill = smoothstep(tip_lat - 0.03, tip_lat + 0.015, lat)
                * (1.0 - smoothstep(north - 0.015, north + 0.04, lat));
            let progress = ((north - lat) / max_span).clamp(0.0, 1.0);
            let tick = (progress * 11.0).fract();
            let gap = if tick > 0.90 { 0.55 } else { 1.0 };
            let level = fill * gap * (0.28 + visual * 0.48) * (0.80 + 0.20 * persistence);

            let t = (color_t + color_spin).rem_euclid(1.0);
            accumulate_linear(&mut acc, palette.sample_at(t), level);

            let tip = smoothstep(tip_lat - 0.02, tip_lat + 0.015, lat)
                * (1.0 - smoothstep(tip_lat + tip_span * 0.85, tip_lat + tip_span + 0.04, lat));
            accumulate_linear(&mut acc, accent, tip * TIP_ACCENT_GAIN * visual);
        }
        write_pixel(out, i, tone_map_gamma_u8(acc, gamma));
    }
}

fn render_aurora(
    out: &mut [u8],
    input: &RenderInput<'_>,
    state: &mut VisualizerSceneState,
    dt: f32,
) {
    let intensity = input.params.intensity;
    let motion = input.params.motion;
    let persistence = input.params.persistence;
    state.rotation += dt * (0.10 + motion * 0.34 + input.centroid * 0.14);
    latch_onset(state, input.onset, dt, 0.25);

    let target_lat = (input.centroid - 0.5) * 1.1;
    let (stops, accent) = input.params.palette.colors();
    let low = input.low * intensity;
    let mid = input.mid * intensity;
    let high = input.high * intensity;

    for (i, &(u, v)) in input.uv.iter().enumerate() {
        let p = device_uv_to_dir(u, v);
        let pr = rotate_y(p, state.rotation);
        let lat = pr[1].asin().clamp(-PI * 0.5, PI * 0.5);
        let lon = pr[2].atan2(pr[0]);

        let flow_time = input.time_sec * (0.22 + motion * 0.42);
        let phase = 5.0 * lon + 1.55 * (2.0 * lat + state.rotation * 0.7).sin() + flow_time;
        let phase2 = phase * 0.61 - 2.4 * lat + 1.7;
        let curtain = (-(phase.sin().abs() * 6.2).powf(1.35)).exp();
        let veil = (-(phase2.sin().abs() * 4.8).powf(1.25)).exp();
        let filament = curtain.powf(3.2);
        let lat_envelope = (-((lat - target_lat) / 0.82).powi(2)).exp();

        let sparkle = if hash_dir(p, (input.time_sec * 14.0) as u32 + 17) < 0.055 {
            filament * high * (0.18 + input.flux * 0.55)
        } else {
            0.0
        };

        let mut acc = [0.0f32; 3];
        let energy = mid * 0.78 + low * 0.28;
        let main_level =
            curtain * lat_envelope * energy * 0.82 * (0.82 + persistence * 0.18);
        let veil_level = veil * lat_envelope * mid * 0.28;
        let color_t = (0.30 + 0.22 * phase.cos() + input.centroid * 0.28).clamp(0.0, 1.0);
        accumulate_linear(
            &mut acc,
            input.params.palette.sample_at(color_t),
            main_level,
        );
        accumulate_linear(&mut acc, stops[2], veil_level);
        accumulate_linear(&mut acc, accent, filament * main_level * 0.16 + sparkle);
        if state.onset_latch > 0.0 {
            accumulate_linear(
                &mut acc,
                accent,
                state.onset_latch * filament * lat_envelope * 0.38,
            );
        }
        write_pixel(out, i, tone_map_gamma_u8(acc, input.params.gamma));
    }
}

fn render_orbital(
    out: &mut [u8],
    input: &RenderInput<'_>,
    state: &mut VisualizerSceneState,
    dt: f32,
) {
    let intensity = input.params.intensity;
    let motion = input.params.motion;
    let persistence = input.params.persistence;
    let spin = 0.12 + motion * 0.35 + input.centroid * 0.4;
    state.rotation += dt * spin;
    latch_onset(state, input.onset, dt, 0.35);

    let groups = aggregate_bands(input.bands);
    let normals = orbit_normals();
    let (_, accent) = input.params.palette.colors();

    for (i, &(u, v)) in input.uv.iter().enumerate() {
        let p0 = device_uv_to_dir(u, v);
        let p = rotate_y(p0, state.rotation);
        let mut acc = [0.0f32; 3];

        for (gi, &n) in normals.iter().enumerate() {
            let n_r = rotate_y(n, state.rotation * 0.35);
            let energy = (groups[gi] * intensity).clamp(0.0, 1.6);
            if energy < 0.008 && state.onset_latch < 0.01 {
                continue;
            }
            let width_deg = 2.4 + energy * 4.8;
            let width = width_deg * PI / 180.0;
            let dist = (dot3(p, n_r).abs()).asin();
            let ring = soft_band(dist, width);
            if ring <= 1e-4 {
                continue;
            }
            let phase = ring_phase(p, n_r);
            let speed = 0.6 + gi as f32 * 0.35 + motion;
            let travel = ((phase + input.time_sec * speed).sin() * 0.5 + 0.5).powf(5.0);
            let pulse = state.onset_latch * travel * 0.48;
            let rail = energy * 0.55;
            let comet = energy * travel * 0.72;
            let level = ring * (rail + comet + pulse);
            let level = level * (0.75 + 0.25 * persistence);
            let t = gi as f32 / (normals.len() as f32 - 1.0).max(1.0);
            accumulate_linear(&mut acc, input.params.palette.sample_at(t), level);
            if ring * energy > 0.62 {
                accumulate_linear(&mut acc, accent, ring * energy * travel * 0.20);
            }
        }
        write_pixel(out, i, tone_map_gamma_u8(acc, input.params.gamma));
    }
}

fn render_impact(
    out: &mut [u8],
    input: &RenderInput<'_>,
    state: &mut VisualizerSceneState,
    dt: f32,
) {
    let intensity = input.params.intensity;
    let motion = input.params.motion;
    let persistence = input.params.persistence;
    let (stops, accent) = input.params.palette.colors();

    if input.onset > ONSET_LATCH_THRESHOLD {
        spawn_impact(state, input);
    }

    // Advance shockwaves / sparks.
    let decay = 0.55 + 0.45 * (1.0 - persistence);
    state
        .shockwaves
        .retain(|s| input.time_sec - s.birth < SHOCKWAVE_LIFE_SEC);
    for spark in &mut state.sparks {
        let age = input.time_sec - spark.birth;
        if age > spark.life {
            continue;
        }
        let step = dt * (0.55 + motion * 0.9) * (0.7 + spark.strength);
        spark.pos = normalize3([
            spark.pos[0] + spark.vel[0] * step,
            spark.pos[1] + spark.vel[1] * step,
            spark.pos[2] + spark.vel[2] * step,
        ]);
        // Keep velocity tangential.
        let radial = spark.pos;
        let v = spark.vel;
        let proj = dot3(v, radial);
        spark.vel = normalize3([
            v[0] - proj * radial[0],
            v[1] - proj * radial[1],
            v[2] - proj * radial[2],
        ]);
        spark.strength *= 1.0 - dt * decay * 0.85;
    }
    state
        .sparks
        .retain(|s| input.time_sec - s.birth < s.life && s.strength > 0.02);

    let spark_sharp = 4.0 + input.high * 4.0; // degrees half-width inverse-ish
    let ring_thick = (3.0 + input.low * 6.0) * PI / 180.0;

    for (i, &(u, v)) in input.uv.iter().enumerate() {
        let p = device_uv_to_dir(u, v);
        let mut acc = [0.0f32; 3];

        for wave in &state.shockwaves {
            let age = (input.time_sec - wave.birth).clamp(0.0, SHOCKWAVE_LIFE_SEC);
            let t = age / SHOCKWAVE_LIFE_SEC;
            let radius = ease_out_quad(t) * PI;
            let width = ring_thick * (1.0 + t * 2.0);
            let dist = (great_circle(p, wave.origin) - radius).abs();
            let halo = soft_band(dist, width * 1.8);
            let ring = soft_band(dist, width * 0.62);
            let fade = (1.0 - t).powf(1.2 + (1.0 - persistence));
            let level = wave.strength * fade * intensity;
            accumulate_linear(
                &mut acc,
                input.params.palette.sample_at(0.25 + t * 0.55),
                halo * level * 0.34,
            );
            accumulate_linear(&mut acc, accent, ring * level * 0.50);
        }

        for spark in &state.sparks {
            let d = great_circle(p, spark.pos);
            let half = (spark_sharp.max(2.0)) * PI / 180.0;
            let glow = soft_band(d, half);
            if glow <= 0.0 {
                continue;
            }
            let age = ((input.time_sec - spark.birth) / spark.life).clamp(0.0, 1.0);
            let level = glow * spark.strength * (1.0 - age) * intensity;
            accumulate_linear(&mut acc, stops[2], level * 0.50);
            accumulate_linear(&mut acc, accent, level * 0.72);
        }

        write_pixel(out, i, tone_map_gamma_u8(acc, input.params.gamma));
    }
}

fn render_spectrum_bars(
    out: &mut [u8],
    input: &RenderInput<'_>,
    state: &mut VisualizerSceneState,
    dt: f32,
) {
    let intensity = input.params.intensity;
    let motion = input.params.motion;
    let persistence = input.params.persistence;
    let (_, accent) = input.params.palette.colors();

    update_bar_display(
        &mut state.bar_display,
        input.bands,
        intensity,
        persistence,
        dt,
        BarEnvelope {
            rise_rate: 18.0,
            fall_base: 0.8,
            fall_persist_scale: 4.5,
        },
    );
    state.rotation += dt * motion * 0.12;

    // Floor = layout display bottom (from UV); ceiling = north pole.
    let base_lat = spectrum_bars_base_lat(input.uv);
    let span = (PI * 0.5 - base_lat).max(1e-3);
    let tick_count = 10.0f32;

    for (i, &(u, v)) in input.uv.iter().enumerate() {
        let p = device_uv_to_dir(u, v);
        let pr = rotate_y(p, state.rotation);
        let lat = pr[1].clamp(-1.0, 1.0).asin();
        let lon = pr[2].atan2(pr[0]);
        let (energy, color_t) = spectrum_at_lon(lon, &state.bar_display, 0.95);
        let energy = energy.clamp(0.0, 1.5);
        // Lift quiet levels so a small meter rise still reaches the bottom LEDs.
        let visual_energy = quiet_lift(energy, 1.55);
        let top_lat = base_lat + visual_energy * span;
        let mut acc = [0.0f32; 3];

        if top_lat > base_lat + 1e-4 && visual_energy > 0.004 {
            let fill = smoothstep(base_lat - 0.015, base_lat + 0.01, lat)
                * (1.0 - smoothstep(top_lat - 0.02, top_lat + 0.03, lat));
            let progress = ((lat - base_lat) / span).clamp(0.0, 1.0);
            let tick = (progress * tick_count).fract();
            let gap = if tick > 0.86 { 0.18 } else { 1.0 };
            let level = fill
                * gap
                * (0.36 + visual_energy * 0.44)
                * (0.78 + 0.22 * persistence);
            accumulate_linear(
                &mut acc,
                input.params.palette.sample_at(color_t),
                level,
            );
            let tip = smoothstep(top_lat - span / tick_count, top_lat + 0.02, lat)
                * (1.0 - smoothstep(top_lat, top_lat + 0.05, lat));
            accumulate_linear(&mut acc, accent, tip * TIP_ACCENT_GAIN * visual_energy);
        }
        write_pixel(out, i, tone_map_gamma_u8(acc, input.params.gamma));
    }
}

fn render_wobbly_ring(
    out: &mut [u8],
    input: &RenderInput<'_>,
    state: &mut VisualizerSceneState,
    dt: f32,
) {
    let intensity = input.params.intensity;
    let motion = input.params.motion;
    let persistence = input.params.persistence;
    let (stops, accent) = input.params.palette.colors();

    let target_tilt = (input.centroid - 0.5) * 1.2;
    let tilt_rate = 1.5 + persistence * 1.5;
    state.ring_tilt += (target_tilt - state.ring_tilt) * (1.0 - (-dt * tilt_rate).exp());

    latch_onset(state, input.onset, dt, 0.3);

    let target_amp = 0.015 + input.low * 0.04 + input.flux * 0.05 + state.onset_latch * 0.04;
    let amp_rate = 2.0 + (1.0 - persistence) * 3.0;
    state.wobble_amp += (target_amp - state.wobble_amp) * (1.0 - (-dt * amp_rate).exp());

    state.rotation += dt * (0.08 + motion * 0.25 + input.centroid * 0.15);

    // Ring normal: tilt from +Y then yaw.
    let ct = state.ring_tilt.cos();
    let st = state.ring_tilt.sin();
    let n0 = [st, ct, 0.0];
    let n = rotate_y(normalize3(n0), state.rotation);
    let amp = state.wobble_amp * intensity.clamp(0.25, 2.0);
    let width = (2.5 + input.low * 5.0) * PI / 180.0;
    let t_wave = input.time_sec;

    for (i, &(u, v)) in input.uv.iter().enumerate() {
        let p = device_uv_to_dir(u, v);
        let mut acc = [0.0f32; 3];

        let signed_dist = dot3(p, n).clamp(-1.0, 1.0).asin();
        let phase = ring_phase(p, n);
        let wobble = amp
            * ((3.0 * phase + t_wave * motion * 0.8).sin()
                + 0.45 * (7.0 * phase - t_wave * motion * 1.3).sin());
        let warped_dist = (signed_dist + wobble).abs();
        let halo = soft_band(warped_dist, width * 2.8);
        let ring = soft_band(warped_dist, width);
        let core = soft_band(warped_dist, width * 0.34);
        let strength =
            (input.rms * 0.70 + input.mid * 0.28 + input.low * 0.40 + state.onset_latch * 0.22)
                * intensity;
        let pal_t = (0.38 + phase.sin() * 0.22 + (input.centroid - 0.5) * 0.22).clamp(0.0, 1.0);
        accumulate_linear(
            &mut acc,
            input.params.palette.sample_at(pal_t),
            halo * strength * 0.12 + ring * strength * 0.62,
        );
        accumulate_linear(
            &mut acc,
            stops[2],
            core * strength * (0.08 + input.high * 0.20),
        );
        accumulate_linear(
            &mut acc,
            accent,
            core * (input.high * 0.22 + state.onset_latch * 0.32),
        );
        write_pixel(out, i, tone_map_gamma_u8(acc, input.params.gamma));
    }
}

fn ring_phase(p: [f32; 3], n: [f32; 3]) -> f32 {
    let tangent = normalize3(cross3(n, p));
    let up = if n[1].abs() < 0.9 {
        [0.0, 1.0, 0.0]
    } else {
        [1.0, 0.0, 0.0]
    };
    let phase_ref = normalize3(cross3(n, up));
    if length3(phase_ref) < 1e-3 {
        return 0.0;
    }
    let c = dot3(tangent, phase_ref).clamp(-1.0, 1.0);
    let s = dot3(cross3(phase_ref, tangent), n);
    s.atan2(c)
}

fn spawn_impact(state: &mut VisualizerSceneState, input: &RenderInput<'_>) {
    state.impact_phase = state.impact_phase.wrapping_add(1);
    let lat = (0.5 - input.centroid) * PI; // centroid high → southern impact
    let lon = (hash_u32(state.impact_phase.wrapping_mul(2654435761)) * 2.0 - 1.0) * PI;
    let origin = [lat.cos() * lon.cos(), lat.sin(), lat.cos() * lon.sin()];
    let origin = normalize3(origin);

    if state.shockwaves.len() >= MAX_SHOCKWAVES {
        state.shockwaves.remove(0);
    }
    state.shockwaves.push(Shockwave {
        origin,
        birth: input.time_sec,
        strength: (0.55 + 0.45 * input.onset).clamp(0.3, 1.2),
    });

    let n_sparks = (4.0 + input.onset * 14.0).round() as usize;
    for k in 0..n_sparks {
        if state.sparks.len() >= MAX_SPARKS {
            state.sparks.remove(0);
        }
        let seed = state.impact_phase.wrapping_add(k as u32 * 97);
        let a = hash_u32(seed) * 2.0 * PI;
        let b = hash_u32(seed.wrapping_add(13));
        // Build tangent basis at origin.
        let up = if origin[1].abs() < 0.9 {
            [0.0, 1.0, 0.0]
        } else {
            [1.0, 0.0, 0.0]
        };
        let t1 = normalize3(cross3(origin, up));
        let t2 = normalize3(cross3(origin, t1));
        let dir = normalize3([
            t1[0] * a.cos() + t2[0] * a.sin(),
            t1[1] * a.cos() + t2[1] * a.sin(),
            t1[2] * a.cos() + t2[2] * a.sin(),
        ]);
        state.sparks.push(Spark {
            pos: origin,
            vel: dir,
            birth: input.time_sec,
            life: 0.45 + b * 0.55,
            strength: 0.45 + input.onset * 0.7,
        });
    }
}

fn aggregate_bands(bands: &[f32]) -> [f32; 8] {
    let mut out = [0.0f32; 8];
    let n = bands.len().clamp(1, BAND_COUNT);
    for (g, slot) in out.iter_mut().enumerate() {
        let i0 = g * n / 8;
        let i1 = ((g + 1) * n / 8).max(i0 + 1);
        let slice = &bands[i0.min(n)..i1.min(n)];
        *slot = if slice.is_empty() {
            0.0
        } else {
            (slice.iter().sum::<f32>() / slice.len() as f32).clamp(0.0, 1.0)
        };
    }
    out
}

fn orbit_normals() -> [[f32; 3]; 8] {
    // Fibonacci sphere samples as orbit normals.
    let mut out = [[0.0f32; 3]; 8];
    let golden = PI * (3.0 - 5.0f32.sqrt());
    for (i, n) in out.iter_mut().enumerate() {
        let y = 1.0 - (i as f32 / 7.0) * 2.0;
        let r = (1.0 - y * y).max(0.0).sqrt();
        let theta = golden * i as f32;
        *n = normalize3([r * theta.cos(), y, r * theta.sin()]);
    }
    out
}

fn write_pixel(out: &mut [u8], i: usize, rgb: [u8; 3]) {
    let o = i * 3;
    out[o] = rgb[0];
    out[o + 1] = rgb[1];
    out[o + 2] = rgb[2];
}

fn sanitize(v: f32) -> f32 {
    if v.is_finite() {
        v.max(0.0)
    } else {
        0.0
    }
}

fn soft_display_u8(c: f32, gamma: f32) -> u8 {
    let c = c.clamp(0.0, 1.0);
    let g = gamma.clamp(1.0, 2.6);
    // Mild power curve; higher gamma → stronger mid contrast on LEDs.
    let encoded = c.powf(1.0 / g);
    (encoded.clamp(0.0, 1.0) * 255.0).round() as u8
}

fn dot3(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross3(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn length3(v: [f32; 3]) -> f32 {
    (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt()
}

fn normalize3(v: [f32; 3]) -> [f32; 3] {
    let l = length3(v);
    if l < 1e-8 {
        [0.0, 1.0, 0.0]
    } else {
        [v[0] / l, v[1] / l, v[2] / l]
    }
}

fn rotate_y(p: [f32; 3], angle: f32) -> [f32; 3] {
    let (s, c) = angle.sin_cos();
    [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]
}

fn ease_out_quad(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    1.0 - (1.0 - t) * (1.0 - t)
}

fn hash_u32(x: u32) -> f32 {
    let mut z = x.wrapping_mul(0x9E37_79B9);
    z ^= z >> 16;
    z = z.wrapping_mul(0x85EB_CA6B);
    z ^= z >> 13;
    (z & 0x00FF_FFFF) as f32 / 16_777_215.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::types::AudioVisualizerParams;

    fn grid_uv(n_u: usize, n_v: usize) -> Vec<(f32, f32)> {
        let mut uv = Vec::with_capacity(n_u * n_v);
        for iv in 0..n_v {
            for iu in 0..n_u {
                let u = (iu as f32 + 0.5) / n_u as f32;
                let v = (iv as f32 + 0.5) / n_v as f32;
                uv.push((u, v));
            }
        }
        uv
    }

    fn silent_input<'a>(
        params: &'a AudioVisualizerParams,
        bands: &'a [f32],
        uv: &'a [(f32, f32)],
        time: f32,
    ) -> RenderInput<'a> {
        RenderInput {
            params,
            rms: 0.0,
            low: 0.0,
            mid: 0.0,
            high: 0.0,
            centroid: 0.35,
            flux: 0.0,
            onset: 0.0,
            bands,
            uv,
            time_sec: time,
        }
    }

    #[test]
    fn device_uv_front_and_north() {
        let front = device_uv_to_dir(0.5, 0.5);
        assert!(
            (front[0] - 1.0).abs() < 0.05 && front[1].abs() < 0.05 && front[2].abs() < 0.05,
            "front={front:?}"
        );
        let north = device_uv_to_dir(0.5, 0.0);
        assert!(north[1] > 0.95, "north={north:?}");
    }

    #[test]
    fn u_seam_is_continuous() {
        let a = device_uv_to_dir(0.0, 0.5);
        let b = device_uv_to_dir(1.0 - 1e-4, 0.5);
        let ang = great_circle(a, b);
        assert!(ang < 0.05, "seam angle={ang}");
    }

    #[test]
    fn rgb_length_matches_led_count() {
        let params = AudioVisualizerParams::default();
        let uv = grid_uv(12, 8);
        let bands = vec![0.2f32; BAND_COUNT];
        for pattern in [
            AudioVisualizerPattern::RadialSpectrum,
            AudioVisualizerPattern::AuroraGlobe,
            AudioVisualizerPattern::OrbitalSpectrum,
            AudioVisualizerPattern::ImpactConstellation,
            AudioVisualizerPattern::SpectrumBars,
            AudioVisualizerPattern::WobblyRing,
        ] {
            let mut p = params.clone();
            p.pattern = pattern;
            let mut state = VisualizerSceneState::default();
            let mut out = vec![0u8; uv.len() * 3];
            let input = silent_input(&p, &bands, &uv, 1.0);
            render_visualizer(&mut out, &input, &mut state);
            assert_eq!(out.len(), uv.len() * 3);
        }
    }

    #[test]
    fn aurora_is_dark_on_silence() {
        let params = AudioVisualizerParams {
            pattern: AudioVisualizerPattern::AuroraGlobe,
            ..Default::default()
        };
        let uv = grid_uv(10, 6);
        let bands = vec![0.0f32; BAND_COUNT];
        let mut state = VisualizerSceneState::default();
        let mut out = vec![0u8; uv.len() * 3];
        render_visualizer(
            &mut out,
            &silent_input(&params, &bands, &uv, 0.5),
            &mut state,
        );
        let sum: u32 = out.iter().map(|&x| x as u32).sum();
        assert_eq!(sum, 0, "aurora should stay black on silence, sum={sum}");
    }

    #[test]
    fn radial_wrap_seam_lights_for_treble() {
        let params = AudioVisualizerParams {
            pattern: AudioVisualizerPattern::RadialSpectrum,
            motion: 0.0,
            persistence: 0.0,
            ..Default::default()
        };
        let uv = grid_uv(48, 12);
        let mut bands = vec![0.0f32; BAND_COUNT];
        bands[BAND_COUNT - 1] = 1.0;
        let mut state = VisualizerSceneState::default();
        let mut out = vec![0u8; uv.len() * 3];
        for f in 0..12 {
            render_visualizer(
                &mut out,
                &silent_input(&params, &bands, &uv, f as f32 * 0.05),
                &mut state,
            );
        }
        // Sample LEDs near the ±π wrap (u≈0 and u≈1) in the upper hemisphere.
        let mut seam = 0u32;
        let mut other = 0u32;
        for (i, &(u, v)) in uv.iter().enumerate() {
            if !(0.15..=0.45).contains(&v) {
                continue;
            }
            let lum = out[i * 3] as u32 + out[i * 3 + 1] as u32 + out[i * 3 + 2] as u32;
            if !(0.08..=0.92).contains(&u) {
                seam = seam.max(lum);
            } else if (0.4..=0.6).contains(&u) {
                other = other.max(lum);
            }
        }
        assert!(
            seam > 40,
            "treble should light the low/high wrap seam, seam_max={seam}"
        );
        assert!(
            seam > other / 3,
            "seam should not be a dark canyon vs front: seam={seam} front={other}"
        );
    }

    #[test]
    fn radial_spectrum_grows_from_north_pole() {
        let mut params = AudioVisualizerParams::default();
        assert_eq!(params.pattern, AudioVisualizerPattern::RadialSpectrum);
        params.motion = 0.0;
        params.persistence = 0.0;
        let uv = grid_uv(24, 16);
        let mut bands = vec![0.05f32; BAND_COUNT];
        bands[8] = 0.95;
        let mut state = VisualizerSceneState::default();
        let mut out = vec![0u8; uv.len() * 3];
        for f in 0..10 {
            render_visualizer(
                &mut out,
                &silent_input(&params, &bands, &uv, f as f32 * 0.05),
                &mut state,
            );
        }
        let mut north = 0u32;
        let mut south = 0u32;
        for (i, &(_, v)) in uv.iter().enumerate() {
            let lum = out[i * 3] as u32 + out[i * 3 + 1] as u32 + out[i * 3 + 2] as u32;
            if v < 0.28 {
                north += lum;
            } else if v > 0.72 {
                south += lum;
            }
        }
        assert!(
            north > south * 2,
            "bars should radiate from north: n={north} s={south}"
        );
        assert!(state.bar_display[8] > 0.5);
    }

    #[test]
    fn radial_spectrum_caps_near_equator() {
        let params = AudioVisualizerParams {
            pattern: AudioVisualizerPattern::RadialSpectrum,
            motion: 0.0,
            persistence: 0.0,
            ..Default::default()
        };
        let uv = grid_uv(20, 24);
        let bands = vec![1.0f32; BAND_COUNT];
        let mut state = VisualizerSceneState::default();
        let mut out = vec![0u8; uv.len() * 3];
        for f in 0..12 {
            render_visualizer(
                &mut out,
                &silent_input(&params, &bands, &uv, f as f32 * 0.05),
                &mut state,
            );
        }
        let mut far_south = 0u32;
        let mut mid = 0u32;
        for (i, &(_, v)) in uv.iter().enumerate() {
            let lum = out[i * 3] as u32 + out[i * 3 + 1] as u32 + out[i * 3 + 2] as u32;
            if lum < 24 {
                continue;
            }
            if v > 0.78 {
                far_south += 1;
            } else if (0.42..0.62).contains(&v) {
                mid += 1;
            }
        }
        assert!(mid > 0, "full energy should light near equator");
        assert!(
            far_south == 0,
            "bars should not reach far south: far_south={far_south}"
        );
    }

    #[test]
    fn impact_onset_increases_light() {
        let params = AudioVisualizerParams {
            pattern: AudioVisualizerPattern::ImpactConstellation,
            ..Default::default()
        };
        let uv = grid_uv(14, 8);
        let bands = vec![0.3f32; BAND_COUNT];
        let mut state = VisualizerSceneState::default();
        let mut quiet = vec![0u8; uv.len() * 3];
        let mut loud = vec![0u8; uv.len() * 3];

        let mut q_in = silent_input(&params, &bands, &uv, 1.0);
        q_in.rms = 0.1;
        render_visualizer(&mut quiet, &q_in, &mut state);

        let mut state2 = VisualizerSceneState::default();
        let mut o_in = silent_input(&params, &bands, &uv, 1.0);
        o_in.rms = 0.1;
        o_in.onset = 0.9;
        o_in.low = 0.5;
        o_in.high = 0.4;
        render_visualizer(&mut loud, &o_in, &mut state2);
        // Advance a bit so rings expand onto LEDs.
        o_in.time_sec = 1.25;
        o_in.onset = 0.0;
        render_visualizer(&mut loud, &o_in, &mut state2);

        let sum_q: u32 = quiet.iter().map(|&x| x as u32).sum();
        let sum_l: u32 = loud.iter().map(|&x| x as u32).sum();
        assert!(
            sum_l > sum_q,
            "onset should add light: quiet={sum_q} loud={sum_l}"
        );
    }

    #[test]
    fn orbital_uses_full_sphere() {
        let params = AudioVisualizerParams {
            pattern: AudioVisualizerPattern::OrbitalSpectrum,
            ..Default::default()
        };
        let uv = grid_uv(16, 10);
        let bands = vec![0.7f32; BAND_COUNT];
        let mut state = VisualizerSceneState::default();
        let mut out = vec![0u8; uv.len() * 3];
        let mut input = silent_input(&params, &bands, &uv, 2.0);
        input.low = 0.6;
        input.mid = 0.6;
        input.high = 0.6;
        render_visualizer(&mut out, &input, &mut state);

        let mut north = 0u32;
        let mut south = 0u32;
        let mut eq = 0u32;
        for (i, &(_, v)) in uv.iter().enumerate() {
            let lum = out[i * 3] as u32 + out[i * 3 + 1] as u32 + out[i * 3 + 2] as u32;
            if v < 0.25 {
                north += lum;
            } else if v > 0.75 {
                south += lum;
            } else {
                eq += lum;
            }
        }
        assert!(
            north > 0 && south > 0 && eq > 0,
            "n={north} s={south} eq={eq}"
        );
    }

    #[test]
    fn deterministic_for_same_seed_inputs() {
        let params = AudioVisualizerParams {
            pattern: AudioVisualizerPattern::ImpactConstellation,
            ..Default::default()
        };
        let uv = grid_uv(8, 6);
        let bands = vec![0.4f32; BAND_COUNT];
        let mut a = VisualizerSceneState::default();
        let mut b = VisualizerSceneState::default();
        let mut out_a = vec![0u8; uv.len() * 3];
        let mut out_b = vec![0u8; uv.len() * 3];
        let mut input = silent_input(&params, &bands, &uv, 3.0);
        input.onset = 0.8;
        input.centroid = 0.4;
        render_visualizer(&mut out_a, &input, &mut a);
        render_visualizer(&mut out_b, &input, &mut b);
        assert_eq!(out_a, out_b);
    }

    #[test]
    fn tone_map_preserves_channel_ratios() {
        let lin = [3.0f32, 1.0, 0.5];
        let mapped = tone_map_gamma_u8(lin, 1.75);
        let r = mapped[0] as f32;
        let g = mapped[1] as f32;
        let b = mapped[2] as f32;
        assert!(r > g && g > b, "order preserved: {mapped:?}");
        // Shared-gain keeps a stronger r/g than per-channel Reinhard (~1.6).
        let ratio_rg = r / g.max(1.0);
        assert!(
            ratio_rg > 1.5,
            "hue crushed toward grey: r/g={ratio_rg} {mapped:?}"
        );
        assert!(b > 25.0, "blue channel should remain visible: {mapped:?}");
    }

    #[test]
    fn tone_map_keeps_low_light_and_handles_nan() {
        let low = tone_map_gamma_u8([0.01, 0.02, 0.03], 1.75);
        assert!(low.iter().any(|&c| c > 0), "low light crushed: {low:?}");
        let bad = tone_map_gamma_u8([f32::NAN, f32::INFINITY, -4.0], 1.75);
        assert!(
            bad.iter().all(|&c| c == 0),
            "nan/inf should map to 0: {bad:?}"
        );
        let hdr = tone_map_gamma_u8([40.0, 20.0, 10.0], 1.75);
        assert!(hdr[0] >= hdr[1] && hdr[1] >= hdr[2]);
        assert!(hdr[0] > 0);
    }

    #[test]
    fn orbital_high_intensity_not_clipped_white() {
        let params = AudioVisualizerParams {
            pattern: AudioVisualizerPattern::OrbitalSpectrum,
            intensity: 2.0,
            ..Default::default()
        };
        let uv = grid_uv(20, 12);
        let bands = vec![0.9f32; BAND_COUNT];
        let mut state = VisualizerSceneState::default();
        let mut out = vec![0u8; uv.len() * 3];
        let mut input = silent_input(&params, &bands, &uv, 1.5);
        input.low = 0.9;
        input.mid = 0.9;
        input.high = 0.9;
        render_visualizer(&mut out, &input, &mut state);
        let mut lit = 0u32;
        let mut flat_white = 0u32;
        for i in 0..uv.len() {
            let r = out[i * 3];
            let g = out[i * 3 + 1];
            let b = out[i * 3 + 2];
            if r.max(g).max(b) > 20 {
                lit += 1;
                if r >= 245 && g >= 245 && b >= 245 {
                    flat_white += 1;
                }
            }
        }
        assert!(lit > 10, "expected lit pixels");
        assert!(
            flat_white * 2 < lit,
            "too many flat-white pixels: {flat_white}/{lit}"
        );
    }

    #[test]
    fn spectrum_bars_base_lat_follows_layout_south_edge() {
        // 60panels-like south edge
        let uv60: Vec<(f32, f32)> = (0..20)
            .map(|i| (i as f32 / 20.0, 0.6624))
            .chain(std::iter::once((0.5, 0.02)))
            .collect();
        let b60 = spectrum_bars_base_lat(&uv60).to_degrees();
        assert!(
            (-32.0..=-29.0).contains(&b60),
            "60panels base should sit just under −29°, got {b60}"
        );

        // 15panels-like south edge
        let uv15: Vec<(f32, f32)> = (0..20)
            .map(|i| (i as f32 / 20.0, 0.6445))
            .chain(std::iter::once((0.5, 0.05)))
            .collect();
        let b15 = spectrum_bars_base_lat(&uv15).to_degrees();
        assert!(
            (-29.0..=-26.0).contains(&b15),
            "15panels base should sit just under −26°, got {b15}"
        );
        assert!(
            b15 > b60 + 1.5,
            "15panels floor should be north of 60panels: 15={b15} 60={b60}"
        );
    }

    #[test]
    fn spectrum_bars_peak_sector_and_height() {
        let params = AudioVisualizerParams {
            pattern: AudioVisualizerPattern::SpectrumBars,
            motion: 0.0,
            persistence: 0.0,
            ..Default::default()
        };
        let uv = grid_uv(32, 16);
        let mut bands = vec![0.0f32; BAND_COUNT];
        bands[4] = 0.95;
        let mut state = VisualizerSceneState::default();
        let mut out = vec![0u8; uv.len() * 3];
        // Warm up bars (persistence=0 still needs a few frames for rise).
        for f in 0..8 {
            let input = silent_input(&params, &bands, &uv, f as f32 * 0.05);
            render_visualizer(&mut out, &input, &mut state);
        }

        let mut sector_lum = [0u32; BAND_COUNT];
        for (i, &(u, _v)) in uv.iter().enumerate() {
            let p = device_uv_to_dir(u, 0.5);
            let lon = p[2].atan2(p[0]);
            let sector = lon_nearest_sector(lon);
            let lum = out[i * 3] as u32 + out[i * 3 + 1] as u32 + out[i * 3 + 2] as u32;
            sector_lum[sector] += lum;
        }
        let max_s = sector_lum
            .iter()
            .enumerate()
            .max_by_key(|(_, l)| *l)
            .map(|(i, _)| i)
            .unwrap();
        assert_eq!(max_s, 4, "peak sector={max_s} lum={sector_lum:?}");

        // Higher energy → more lit area.
        let mut low_out = vec![0u8; uv.len() * 3];
        let mut high_out = vec![0u8; uv.len() * 3];
        let mut bands_lo = vec![0.0f32; BAND_COUNT];
        bands_lo[4] = 0.25;
        let mut bands_hi = vec![0.0f32; BAND_COUNT];
        bands_hi[4] = 0.95;
        let mut st_lo = VisualizerSceneState::default();
        let mut st_hi = VisualizerSceneState::default();
        for f in 0..10 {
            render_visualizer(
                &mut low_out,
                &silent_input(&params, &bands_lo, &uv, f as f32 * 0.05),
                &mut st_lo,
            );
            render_visualizer(
                &mut high_out,
                &silent_input(&params, &bands_hi, &uv, f as f32 * 0.05),
                &mut st_hi,
            );
        }
        let sum_lo: u32 = low_out.iter().map(|&x| x as u32).sum();
        let sum_hi: u32 = high_out.iter().map(|&x| x as u32).sum();
        assert!(
            sum_hi > sum_lo,
            "height should grow: lo={sum_lo} hi={sum_hi}"
        );
    }

    #[test]
    fn spectrum_bars_persistence_decays() {
        let params = AudioVisualizerParams {
            pattern: AudioVisualizerPattern::SpectrumBars,
            persistence: 0.85,
            motion: 0.0,
            ..Default::default()
        };
        let uv = grid_uv(16, 10);
        let mut bands_on = vec![0.0f32; BAND_COUNT];
        bands_on[2] = 1.0;
        let bands_off = vec![0.0f32; BAND_COUNT];
        let mut state = VisualizerSceneState::default();
        let mut out = vec![0u8; uv.len() * 3];
        for f in 0..12 {
            render_visualizer(
                &mut out,
                &silent_input(&params, &bands_on, &uv, f as f32 * 0.04),
                &mut state,
            );
        }
        let peak = state.bar_display[2];
        assert!(peak > 0.5, "bar should charge: {peak}");
        let mut after = Vec::new();
        for f in 0..20 {
            render_visualizer(
                &mut out,
                &silent_input(&params, &bands_off, &uv, 1.0 + f as f32 * 0.04),
                &mut state,
            );
            after.push(state.bar_display[2]);
        }
        assert!(
            after[2] < peak && after[10] < after[2] && after[19] < after[10],
            "expected gradual decay: peak={peak} after={after:?}"
        );
    }

    #[test]
    fn spectrum_bars_silence_is_black() {
        let params = AudioVisualizerParams {
            pattern: AudioVisualizerPattern::SpectrumBars,
            ..Default::default()
        };
        let uv = grid_uv(12, 8);
        let bands = vec![0.0f32; BAND_COUNT];
        let mut state = VisualizerSceneState::default();
        let mut out = vec![0u8; uv.len() * 3];
        render_visualizer(
            &mut out,
            &silent_input(&params, &bands, &uv, 0.2),
            &mut state,
        );
        let sum: u32 = out.iter().map(|&x| x as u32).sum();
        assert_eq!(sum, 0, "spectrum bars should stay black on silence, sum={sum}");
    }

    #[test]
    fn wobbly_ring_seam_and_energy() {
        let params = AudioVisualizerParams {
            pattern: AudioVisualizerPattern::WobblyRing,
            motion: 1.0,
            ..Default::default()
        };
        let uv = grid_uv(24, 12);
        let bands = vec![0.0f32; BAND_COUNT];
        let mut state = VisualizerSceneState::default();
        let mut out = vec![0u8; uv.len() * 3];
        let mut input = silent_input(&params, &bands, &uv, 1.0);
        input.low = 0.7;
        input.rms = 0.3;
        render_visualizer(&mut out, &input, &mut state);

        // Seam continuity: LEDs near u=0 and u=1 at same v should be similar if both lit.
        let mut near0 = None;
        let mut near1 = None;
        for (i, &(u, v)) in uv.iter().enumerate() {
            if (v - 0.5).abs() > 0.08 {
                continue;
            }
            let lum = out[i * 3] as i32 + out[i * 3 + 1] as i32 + out[i * 3 + 2] as i32;
            if u < 0.05 {
                near0 = Some(lum);
            }
            if u > 0.95 {
                near1 = Some(lum);
            }
        }
        if let (Some(a), Some(b)) = (near0, near1) {
            assert!((a - b).abs() < 120, "seam jump a={a} b={b}");
        }

        let mut st_lo = VisualizerSceneState::default();
        let mut st_hi = VisualizerSceneState::default();
        let mut out_lo = vec![0u8; uv.len() * 3];
        let mut out_hi = vec![0u8; uv.len() * 3];
        let mut in_lo = silent_input(&params, &bands, &uv, 2.0);
        in_lo.low = 0.1;
        in_lo.rms = 0.2;
        let mut in_hi = silent_input(&params, &bands, &uv, 2.0);
        in_hi.low = 0.9;
        in_hi.rms = 0.2;
        render_visualizer(&mut out_lo, &in_lo, &mut st_lo);
        render_visualizer(&mut out_hi, &in_hi, &mut st_hi);
        let sum_lo: u32 = out_lo.iter().map(|&x| x as u32).sum();
        let sum_hi: u32 = out_hi.iter().map(|&x| x as u32).sum();
        assert!(
            sum_hi > sum_lo,
            "low energy should thicken ring: {sum_lo} vs {sum_hi}"
        );
    }

    #[test]
    fn wobbly_ring_follows_centroid_and_onset() {
        let params = AudioVisualizerParams {
            pattern: AudioVisualizerPattern::WobblyRing,
            ..Default::default()
        };
        let uv = grid_uv(20, 14);
        let bands = vec![0.0f32; BAND_COUNT];
        let mut state = VisualizerSceneState::default();
        let mut out = vec![0u8; uv.len() * 3];
        for f in 0..40 {
            let mut input = silent_input(&params, &bands, &uv, f as f32 * 0.05);
            input.centroid = 0.9;
            input.low = 0.4;
            input.rms = 0.25;
            render_visualizer(&mut out, &input, &mut state);
        }
        assert!(
            state.ring_tilt > 0.15,
            "high centroid should tilt ring: {}",
            state.ring_tilt
        );

        let amp_before = state.wobble_amp;
        let mut input = silent_input(&params, &bands, &uv, 3.0);
        input.centroid = 0.9;
        input.low = 0.4;
        input.flux = 0.8;
        input.onset = 0.95;
        input.rms = 0.25;
        render_visualizer(&mut out, &input, &mut state);
        assert!(
            state.wobble_amp >= amp_before || state.onset_latch > 0.5,
            "onset/flux should excite wobble"
        );
    }

    #[test]
    fn render_1260_leds_is_fast_enough() {
        let uv = grid_uv(42, 30);
        assert!(uv.len() >= 1200);
        let bands = vec![0.45f32; BAND_COUNT];
        let frames = 20usize;
        let budget_ms = if cfg!(debug_assertions) { 20.0 } else { 2.0 };
        for pattern in [
            AudioVisualizerPattern::RadialSpectrum,
            AudioVisualizerPattern::AuroraGlobe,
            AudioVisualizerPattern::OrbitalSpectrum,
            AudioVisualizerPattern::ImpactConstellation,
            AudioVisualizerPattern::SpectrumBars,
            AudioVisualizerPattern::WobblyRing,
        ] {
            let params = AudioVisualizerParams {
                pattern,
                ..Default::default()
            };
            let mut state = VisualizerSceneState::default();
            let mut out = vec![0u8; uv.len() * 3];
            let mut input = silent_input(&params, &bands, &uv, 0.0);
            input.low = 0.5;
            input.mid = 0.5;
            input.high = 0.4;
            input.rms = 0.3;
            let start = std::time::Instant::now();
            for i in 0..frames {
                input.time_sec = i as f32 / 60.0;
                if pattern == AudioVisualizerPattern::ImpactConstellation && i % 7 == 0 {
                    input.onset = 0.8;
                } else {
                    input.onset = 0.0;
                }
                render_visualizer(&mut out, &input, &mut state);
            }
            let avg_ms = start.elapsed().as_secs_f64() * 1000.0 / frames as f64;
            assert!(
                avg_ms < budget_ms,
                "{:?} average frame {avg_ms:.3}ms exceeds {budget_ms}ms (leds={})",
                pattern,
                uv.len()
            );
        }
    }
}
