//! Built-in procedural loop demos (layout-independent).

use std::sync::OnceLock;
use std::time::{Duration, Instant};

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
}

type DemoRenderer = fn(&[(f32, f32)], Duration, &mut [u8]);

impl DemoId {
    pub fn parse(id: &str) -> Option<Self> {
        let rest = id.strip_prefix(DEMO_PREFIX)?;
        match rest {
            "expanding-rings" => Some(Self::ExpandingRings),
            "rainbow-sweep" => Some(Self::RainbowSweep),
            "twinkle" => Some(Self::Twinkle),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::ExpandingRings => "expanding-rings",
            Self::RainbowSweep => "rainbow-sweep",
            Self::Twinkle => "twinkle",
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
        }
    }

    pub fn all() -> [Self; 3] {
        [Self::ExpandingRings, Self::RainbowSweep, Self::Twinkle]
    }

    fn renderer(self) -> DemoRenderer {
        match self {
            Self::ExpandingRings => render_expanding_rings,
            Self::RainbowSweep => render_rainbow_sweep,
            Self::Twinkle => render_twinkle,
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

fn render_expanding_rings(uv: &[(f32, f32)], elapsed: Duration, out: &mut [u8]) {
    static SPECS: OnceLock<Vec<RingPulseSpec>> = OnceLock::new();
    let specs = SPECS.get_or_init(expanding_ring_specs);
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

pub fn render(demo: DemoId, elapsed: Duration, uv: &[(f32, f32)], out: &mut [u8]) {
    demo.render_into(elapsed, uv, out);
}

pub fn frame_index_at(demo: DemoId, elapsed: Duration) -> u32 {
    let fps = demo.fps();
    let period = demo.loop_period();
    let t = elapsed.as_secs_f64() % period.as_secs_f64();
    (t * fps as f64).floor() as u32
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
