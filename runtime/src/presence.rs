//! Presence mode: wake → wait (breathing) → down.
//! Wake/down fire expanding rings (random vivid color) while mate neutral fades in/out.

use std::f32::consts::PI;
use std::time::{Duration, Instant};

use crate::output::{self, ring_dynamics};
use crate::state::{InteractiveEffectKind, InteractivePulse};

/// Mate fade-in / fade-out duration after the ring wavefront passes the equator.
pub const MATE_FADE_SEC: f32 = 0.1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PresencePhase {
    Wake,
    Wait,
    Down,
}

impl PresencePhase {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Wake => "wake",
            Self::Wait => "wait",
            Self::Down => "down",
        }
    }

    /// HTTP-accepted commands only (`wait` is internal).
    pub fn parse_command(s: &str) -> Option<Self> {
        match s {
            "wake" => Some(Self::Wake),
            "down" => Some(Self::Down),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct PresenceState {
    pub phase: PresencePhase,
    pub started: Instant,
    pub ring: Option<InteractivePulse>,
    /// Active down: when mate fade and ring both finish, leave presence for the prior mode.
    pub resume_after_down: bool,
}

impl PresenceState {
    pub fn down_hold(now: Instant) -> Self {
        Self {
            phase: PresencePhase::Down,
            started: now,
            ring: None,
            resume_after_down: false,
        }
    }
}

fn ring_speed() -> f32 {
    1.0
}

/// Time for the pole-origin ring crest to reach the equator (face band).
#[must_use]
pub fn ring_pass_sec() -> f32 {
    let d = ring_dynamics(ring_speed(), 0.0);
    (PI * 0.5) / d.c.max(1e-3)
}

/// Wake / down phase length: ring reaches equator, then mate fades (~0.1s).
#[must_use]
pub fn phase_sec() -> f32 {
    ring_pass_sec() + MATE_FADE_SEC
}

/// Advance Wake → Wait after fade-in; drop spent rings; signal when active down is done.
/// Returns `true` when an active down has finished (mate faded and ring lifetime ended).
pub fn tick_phase(state: &mut PresenceState, now: Instant) -> bool {
    let elapsed = (now - state.started).as_secs_f32();
    if state.phase == PresencePhase::Wake && elapsed >= phase_sec() {
        state.phase = PresencePhase::Wait;
        state.started = now;
        // Keep ring so the wave can finish trailing into wait.
    } else if state.phase == PresencePhase::Wait || state.phase == PresencePhase::Down {
        if let Some(pulse) = state.ring {
            if now >= pulse.started + pulse.duration {
                state.ring = None;
            }
        }
    }

    if state.resume_after_down
        && state.phase == PresencePhase::Down
        && state.ring.is_none()
        && elapsed >= phase_sec()
    {
        state.resume_after_down = false;
        return true;
    }
    false
}

/// Mate opacity: stays off/on until the ring passes the equator, then fades in ~0.1s.
#[must_use]
pub fn mate_fade(phase: PresencePhase, elapsed: f32) -> f32 {
    let pass = ring_pass_sec();
    let fade_t = MATE_FADE_SEC.max(1e-3);
    match phase {
        PresencePhase::Wake => {
            if elapsed < pass {
                0.0
            } else {
                smooth01((elapsed - pass) / fade_t)
            }
        }
        PresencePhase::Wait => 1.0,
        PresencePhase::Down => {
            if elapsed < pass {
                1.0
            } else if elapsed >= pass + fade_t {
                0.0
            } else {
                1.0 - smooth01((elapsed - pass) / fade_t)
            }
        }
    }
}

#[must_use]
fn smooth01(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn mix64(mut x: u64) -> u64 {
    x = (x ^ (x >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    x ^ (x >> 31)
}

fn hsv_to_rgb(h: f32, s: f32, v: f32) -> (u8, u8, u8) {
    let h = h.rem_euclid(1.0);
    let s = s.clamp(0.0, 1.0);
    let v = v.clamp(0.0, 1.0);
    let hh = h * 6.0;
    let sector = hh.floor() as i32;
    let f = hh - sector as f32;
    let p = v * (1.0 - s);
    let q = v * (1.0 - f * s);
    let t = v * (1.0 - (1.0 - f) * s);
    let (r, g, b) = match sector.rem_euclid(6) {
        0 => (v, t, p),
        1 => (q, v, p),
        2 => (p, v, t),
        3 => (p, q, v),
        4 => (t, p, v),
        _ => (v, p, q),
    };
    (
        (r * 255.0).round().clamp(0.0, 255.0) as u8,
        (g * 255.0).round().clamp(0.0, 255.0) as u8,
        (b * 255.0).round().clamp(0.0, 255.0) as u8,
    )
}

#[must_use]
pub fn random_vivid_rgb(seed: u64) -> (u8, u8, u8) {
    let h = mix64(seed);
    let hue = (h % 1_000_000) as f32 / 1_000_000.0;
    hsv_to_rgb(hue, 0.9, 0.97)
}

/// Expanding ring from north (`v=0`) or south (`v=1`) pole with a random vivid color.
#[must_use]
pub fn make_pole_ring(center_v: f32, now: Instant, seed: u64) -> InteractivePulse {
    let (cr, cg, cb) = random_vivid_rgb(seed);
    let dyn_ = ring_dynamics(ring_speed(), 0.0);
    InteractivePulse {
        center_u: 0.5,
        center_v: center_v.clamp(0.0, 1.0),
        amplitude: 1.15,
        sigma_rad: 0.14,
        effect: InteractiveEffectKind::ExpandingRingDiagonal,
        started: now,
        duration: Duration::from_secs_f32(dyn_.lifetime),
        color_r: cr,
        color_g: cg,
        color_b: cb,
        ring_speed: ring_speed(),
        ring_thickness_rad: 0.0,
    }
}

pub fn scale_rgb(rgb: &mut [u8], gain: f32) {
    let g = gain.clamp(0.0, 1.0);
    if (g - 1.0).abs() < 1e-5 {
        return;
    }
    if g <= 1e-5 {
        rgb.fill(0);
        return;
    }
    for c in rgb.iter_mut() {
        *c = ((*c as f32) * g).round().clamp(0.0, 255.0) as u8;
    }
}

/// Composite mate base (already in `rgb`) with optional expanding ring.
pub fn overlay_ring(
    rgb: &mut [u8],
    uv: &[(f32, f32)],
    ring: Option<&InteractivePulse>,
    now: Instant,
) {
    let Some(pulse) = ring else {
        return;
    };
    if now >= pulse.started + pulse.duration {
        return;
    }
    output::overlay_expanding_ring(rgb, uv, pulse, now);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_command_accepts_wake_and_down_only() {
        assert_eq!(
            PresencePhase::parse_command("wake"),
            Some(PresencePhase::Wake)
        );
        assert_eq!(
            PresencePhase::parse_command("down"),
            Some(PresencePhase::Down)
        );
        assert_eq!(PresencePhase::parse_command("wait"), None);
        assert_eq!(PresencePhase::parse_command("pose"), None);
    }

    #[test]
    fn wake_ticks_to_wait() {
        let mut state = PresenceState {
            phase: PresencePhase::Wake,
            started: Instant::now(),
            ring: Some(make_pole_ring(0.0, Instant::now(), 1)),
            resume_after_down: false,
        };
        let t_mid = state.started + Duration::from_millis(50);
        assert!(!tick_phase(&mut state, t_mid));
        assert_eq!(state.phase, PresencePhase::Wake);
        let t_end = state.started + Duration::from_secs_f32(phase_sec() + 0.05);
        assert!(!tick_phase(&mut state, t_end));
        assert_eq!(state.phase, PresencePhase::Wait);
    }

    #[test]
    fn down_keeps_ring_past_mate_fade_then_resumes() {
        let started = Instant::now();
        let ring = make_pole_ring(1.0, started, 7);
        let ring_end = ring.started + ring.duration;
        let mut state = PresenceState {
            phase: PresencePhase::Down,
            started,
            ring: Some(ring),
            resume_after_down: true,
        };
        let after_fade = started + Duration::from_secs_f32(phase_sec() + 0.02);
        assert!(!tick_phase(&mut state, after_fade));
        assert!(state.ring.is_some());
        assert!(state.resume_after_down);
        assert!(tick_phase(&mut state, ring_end + Duration::from_millis(1)));
        assert!(state.ring.is_none());
        assert!(!state.resume_after_down);
    }

    #[test]
    fn mate_fade_waits_for_ring_pass_then_snaps() {
        let pass = ring_pass_sec();
        assert!(mate_fade(PresencePhase::Wake, 0.0) < 0.05);
        assert!(mate_fade(PresencePhase::Wake, pass * 0.5) < 0.05);
        assert!((mate_fade(PresencePhase::Wake, pass + MATE_FADE_SEC) - 1.0).abs() < 1e-3);
        assert!((mate_fade(PresencePhase::Wait, 1.0) - 1.0).abs() < 1e-5);
        assert!((mate_fade(PresencePhase::Down, 0.0) - 1.0).abs() < 1e-3);
        assert!((mate_fade(PresencePhase::Down, pass * 0.5) - 1.0).abs() < 1e-3);
        assert!(mate_fade(PresencePhase::Down, pass + MATE_FADE_SEC) < 0.05);
    }

    #[test]
    fn pole_ring_uses_expanding_effect() {
        let p = make_pole_ring(0.0, Instant::now(), 42);
        assert_eq!(p.effect, InteractiveEffectKind::ExpandingRingDiagonal);
        assert!((p.center_v - 0.0).abs() < 1e-5);
        let s = make_pole_ring(1.0, Instant::now(), 43);
        assert!((s.center_v - 1.0).abs() < 1e-5);
    }
}
