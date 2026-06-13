use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use image::ImageReader;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LedMap {
    layout_id: String,
    leds: Vec<LedPoint>,
}

#[derive(Debug, Deserialize)]
struct LedPoint {
    i: usize,
    u: f32,
    v: f32,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SequenceManifest {
    format: String,
    version: u8,
    id: String,
    layout_id: String,
    led_count: usize,
    frame_count: u32,
    fps: u32,
    source: SequenceSource,
    created_at_unix_sec: u64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SequenceSource {
    kind: String,
    path: String,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone)]
pub struct LoadedSequence {
    pub id: String,
    pub layout_id: String,
    pub led_count: usize,
    pub frame_count: usize,
    pub fps: u32,
    frames: Vec<u8>,
}

pub fn convert_equirect_image_to_sequence(
    image_path: &Path,
    sequence_id: &str,
    layout_id: &str,
    compiled_dir: &Path,
    sequences_dir: &Path,
) -> Result<PathBuf> {
    if sequence_id.is_empty() || sequence_id.contains('/') || sequence_id.contains('\\') {
        anyhow::bail!("sequence id must be non-empty and must not contain path separators");
    }

    let ledmap_path = compiled_dir.join(format!("{layout_id}.ledmap.json"));
    let ledmap: LedMap = serde_json::from_str(
        &fs::read_to_string(&ledmap_path)
            .with_context(|| format!("read {}", ledmap_path.display()))?,
    )
    .with_context(|| format!("parse {}", ledmap_path.display()))?;
    if ledmap.layout_id != layout_id {
        anyhow::bail!(
            "ledmap layout id mismatch: expected {layout_id}, got {}",
            ledmap.layout_id
        );
    }

    let image = ImageReader::open(image_path)
        .with_context(|| format!("open {}", image_path.display()))?
        .decode()
        .with_context(|| format!("decode {}", image_path.display()))?
        .to_rgba8();
    let width = image.width();
    let height = image.height();
    if width == 0 || height == 0 {
        anyhow::bail!("image has zero width or height");
    }

    let mut frame = vec![0u8; ledmap.leds.len() * 3];
    for led in &ledmap.leds {
        let [r, g, b] = sample_bilinear_rgb(&image, led.u, led.v);
        let o = led.i * 3;
        if o + 2 >= frame.len() {
            anyhow::bail!(
                "led index {} out of bounds for {} LEDs",
                led.i,
                ledmap.leds.len()
            );
        }
        frame[o] = r;
        frame[o + 1] = g;
        frame[o + 2] = b;
    }

    let out_dir = sequences_dir.join(sequence_id);
    fs::create_dir_all(&out_dir).with_context(|| format!("create {}", out_dir.display()))?;
    fs::write(out_dir.join("frames.bin"), &frame)
        .with_context(|| format!("write {}", out_dir.join("frames.bin").display()))?;

    let manifest = SequenceManifest {
        format: "glowbe-sequence".to_string(),
        version: 1,
        id: sequence_id.to_string(),
        layout_id: layout_id.to_string(),
        led_count: ledmap.leds.len(),
        frame_count: 1,
        fps: 1,
        source: SequenceSource {
            kind: "equirectangular-image".to_string(),
            path: image_path.display().to_string(),
            width,
            height,
        },
        created_at_unix_sec: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    };
    let manifest_json = serde_json::to_vec_pretty(&manifest).context("serialize manifest")?;
    fs::write(
        out_dir.join("manifest.json"),
        [manifest_json, b"\n".to_vec()].concat(),
    )
    .with_context(|| format!("write {}", out_dir.join("manifest.json").display()))?;

    Ok(out_dir)
}

pub fn load_sequence(sequence_dir: &Path, sequence_id: &str) -> Result<LoadedSequence> {
    if sequence_id.is_empty() || sequence_id.contains('/') || sequence_id.contains('\\') {
        anyhow::bail!("sequence id must be non-empty and must not contain path separators");
    }
    let dir = sequence_dir.join(sequence_id);
    let manifest_path = dir.join("manifest.json");
    let manifest_raw = fs::read_to_string(&manifest_path)
        .with_context(|| format!("read {}", manifest_path.display()))?;
    let manifest: SequenceManifest = serde_json::from_str(&manifest_raw)
        .with_context(|| format!("parse {}", manifest_path.display()))?;
    if manifest.format != "glowbe-sequence" || manifest.version != 1 {
        anyhow::bail!(
            "unsupported sequence format/version: {} v{}",
            manifest.format,
            manifest.version
        );
    }

    let frames_path = dir.join("frames.bin");
    let frames =
        fs::read(&frames_path).with_context(|| format!("read {}", frames_path.display()))?;
    let frame_size = manifest.led_count * 3;
    let expected_len = frame_size * manifest.frame_count as usize;
    if frames.len() != expected_len {
        anyhow::bail!(
            "frames.bin size mismatch: got {}, expected {} ({} LEDs x {} frames)",
            frames.len(),
            expected_len,
            manifest.led_count,
            manifest.frame_count
        );
    }

    Ok(LoadedSequence {
        id: manifest.id,
        layout_id: manifest.layout_id,
        led_count: manifest.led_count,
        frame_count: manifest.frame_count as usize,
        fps: manifest.fps,
        frames,
    })
}

impl LoadedSequence {
    pub fn copy_frame_at(&self, elapsed: std::time::Duration, out: &mut [u8]) -> Result<()> {
        let frame_size = self.led_count * 3;
        if out.len() != frame_size {
            anyhow::bail!(
                "output buffer size mismatch: got {}, expected {}",
                out.len(),
                frame_size
            );
        }
        let frame =
            ((elapsed.as_secs_f64() * self.fps as f64).floor() as usize) % self.frame_count.max(1);
        let start = frame * frame_size;
        out.copy_from_slice(&self.frames[start..start + frame_size]);
        Ok(())
    }
}

fn sample_bilinear_rgb(image: &image::RgbaImage, u: f32, v: f32) -> [u8; 3] {
    let width = image.width();
    let height = image.height();

    let u = u.rem_euclid(1.0);
    let v = v.clamp(0.0, 1.0);
    let x = u * width as f32;
    let y = v * (height.saturating_sub(1)) as f32;

    let x0 = x.floor() as u32 % width;
    let x1 = (x0 + 1) % width;
    let y0 = y.floor() as u32;
    let y1 = (y0 + 1).min(height - 1);
    let tx = x - x.floor();
    let ty = y - y.floor();

    let c00 = image.get_pixel(x0, y0).0;
    let c10 = image.get_pixel(x1, y0).0;
    let c01 = image.get_pixel(x0, y1).0;
    let c11 = image.get_pixel(x1, y1).0;

    [
        lerp2(c00[0], c10[0], c01[0], c11[0], tx, ty),
        lerp2(c00[1], c10[1], c01[1], c11[1], tx, ty),
        lerp2(c00[2], c10[2], c01[2], c11[2], tx, ty),
    ]
}

fn lerp2(c00: u8, c10: u8, c01: u8, c11: u8, tx: f32, ty: f32) -> u8 {
    let top = c00 as f32 * (1.0 - tx) + c10 as f32 * tx;
    let bottom = c01 as f32 * (1.0 - tx) + c11 as f32 * tx;
    (top * (1.0 - ty) + bottom * ty).round().clamp(0.0, 255.0) as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bilinear_wraps_horizontally() {
        let mut image = image::RgbaImage::new(2, 1);
        image.put_pixel(0, 0, image::Rgba([255, 0, 0, 255]));
        image.put_pixel(1, 0, image::Rgba([0, 0, 255, 255]));
        assert_eq!(sample_bilinear_rgb(&image, 0.0, 0.0), [255, 0, 0]);
        assert_eq!(sample_bilinear_rgb(&image, 0.5, 0.0), [0, 0, 255]);
        assert_eq!(sample_bilinear_rgb(&image, 1.0, 0.0), [255, 0, 0]);
    }
}
