//! Equirect placement baking: planar patch on equirect UV, or stereographic sphere patch.
//!
//! Glowbe UV (shared with `sphere.rs` and the Studio 2D map):
//! - `u` ∈ [0,1): longitude (periodic)
//! - `v` = 0 at north (+Y), `v` = 1 at south (−Y); image row 0 is north
//!
//! Placement:
//! - `equirect-planar`: `centerU` / `centerV` + `rollDeg`. `scale` = 1 fits the source in the
//!   equirect UV map (2:1) without distortion, maximizing width or height.
//! - `stereographic`: `yawDeg` / `pitchDeg` + `rollDeg`

use image::RgbaImage;

use crate::orientation::uv_from_yaw_pitch_deg;
use crate::sphere::unit_dir_from_equirect_uv_y_up;

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipPlacement {
    pub mode: String,
    /// Planar: equirect patch center. Ignored for stereographic bake.
    #[serde(default = "default_center_u")]
    pub center_u: f32,
    #[serde(default = "default_center_v")]
    pub center_v: f32,
    /// Stereographic: patch center orientation. Ignored for planar bake.
    #[serde(default)]
    pub yaw_deg: f32,
    #[serde(default)]
    pub pitch_deg: f32,
    #[serde(default = "default_scale")]
    pub scale: f32,
    /// Twist about patch outward axis.
    pub roll_deg: f32,
    pub source_aspect: f32,
}

fn default_center_u() -> f32 {
    0.5
}
fn default_center_v() -> f32 {
    0.5
}
fn default_scale() -> f32 {
    1.0
}

impl ClipPlacement {
    pub fn scale(&self) -> f32 {
        if self.scale.is_finite() && self.scale > 0.0 {
            self.scale
        } else {
            1.0
        }
    }

    pub fn source_aspect(&self) -> f32 {
        if self.source_aspect.is_finite() && self.source_aspect > 0.01 {
            self.source_aspect
        } else {
            1.0
        }
    }

    pub fn stereo_center_uv(&self) -> (f32, f32) {
        uv_from_yaw_pitch_deg(self.yaw_deg, self.pitch_deg)
    }
}

/// Planar patch UV half-extents at `scale = 1` (fit-contain in equirect 2:1).
/// Returns `(half_u, half_v)` so displayed aspect matches `source_aspect`.
#[must_use]
pub fn planar_fit_half_extents(source_aspect: f32) -> (f32, f32) {
    let aspect = if source_aspect.is_finite() && source_aspect > 0.01 {
        source_aspect
    } else {
        1.0
    };
    // Equirect texture is 2:1 → patch display aspect = 2·Δu / Δv must equal `aspect`.
    let (full_u, full_v) = if aspect >= 2.0 {
        (1.0, 2.0 / aspect)
    } else {
        (aspect / 2.0, 1.0)
    };
    (full_u * 0.5, full_v * 0.5)
}

/// Bake one source RGBA frame into equirect RGB bytes (`width * height * 3`).
pub fn bake_frame_rgba_with_placement(
    rgba: &RgbaImage,
    placement: &ClipPlacement,
    out_w: u32,
    out_h: u32,
) -> Vec<u8> {
    let sw = rgba.width().max(1);
    let sh = rgba.height().max(1);
    let mut out = vec![0u8; (out_w * out_h * 3) as usize];
    for y in 0..out_h {
        for x in 0..out_w {
            let u = (x as f32 + 0.5) / out_w as f32;
            let v = (y as f32 + 0.5) / out_h as f32;
            let rgb = sample_output_uv(rgba, sw, sh, placement, u, v);
            let o = ((y * out_w + x) * 3) as usize;
            out[o] = rgb[0];
            out[o + 1] = rgb[1];
            out[o + 2] = rgb[2];
        }
    }
    out
}

fn sample_output_uv(
    rgba: &RgbaImage,
    sw: u32,
    sh: u32,
    placement: &ClipPlacement,
    u: f32,
    v: f32,
) -> [u8; 3] {
    match placement.mode.as_str() {
        "stereographic" => sample_stereographic(rgba, sw, sh, placement, u, v),
        _ => sample_equirect_planar(rgba, sw, sh, placement, u, v),
    }
}

fn sample_equirect_planar(
    rgba: &RgbaImage,
    sw: u32,
    sh: u32,
    p: &ClipPlacement,
    u: f32,
    v: f32,
) -> [u8; 3] {
    let scale = p.scale();
    let (base_half_u, base_half_v) = planar_fit_half_extents(p.source_aspect());
    let half_w = base_half_u * scale;
    let half_h = base_half_v * scale;
    let rad = p.roll_deg.to_radians();
    let cos = rad.cos();
    let sin = rad.sin();
    let du = u - p.center_u;
    let dv = v - p.center_v;
    let lx = du * cos + dv * sin;
    let ly = -du * sin + dv * cos;
    if lx.abs() > half_w || ly.abs() > half_h {
        return [0, 0, 0];
    }
    let su = (lx / half_w + 1.0) * 0.5;
    let sv = (ly / half_h + 1.0) * 0.5;
    sample_rgba_bilinear(rgba, sw, sh, su, sv)
}

fn sample_stereographic(
    rgba: &RgbaImage,
    sw: u32,
    sh: u32,
    p: &ClipPlacement,
    u: f32,
    v: f32,
) -> [u8; 3] {
    let d_world = unit_dir_from_equirect_uv_y_up(u, v);
    let (cu, cv) = p.stereo_center_uv();
    let basis = patch_basis_at(cu, cv);
    let mut d_local = world_to_patch_local(d_world, &basis);
    if p.roll_deg.abs() > 1e-6 {
        d_local = rotate_local_y(d_local, p.roll_deg.to_radians());
    }
    let Some((sx, sy)) = stereographic_inverse_to_plane_local(d_local) else {
        return [0, 0, 0];
    };
    let scale = p.scale();
    let aspect = p.source_aspect();
    let px = sx / scale;
    let py = sy / (scale / aspect);
    if px.abs() > 1.0 || py.abs() > 1.0 {
        return [0, 0, 0];
    }
    // Match planar patch: +X = east (u↑), +Z = south (v↑), image v increases downward.
    let su = (px + 1.0) * 0.5;
    let sv = (py + 1.0) * 0.5;
    sample_rgba_bilinear(rgba, sw, sh, su, sv)
}

/// Patch tangent frame at equirect center.
/// Local +Y = outward (patch center), +X = east (u↑), +Z = south (v↑).
struct PatchBasis {
    east: [f32; 3],
    up: [f32; 3],
    south: [f32; 3],
}

fn patch_basis_at(center_u: f32, center_v: f32) -> PatchBasis {
    let up = unit_dir_from_equirect_uv_y_up(center_u, center_v);
    let eps = 1e-4;
    let u_plus = unit_dir_from_equirect_uv_y_up(center_u + eps, center_v);
    let mut east = [
        u_plus[0] - up[0],
        u_plus[1] - up[1],
        u_plus[2] - up[2],
    ];
    let dot_e = east[0] * up[0] + east[1] * up[1] + east[2] * up[2];
    east[0] -= dot_e * up[0];
    east[1] -= dot_e * up[1];
    east[2] -= dot_e * up[2];
    let el = (east[0] * east[0] + east[1] * east[1] + east[2] * east[2]).sqrt();
    let east = if el < 1e-5 {
        let (e, _) = crate::orientation::tangent_east_north(up);
        e
    } else {
        [east[0] / el, east[1] / el, east[2] / el]
    };
    // up × east = south (increasing equirect v): at equator front, +X × +Z = −Y.
    let south = [
        up[1] * east[2] - up[2] * east[1],
        up[2] * east[0] - up[0] * east[2],
        up[0] * east[1] - up[1] * east[0],
    ];
    PatchBasis {
        east,
        up,
        south: normalize3(south),
    }
}

fn world_to_patch_local(d: [f32; 3], b: &PatchBasis) -> [f32; 3] {
    [
        d[0] * b.east[0] + d[1] * b.east[1] + d[2] * b.east[2],
        d[0] * b.up[0] + d[1] * b.up[1] + d[2] * b.up[2],
        d[0] * b.south[0] + d[1] * b.south[1] + d[2] * b.south[2],
    ]
}

fn rotate_local_y(d: [f32; 3], angle: f32) -> [f32; 3] {
    let c = angle.cos();
    let s = angle.sin();
    [
        d[0] * c - d[2] * s,
        d[1],
        d[0] * s + d[2] * c,
    ]
}

/// Stereographic plane (X,Y) → unit dir in patch-local coords (+Y = outward).
/// Plane +X → east, plane +Y → south (same sense as equirect v↑ / planar ly).
fn stereographic_plane_to_local_dir(x: f32, y: f32) -> [f32; 3] {
    let denom = x * x + y * y + 1.0;
    if denom < 1e-8 {
        return [0.0, 1.0, 0.0];
    }
    let lx = 2.0 * x / denom;
    let lz = 2.0 * y / denom;
    let ly = (1.0 - x * x - y * y) / denom;
    normalize3([lx, ly, lz])
}

fn stereographic_inverse_to_plane_local(d: [f32; 3]) -> Option<(f32, f32)> {
    let len = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
    if len < 1e-6 {
        return None;
    }
    let lx = d[0] / len;
    let ly = d[1] / len;
    let lz = d[2] / len;
    if ly <= -0.9999 {
        return None;
    }
    let denom = 1.0 + ly;
    if denom.abs() < 1e-6 {
        return Some((0.0, 0.0));
    }
    Some((lx / denom, lz / denom))
}

fn sample_rgba_bilinear(img: &RgbaImage, w: u32, h: u32, u: f32, v: f32) -> [u8; 3] {
    let u = u.clamp(0.0, 1.0);
    let v = v.clamp(0.0, 1.0);
    let x = u * (w.saturating_sub(1)) as f32;
    let y = v * (h.saturating_sub(1)) as f32;
    let x0 = x.floor() as u32;
    let y0 = y.floor() as u32;
    let x1 = (x0 + 1).min(w - 1);
    let y1 = (y0 + 1).min(h - 1);
    let tx = x - x.floor();
    let ty = y - y.floor();
    let c00 = img.get_pixel(x0, y0).0;
    let c10 = img.get_pixel(x1, y0).0;
    let c01 = img.get_pixel(x0, y1).0;
    let c11 = img.get_pixel(x1, y1).0;
    [
        lerp4(c00[0], c10[0], c01[0], c11[0], tx, ty),
        lerp4(c00[1], c10[1], c01[1], c11[1], tx, ty),
        lerp4(c00[2], c10[2], c01[2], c11[2], tx, ty),
    ]
}

fn lerp4(a: u8, b: u8, c: u8, d: u8, tx: f32, ty: f32) -> u8 {
    let top = a as f32 * (1.0 - tx) + b as f32 * tx;
    let bot = c as f32 * (1.0 - tx) + d as f32 * tx;
    (top * (1.0 - ty) + bot * ty).round().clamp(0.0, 255.0) as u8
}

fn normalize3(v: [f32; 3]) -> [f32; 3] {
    let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if len < 1e-8 {
        return [0.0, 1.0, 0.0];
    }
    [v[0] / len, v[1] / len, v[2] / len]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stereographic_center_maps_to_north() {
        let d = stereographic_plane_to_local_dir(0.0, 0.0);
        assert!((d[1] - 1.0).abs() < 1e-4);
    }

    #[test]
    fn stereographic_roundtrip_near_center() {
        let d = stereographic_plane_to_local_dir(0.1, 0.05);
        let (x, y) = stereographic_inverse_to_plane_local(d).unwrap();
        assert!((x - 0.1).abs() < 0.02);
        assert!((y - 0.05).abs() < 0.02);
    }

    #[test]
    fn stereographic_plane_y_aligns_with_south_at_equator() {
        let (cu, cv) = uv_from_yaw_pitch_deg(0.0, 0.0);
        let basis = patch_basis_at(cu, cv);
        assert!(basis.south[1] < -0.9, "south tangent should be −Y, got {:?}", basis.south);
        let d_local = stereographic_plane_to_local_dir(0.0, 0.2);
        assert!(d_local[2] > d_local[0].abs());
        let d_world = [
            d_local[0] * basis.east[0] + d_local[1] * basis.up[0] + d_local[2] * basis.south[0],
            d_local[0] * basis.east[1] + d_local[1] * basis.up[1] + d_local[2] * basis.south[1],
            d_local[0] * basis.east[2] + d_local[1] * basis.up[2] + d_local[2] * basis.south[2],
        ];
        assert!(d_world[1] < 0.0, "plane +Y should map toward south (−Y)");
        let back = world_to_patch_local(d_world, &basis);
        assert!((back[0] - d_local[0]).abs() < 1e-4);
        assert!((back[1] - d_local[1]).abs() < 1e-4);
        assert!((back[2] - d_local[2]).abs() < 1e-4);
    }

    #[test]
    fn stereographic_plane_x_aligns_with_east_at_equator() {
        let (cu, cv) = uv_from_yaw_pitch_deg(0.0, 0.0);
        let basis = patch_basis_at(cu, cv);
        let d_local = stereographic_plane_to_local_dir(0.2, 0.0);
        assert!(d_local[0] > d_local[2].abs());
        let d_world = [
            d_local[0] * basis.east[0] + d_local[1] * basis.up[0] + d_local[2] * basis.south[0],
            d_local[0] * basis.east[1] + d_local[1] * basis.up[1] + d_local[2] * basis.south[1],
            d_local[0] * basis.east[2] + d_local[1] * basis.up[2] + d_local[2] * basis.south[2],
        ];
        let back = world_to_patch_local(d_world, &basis);
        assert!((back[0] - d_local[0]).abs() < 1e-4);
        assert!((back[1] - d_local[1]).abs() < 1e-4);
        assert!((back[2] - d_local[2]).abs() < 1e-4);
    }

    #[test]
    fn planar_scale_one_fits_wide_source_to_full_u() {
        let (hu, hv) = planar_fit_half_extents(2.0);
        assert!((hu - 0.5).abs() < 1e-4);
        assert!((hv - 0.5).abs() < 1e-4);
    }

    #[test]
    fn planar_scale_one_fits_tall_source_to_full_v() {
        let (hu, hv) = planar_fit_half_extents(1.0);
        assert!((hu - 0.25).abs() < 1e-4);
        assert!((hv - 0.5).abs() < 1e-4);
    }

    #[test]
    fn planar_outside_is_black() {
        let img = RgbaImage::from_pixel(10, 10, image::Rgba([255, 0, 0, 255]));
        let p = ClipPlacement {
            mode: "equirect-planar".into(),
            center_u: 0.5,
            center_v: 0.5,
            yaw_deg: 0.0,
            pitch_deg: 0.0,
            scale: 0.1,
            roll_deg: 0.0,
            source_aspect: 1.0,
        };
        let rgb = sample_equirect_planar(&img, 10, 10, &p, 0.01, 0.01);
        assert_eq!(rgb, [0, 0, 0]);
        let rgb2 = sample_equirect_planar(&img, 10, 10, &p, 0.5, 0.5);
        assert_eq!(rgb2[0], 255);
    }

    #[test]
    fn yaw_pitch_matches_front_uv() {
        let (u, v) = uv_from_yaw_pitch_deg(0.0, 0.0);
        assert!((u - 0.5).abs() < 1e-4);
        assert!((v - 0.5).abs() < 1e-4);
    }
}
