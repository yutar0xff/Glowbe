//! Pixel-art stamp assets: load `.stamp.json`, keep color regions for runtime
//! recoloring, and build an SDF from the native pixel grid at load time.

use std::collections::HashMap;
use std::path::Path;

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use tracing::warn;

use super::stamp_edt::sdf_from_mask;

const BUILTIN_STAMPS: &[&str] = &[
    include_str!("stamps/heart.stamp.json"),
    include_str!("stamps/anger.stamp.json"),
    include_str!("stamps/water_drop.stamp.json"),
];

const OUTSIDE_SDF: f32 = 1.5;

#[derive(Debug, Clone)]
pub struct StampMask {
    pub id: String,
    size: u32,
    /// Source design colors; runtime recoloring maps onto these slots by index.
    palette: Vec<[u8; 3]>,
    /// One entry per pixel: 0 = outside, n = `palette[n - 1]`.
    pixels: Vec<u8>,
    range: f32,
    sdf: Vec<f32>,
}

impl StampMask {
    fn build(id: String, size: u32, palette: Vec<[u8; 3]>, pixels: Vec<u8>) -> Result<Self> {
        if id.is_empty() || id.contains('/') || id.contains('\\') {
            bail!("stamp id must be non-empty and path-safe");
        }
        let expected = (size * size) as usize;
        if pixels.len() != expected {
            bail!("pixel count must be {size}×{size}");
        }
        for &p in &pixels {
            if p as usize > palette.len() {
                bail!("pixel index {p} out of palette range {}", palette.len());
            }
        }
        let bool_mask: Vec<bool> = pixels.iter().map(|&v| v != 0).collect();
        let sdf = sdf_from_mask(&bool_mask, size);
        let range = sdf.iter().map(|d| d.abs()).fold(OUTSIDE_SDF, f32::max);
        Ok(Self {
            id,
            size,
            palette,
            pixels,
            range,
            sdf,
        })
    }

    pub fn palette(&self) -> &[[u8; 3]] {
        &self.palette
    }

    /// Palette index (0-based) of the pixel under the tangent-space point, or
    /// `None` when the point falls outside the stamp.
    pub fn sample_index(&self, tangent_x: f32, tangent_y: f32, angular_half: f32) -> Option<usize> {
        let half = angular_half.max(1e-4);
        let u = tangent_x / half * 0.5 + 0.5;
        let v = 0.5 - tangent_y / half * 0.5;
        if !(0.0..1.0).contains(&u) || !(0.0..1.0).contains(&v) {
            return None;
        }
        let px = ((u * self.size as f32).floor() as u32).min(self.size - 1);
        let py = ((v * self.size as f32).floor() as u32).min(self.size - 1);
        let cell = self.pixels[(py * self.size + px) as usize];
        if cell == 0 {
            None
        } else {
            Some((cell - 1) as usize)
        }
    }

    /// Pixel coverage in sphere tangent space (radians). `angular_half` matches preset `size`.
    pub fn coverage_angular(&self, tangent_x: f32, tangent_y: f32, angular_half: f32) -> f32 {
        if self.sample_index(tangent_x, tangent_y, angular_half).is_some() {
            1.0
        } else {
            0.0
        }
    }

    /// Sample SDF in sphere tangent space (radians). `angular_half` matches preset `size`.
    pub fn sdf_angular(&self, tangent_x: f32, tangent_y: f32, angular_half: f32) -> f32 {
        let half = angular_half.max(1e-4);
        let q = [tangent_x / half, tangent_y / half];
        let u = q[0] * 0.5 + 0.5;
        let v = 0.5 - q[1] * 0.5;
        self.sample_bilinear(u, v) * half
    }

    fn sample_bilinear(&self, u: f32, v: f32) -> f32 {
        if !(0.0..=1.0).contains(&u) || !(0.0..=1.0).contains(&v) {
            return self.range;
        }
        let g = self.size as f32;
        let x = u * g - 0.5;
        let y = v * g - 0.5;
        let x0 = x.floor().max(0.0) as u32;
        let y0 = y.floor().max(0.0) as u32;
        let x1 = (x0 + 1).min(self.size - 1);
        let y1 = (y0 + 1).min(self.size - 1);
        let tx = x - x0 as f32;
        let ty = y - y0 as f32;
        let idx = |px: u32, py: u32| self.sdf[(py * self.size + px) as usize];
        let a = idx(x0, y0);
        let b = idx(x1, y0);
        let c = idx(x0, y1);
        let d = idx(x1, y1);
        let ab = a + (b - a) * tx;
        let cd = c + (d - c) * tx;
        ab + (cd - ab) * ty
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StampFile {
    format: String,
    version: u32,
    id: String,
    size: u32,
    #[serde(default)]
    palette: Vec<[u8; 3]>,
    #[serde(default)]
    pixels: Vec<u8>,
}

fn parse_stamp(raw: &str) -> Result<StampMask> {
    let file: StampFile = serde_json::from_str(raw).context("parse stamp json")?;
    if file.format != "glowbe-mate-stamp" || file.version != 2 {
        bail!("unsupported stamp format (expected glowbe-mate-stamp v2)");
    }
    StampMask::build(file.id, file.size, file.palette, file.pixels)
}

#[derive(Debug, Default)]
pub struct StampRegistry {
    masks: HashMap<String, StampMask>,
}

impl StampRegistry {
    pub fn load(stamps_dir: &Path) -> Result<Self> {
        let mut registry = Self::default();
        for raw in BUILTIN_STAMPS {
            if let Err(e) = registry.insert_raw(raw) {
                warn!("skip builtin stamp: {e:#}");
            }
        }
        if stamps_dir.is_dir() {
            for entry in std::fs::read_dir(stamps_dir)
                .with_context(|| format!("read stamps dir {}", stamps_dir.display()))?
            {
                let entry = entry?;
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
                if !name.ends_with(".stamp.json") {
                    continue;
                }
                let raw = std::fs::read_to_string(&path)
                    .with_context(|| format!("read stamp {}", path.display()))?;
                if let Err(e) = registry.insert_raw(&raw) {
                    warn!("skip stamp {}: {e:#}", path.display());
                }
            }
        }
        Ok(registry)
    }

    fn insert_raw(&mut self, raw: &str) -> Result<()> {
        let mask = parse_stamp(raw)?;
        self.masks.insert(mask.id.clone(), mask);
        Ok(())
    }

    pub fn get(&self, id: &str) -> Option<&StampMask> {
        self.masks.get(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_loads_builtins() {
        let reg = StampRegistry::load(Path::new("/nonexistent")).unwrap();
        assert!(reg.get("heart").is_some());
        assert!(reg.get("anger").is_some());
        assert!(reg.get("water_drop").is_some());
    }

    #[test]
    fn heart_center_is_inside() {
        let reg = StampRegistry::load(Path::new("/nonexistent")).unwrap();
        let heart = reg.get("heart").unwrap();
        let half = 0.25;
        assert!(heart.sample_index(0.0, 0.0, half).is_some());
        let d = heart.sdf_angular(0.0, 0.0, half);
        assert!(d < 0.0, "center inside heart, got {d}");
    }

    #[test]
    fn heart_coverage_preserves_pixel_grid() {
        let reg = StampRegistry::load(Path::new("/nonexistent")).unwrap();
        let heart = reg.get("heart").unwrap();
        let half = 0.25;
        assert_eq!(heart.coverage_angular(-half * 0.95, half * 0.95, half), 0.0);
        assert_eq!(heart.coverage_angular(0.0, 0.0, half), 1.0);
    }

    #[test]
    fn stamp_exposes_palette() {
        let reg = StampRegistry::load(Path::new("/nonexistent")).unwrap();
        let heart = reg.get("heart").unwrap();
        assert!(!heart.palette().is_empty());
        let idx = heart.sample_index(0.0, 0.0, 0.25).unwrap();
        assert!(idx < heart.palette().len());
    }

    #[test]
    fn anger_has_solid_lobes() {
        let reg = StampRegistry::load(Path::new("/nonexistent")).unwrap();
        let anger = reg.get("anger").unwrap();
        let half = 0.14;
        let mut found = false;
        for i in 0..8 {
            let a = std::f32::consts::FRAC_PI_4 + i as f32 * std::f32::consts::TAU / 8.0;
            let r = 0.035;
            if anger.sdf_angular(a.cos() * r, a.sin() * r, half) < 0.0 {
                found = true;
                break;
            }
        }
        assert!(found, "anger mark should have solid lobes");
    }
}
