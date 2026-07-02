//! Import square pixel-art PNG into stamp JSON.
//!
//! Color regions are preserved as a palette plus per-pixel indices. Transparent
//! pixels become "outside"; every opaque color becomes a palette slot that the
//! runtime recolors at draw time.

use std::path::Path;

use anyhow::{bail, Context, Result};
use image::GenericImageView;
use serde::Serialize;

pub const MIN_STAMP_PX: u32 = 1;
/// Hard safety cap (memory / EDT cost), not a design resolution limit.
pub const ABSOLUTE_MAX_STAMP_PX: u32 = 256;
/// Pixel-art stamps use a small number of design colors.
pub const MAX_STAMP_PALETTE: usize = 16;
/// Pixels with alpha below this are treated as outside the stamp.
const ALPHA_OUTSIDE: f32 = 0.5;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StampJson {
    pub format: &'static str,
    pub version: u32,
    pub id: String,
    pub size: u32,
    /// Distinct opaque colors, in discovery order (row-major scan).
    pub palette: Vec<[u8; 3]>,
    /// One entry per pixel: 0 = outside, n = `palette[n - 1]`.
    pub pixels: Vec<u8>,
}

pub fn import_stamp_from_png(png_path: &Path, id: &str) -> Result<StampJson> {
    if id.is_empty() || id.contains('/') || id.contains('\\') {
        bail!("stamp id must be non-empty and path-safe");
    }
    let img = image::open(png_path).with_context(|| format!("open png {}", png_path.display()))?;
    let (width, height) = img.dimensions();
    if width != height {
        bail!("stamp png must be square (got {width}×{height})");
    }
    if width < MIN_STAMP_PX {
        bail!("stamp png must be at least {MIN_STAMP_PX}×{MIN_STAMP_PX}px (got {width})");
    }
    if width > ABSOLUTE_MAX_STAMP_PX {
        bail!(
            "stamp png exceeds safety limit {ABSOLUTE_MAX_STAMP_PX}×{ABSOLUTE_MAX_STAMP_PX}px (got {width})"
        );
    }

    let mut palette: Vec<[u8; 3]> = Vec::new();
    let mut pixels = Vec::with_capacity((width * height) as usize);
    for y in 0..height {
        for x in 0..width {
            let p = img.get_pixel(x, y);
            let alpha = p[3] as f32 / 255.0;
            if alpha < ALPHA_OUTSIDE {
                pixels.push(0);
                continue;
            }
            let rgb = [p[0], p[1], p[2]];
            let index = match palette.iter().position(|c| *c == rgb) {
                Some(i) => i,
                None => {
                    if palette.len() >= MAX_STAMP_PALETTE {
                        bail!(
                            "stamp png has more than {MAX_STAMP_PALETTE} opaque colors; \
                             use crisp pixel art with a small palette"
                        );
                    }
                    palette.push(rgb);
                    palette.len() - 1
                }
            };
            pixels.push((index + 1) as u8);
        }
    }

    debug_assert_eq!(pixels.len(), (width * height) as usize);

    Ok(StampJson {
        format: "glowbe-mate-stamp",
        version: 2,
        id: id.to_string(),
        size: width,
        palette,
        pixels,
    })
}

pub fn write_stamp_json(path: &Path, asset: &StampJson) -> Result<()> {
    let raw = serde_json::to_string_pretty(asset).context("serialize stamp json")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("create dir {}", parent.display()))?;
    }
    std::fs::write(path, format!("{raw}\n")).with_context(|| format!("write {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_square() {
        let dir = std::env::temp_dir().join(format!("glowbe-stamp-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("wide.png");
        let img = image::RgbaImage::from_pixel(16, 8, image::Rgba([255, 255, 255, 255]));
        img.save(&path).unwrap();
        let err = import_stamp_from_png(&path, "test").unwrap_err();
        assert!(err.to_string().contains("square"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn preserves_native_pixel_grid() {
        let dir = std::env::temp_dir().join(format!("glowbe-stamp-px-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("art.png");
        let img = image::RgbaImage::from_pixel(32, 32, image::Rgba([255, 255, 255, 255]));
        img.save(&path).unwrap();
        let stamp = import_stamp_from_png(&path, "test").unwrap();
        assert_eq!(stamp.size, 32);
        assert_eq!(stamp.pixels.len(), 32 * 32);
        assert_eq!(stamp.palette.len(), 1);
        assert_eq!(stamp.palette[0], [255, 255, 255]);
        assert!(stamp.pixels.iter().all(|&p| p == 1));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn preserves_distinct_color_regions() {
        let dir = std::env::temp_dir().join(format!("glowbe-stamp-color-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("two.png");
        let mut img = image::RgbaImage::from_pixel(2, 2, image::Rgba([255, 0, 0, 255]));
        img.put_pixel(1, 1, image::Rgba([0, 0, 255, 255]));
        img.put_pixel(0, 1, image::Rgba([0, 0, 0, 0]));
        img.save(&path).unwrap();
        let stamp = import_stamp_from_png(&path, "test").unwrap();
        assert_eq!(stamp.palette.len(), 2);
        assert_eq!(stamp.palette[0], [255, 0, 0]);
        assert_eq!(stamp.palette[1], [0, 0, 255]);
        // row-major: (0,0)=red→1, (1,0)=red→1, (0,1)=transparent→0, (1,1)=blue→2
        assert_eq!(stamp.pixels, vec![1, 1, 0, 2]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn import_heart_corners_are_outside() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../assets/mate/stamps/src/heart.png");
        let stamp = import_stamp_from_png(&root, "heart").unwrap();
        assert_eq!(stamp.pixels[0], 0, "top-left corner should be outside");
        let on = stamp.pixels.iter().filter(|&&p| p != 0).count();
        assert!(on > 0 && on < 200);
    }

    #[test]
    fn transparent_is_outside() {
        let dir = std::env::temp_dir().join(format!("glowbe-stamp-clear-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("clear.png");
        let img = image::RgbaImage::from_pixel(4, 4, image::Rgba([255, 255, 255, 0]));
        img.save(&path).unwrap();
        let stamp = import_stamp_from_png(&path, "test").unwrap();
        assert!(stamp.palette.is_empty());
        assert!(stamp.pixels.iter().all(|&p| p == 0));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
