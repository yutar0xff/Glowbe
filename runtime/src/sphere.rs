//! 正距円筒 UV と球面上の幾何。リップル合成は **大円角距離** で円形波面にする。
//!
//! 画像サンプリング（`media::sample_bilinear_rgb`）と同じ向き:
//! - `u` は水平方向 0..1（経度、周期境界）。
//! - `v` は 0 が上（北極側）、1 が下（南極側）。

use std::f32::consts::PI;

/// 単位球上の方向ベクトル（Y 上、正規化済み）。
#[must_use]
pub fn unit_dir_from_equirect_uv_y_up(u: f32, v: f32) -> [f32; 3] {
    let u = u.rem_euclid(1.0);
    let v = v.clamp(0.0, 1.0);
    let lam = 2.0 * PI * u - PI;
    let phi = 0.5 * PI - PI * v;
    let cp = phi.cos();
    let x = cp * lam.cos();
    let y = phi.sin();
    let z = cp * lam.sin();
    [x, y, z]
}

/// 単位球上の方向ベクトル（Y 上）から正距円筒 UV へ戻す。`unit_dir_from_equirect_uv_y_up` の逆。
#[must_use]
pub fn equirect_uv_from_unit_dir_y_up(x: f32, y: f32, z: f32) -> (f32, f32) {
    let ny = y.clamp(-1.0, 1.0);
    let phi = ny.asin();
    let v = (0.5 - phi / PI).clamp(0.0, 1.0);
    let lam = z.atan2(x);
    let u = ((lam + PI) / (2.0 * PI)).rem_euclid(1.0);
    (u, v)
}

/// 正距円筒の経度 `u` を、デバイス正面の yaw（度）ぶん回した値（[0,1) にラップ）。
///
/// **右手系・+Y まわり**: 正の `front_yaw_deg` は +X → −Z（`u' = (u − yaw/360) mod 1`）。
/// 詳細は `orientation` モジュール。全モードがサンプリング前に `u` をずらすだけで
/// 「正面」を再定義する。
#[must_use]
pub fn apply_front_yaw_u(u: f32, front_yaw_deg: f32) -> f32 {
    crate::orientation::apply_yaw_deg_u(u, front_yaw_deg)
}

/// 単位ベクトル同士のなす角（ラジアン）∈ [0, π]。
#[must_use]
pub fn angle_rad_between_unit(a: [f32; 3], b: [f32; 3]) -> f32 {
    let dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]).clamp(-1.0, 1.0);
    dot.acos()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn self_angle_is_zero() {
        let d = unit_dir_from_equirect_uv_y_up(0.37, 0.62);
        assert!(angle_rad_between_unit(d, d) < 1e-5);
    }

    #[test]
    fn equator_longitude_symmetry() {
        let c = unit_dir_from_equirect_uv_y_up(0.25, 0.5);
        let a = unit_dir_from_equirect_uv_y_up(0.26, 0.5);
        let b = unit_dir_from_equirect_uv_y_up(0.24, 0.5);
        let ta = angle_rad_between_unit(c, a);
        let tb = angle_rad_between_unit(c, b);
        assert!((ta - tb).abs() < 1e-4);
    }

    #[test]
    fn uv_dir_roundtrip() {
        for &(u, v) in &[(0.1f32, 0.2f32), (0.5, 0.5), (0.83, 0.71), (0.0, 0.5)] {
            let d = unit_dir_from_equirect_uv_y_up(u, v);
            let (u2, v2) = equirect_uv_from_unit_dir_y_up(d[0], d[1], d[2]);
            assert!((v - v2).abs() < 1e-4, "v {v} != {v2}");
            let du = (u - u2).rem_euclid(1.0);
            assert!(!(1e-4..=1.0 - 1e-4).contains(&du), "u {u} != {u2}");
        }
    }

    #[test]
    fn antipode_is_pi() {
        let a = unit_dir_from_equirect_uv_y_up(0.25, 0.5);
        let b = unit_dir_from_equirect_uv_y_up(0.75, 0.5);
        let th = angle_rad_between_unit(a, b);
        assert!((th - PI).abs() < 0.02);
    }

    #[test]
    fn front_yaw_positive_decreases_u() {
        let u = apply_front_yaw_u(0.5, 90.0);
        assert!((u - 0.25).abs() < 1e-4);
    }
}
