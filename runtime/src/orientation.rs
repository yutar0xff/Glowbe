//! Shared orientation: Y-up, right-handed, degrees at API boundaries.
//!
//! ## Canon
//! - **Front** (device content): equirect `u = 0.5` → world **+X**
//! - **v = 0** → north **+Y**, **v = 1** → south **−Y**
//! - **yawDeg**: rotation about **+Y**, right-hand (from +X toward **−Z**). Shifts equirect `u` by
//!   `u' = (u − yawDeg/360) mod 1`.
//! - **pitchDeg**: elevation from the equator toward **+Y** (positive = north / nose-up), ∈ [−90, 90].
//! - **rollDeg**: twist about the local outward (view / patch) axis, right-hand.
//!
//! Wanted direction from yaw/pitch:
//! `λ = −yawDeg·π/180`, `φ = pitchDeg·π/180`,
//! `dir = (cos φ cos λ, sin φ, cos φ sin λ)` (`λ = 0` → +X).

use crate::sphere::{equirect_uv_from_unit_dir_y_up, unit_dir_from_equirect_uv_y_up};

/// Apply device / content `yawDeg` (RH about +Y) to equirect longitude `u`.
#[must_use]
pub fn apply_yaw_deg_u(u: f32, yaw_deg: f32) -> f32 {
    (u - yaw_deg / 360.0).rem_euclid(1.0)
}

/// Unit direction from yaw/pitch degrees (Y-up, RH).
#[must_use]
pub fn unit_dir_from_yaw_pitch_deg(yaw_deg: f32, pitch_deg: f32) -> [f32; 3] {
    let pitch = pitch_deg.clamp(-90.0, 90.0).to_radians();
    let yaw = yaw_deg.to_radians();
    // λ = −yaw so +yaw is RH about +Y (from +X toward −Z).
    let lam = -yaw;
    let cp = pitch.cos();
    [cp * lam.cos(), pitch.sin(), cp * lam.sin()]
}

/// Yaw/pitch degrees from a unit direction.
#[must_use]
pub fn yaw_pitch_deg_from_unit_dir(x: f32, y: f32, z: f32) -> (f32, f32) {
    let len = (x * x + y * y + z * z).sqrt().max(1e-8);
    let nx = x / len;
    let ny = (y / len).clamp(-1.0, 1.0);
    let nz = z / len;
    let pitch_deg = ny.asin().to_degrees();
    let lam = nz.atan2(nx);
    let yaw_deg = (-lam).to_degrees();
    (yaw_deg, pitch_deg)
}

/// Equirect `(u, v)` from yaw/pitch degrees.
#[must_use]
pub fn uv_from_yaw_pitch_deg(yaw_deg: f32, pitch_deg: f32) -> (f32, f32) {
    let d = unit_dir_from_yaw_pitch_deg(yaw_deg, pitch_deg);
    equirect_uv_from_unit_dir_y_up(d[0], d[1], d[2])
}

/// Yaw/pitch degrees from equirect `(u, v)`.
#[must_use]
pub fn yaw_pitch_deg_from_uv(u: f32, v: f32) -> (f32, f32) {
    let d = unit_dir_from_equirect_uv_y_up(u, v);
    yaw_pitch_deg_from_unit_dir(d[0], d[1], d[2])
}

/// Local tangent basis at a direction: `east` = increasing longitude (u↑), `north` = toward +Y.
/// At the poles, `east` falls back to +Z.
#[must_use]
pub fn tangent_east_north(dir: [f32; 3]) -> ([f32; 3], [f32; 3]) {
    let world_up = [0.0f32, 1.0, 0.0];
    let mut east = cross3(dir, world_up);
    let el = len3(east);
    if el < 1e-5 {
        east = [0.0, 0.0, 1.0];
    } else {
        east = [east[0] / el, east[1] / el, east[2] / el];
    }
    let north = normalize3(cross3(east, dir));
    (east, north)
}

/// Apply roll (deg, RH about `dir`) to the east/north tangent basis.
#[must_use]
pub fn roll_tangent_basis(
    east: [f32; 3],
    north: [f32; 3],
    roll_deg: f32,
) -> ([f32; 3], [f32; 3]) {
    let r = roll_deg.to_radians();
    let (s, c) = r.sin_cos();
    let east_r = [
        east[0] * c + north[0] * s,
        east[1] * c + north[1] * s,
        east[2] * c + north[2] * s,
    ];
    let north_r = [
        -east[0] * s + north[0] * c,
        -east[1] * s + north[1] * c,
        -east[2] * s + north[2] * c,
    ];
    (east_r, north_r)
}

fn cross3(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn len3(v: [f32; 3]) -> f32 {
    (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt()
}

fn normalize3(v: [f32; 3]) -> [f32; 3] {
    let l = len3(v).max(1e-8);
    [v[0] / l, v[1] / l, v[2] / l]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yaw_zero_pitch_zero_is_plus_x() {
        let d = unit_dir_from_yaw_pitch_deg(0.0, 0.0);
        assert!((d[0] - 1.0).abs() < 1e-4);
        assert!(d[1].abs() < 1e-4);
        assert!(d[2].abs() < 1e-4);
    }

    #[test]
    fn positive_yaw_moves_toward_minus_z() {
        let d = unit_dir_from_yaw_pitch_deg(90.0, 0.0);
        assert!(d[0].abs() < 1e-4);
        assert!((d[2] + 1.0).abs() < 1e-4, "got {d:?}");
    }

    #[test]
    fn positive_pitch_is_north() {
        let d = unit_dir_from_yaw_pitch_deg(0.0, 90.0);
        assert!((d[1] - 1.0).abs() < 1e-4);
    }

    #[test]
    fn yaw_pitch_uv_roundtrip_equator() {
        for &yaw in &[0.0f32, 45.0, -30.0, 180.0] {
            let (u, v) = uv_from_yaw_pitch_deg(yaw, 0.0);
            let (y2, p2) = yaw_pitch_deg_from_uv(u, v);
            let dy = (yaw - y2).rem_euclid(360.0);
            let dy = dy.min(360.0 - dy);
            assert!(dy < 0.05, "yaw {yaw} -> {y2}");
            assert!(p2.abs() < 0.05, "pitch {p2}");
        }
    }

    #[test]
    fn apply_yaw_rh_shifts_u_negative() {
        // +90° yaw → front content that was at u=0.5 moves geometrically; u param decreases.
        let u = apply_yaw_deg_u(0.5, 90.0);
        assert!((u - 0.25).abs() < 1e-4, "got {u}");
    }
}
