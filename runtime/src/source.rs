use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::media::{self, sanitize_display_name};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceManifest {
    pub format: String,
    pub id: String,
    pub kind: String,
    pub frame_count: u32,
    pub width: u32,
    pub height: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fps: Option<u32>,
    pub created_at_unix_sec: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSummary {
    pub id: String,
    pub kind: String,
    pub frame_count: u32,
    pub width: u32,
    pub height: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fps: Option<u32>,
    pub created_at_unix_sec: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

pub fn validate_source_id(id: &str) -> Result<()> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        anyhow::bail!("source id must be non-empty and path-safe");
    }
    Ok(())
}

fn original_path(dir: &Path) -> Result<PathBuf> {
    for entry in fs::read_dir(dir).with_context(|| format!("read {}", dir.display()))? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("original.") && entry.file_type()?.is_file() {
            return Ok(entry.path());
        }
    }
    anyhow::bail!("original file not found under {}", dir.display())
}

pub fn read_source_manifest(dir: &Path) -> Result<SourceManifest> {
    let path = dir.join("manifest.json");
    let raw = fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
    let m: SourceManifest =
        serde_json::from_str(&raw).with_context(|| format!("parse {}", path.display()))?;
    if m.format != "glowbe-source" {
        anyhow::bail!("unsupported source format: {}", m.format);
    }
    Ok(m)
}

fn write_source_manifest(dir: &Path, manifest: &SourceManifest) -> Result<()> {
    let json = serde_json::to_vec_pretty(manifest).context("serialize source manifest")?;
    fs::write(
        dir.join("manifest.json"),
        [json, b"\n".to_vec()].concat(),
    )
    .with_context(|| format!("write {}", dir.join("manifest.json").display()))?;
    Ok(())
}

fn summary_from_manifest(m: &SourceManifest) -> SourceSummary {
    SourceSummary {
        id: m.id.clone(),
        kind: m.kind.clone(),
        frame_count: m.frame_count,
        width: m.width,
        height: m.height,
        fps: m.fps,
        created_at_unix_sec: m.created_at_unix_sec,
        display_name: m.display_name.clone(),
    }
}

pub fn list_sources(sources_dir: &Path) -> Result<Vec<SourceSummary>> {
    if !sources_dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(sources_dir)
        .with_context(|| format!("read {}", sources_dir.display()))?
    {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        if let Ok(m) = read_source_manifest(&entry.path()) {
            out.push(summary_from_manifest(&m));
        }
    }
    out.sort_by(|a, b| b.created_at_unix_sec.cmp(&a.created_at_unix_sec));
    Ok(out)
}

pub fn source_summary(sources_dir: &Path, source_id: &str) -> Result<SourceSummary> {
    validate_source_id(source_id)?;
    let dir = sources_dir.join(source_id);
    let m = read_source_manifest(&dir)?;
    Ok(summary_from_manifest(&m))
}

/// Store uploaded bytes as a new source entity.
pub fn store_uploaded_source(
    sources_dir: &Path,
    data: &[u8],
    disk_ext: &str,
) -> Result<SourceSummary> {
    let source_id = Uuid::new_v4().hyphenated().to_string();
    validate_source_id(&source_id)?;
    let dir = sources_dir.join(&source_id);
    fs::create_dir_all(&dir).with_context(|| format!("create {}", dir.display()))?;
    let original = dir.join(format!("original.{disk_ext}"));
    fs::write(&original, data).with_context(|| format!("write {}", original.display()))?;

    let (kind, frame_count, width, height, fps) = probe_source(&original)?;

    let manifest = SourceManifest {
        format: "glowbe-source".into(),
        id: source_id.clone(),
        kind,
        frame_count,
        width,
        height,
        fps,
        created_at_unix_sec: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        display_name: None,
    };
    write_source_manifest(&dir, &manifest)?;
    Ok(summary_from_manifest(&manifest))
}

fn probe_source(path: &Path) -> Result<(String, u32, u32, u32, Option<u32>)> {
    if media::is_zip_file_public(path)? {
        let (w, h, n) = media::probe_zip_image_sequence(path)?;
        Ok((
            "equirectangular-image-sequence".into(),
            n,
            w,
            h,
            None,
        ))
    } else if media::is_video_file_public(path) {
        let (w, h) = media::probe_video_dimensions(path)?;
        Ok(("equirectangular-video".into(), 0, w, h, Some(30)))
    } else {
        let img = image::ImageReader::open(path)
            .with_context(|| format!("open {}", path.display()))?
            .decode()
            .with_context(|| format!("decode {}", path.display()))?
            .to_rgba8();
        let w = img.width();
        let h = img.height();
        if w == 0 || h == 0 {
            anyhow::bail!("image has zero size");
        }
        Ok(("equirectangular-image".into(), 1, w, h, None))
    }
}

pub fn set_source_display_name(
    sources_dir: &Path,
    source_id: &str,
    display_name: Option<&str>,
) -> Result<()> {
    validate_source_id(source_id)?;
    let dir = sources_dir.join(source_id);
    let mut m = read_source_manifest(&dir)?;
    m.display_name = sanitize_display_name(display_name);
    write_source_manifest(&dir, &m)
}

pub fn export_source_frame_png(
    sources_dir: &Path,
    source_id: &str,
    frame_index: u32,
) -> Result<Vec<u8>> {
    validate_source_id(source_id)?;
    let dir = sources_dir.join(source_id);
    let manifest = read_source_manifest(&dir)?;
    if manifest.kind != "equirectangular-video" && frame_index >= manifest.frame_count {
        anyhow::bail!(
            "frame index {} out of range (frameCount={})",
            frame_index,
            manifest.frame_count
        );
    }
    let original = original_path(&dir)?;
    media::export_source_frame_png_from_path(
        &original,
        &manifest.kind,
        manifest.fps.unwrap_or(30),
        frame_index,
    )
}

pub fn load_source_frame_rgba(
    sources_dir: &Path,
    source_id: &str,
    frame_index: u32,
) -> Result<image::RgbaImage> {
    let png = export_source_frame_png(sources_dir, source_id, frame_index)?;
    Ok(image::load_from_memory(&png)
        .context("decode source frame png")?
        .to_rgba8())
}

pub fn clips_referencing_source(clips_dir: &Path, source_id: &str) -> Result<Vec<String>> {
    let mut refs = Vec::new();
    if !clips_dir.is_dir() {
        return Ok(refs);
    }
    for entry in fs::read_dir(clips_dir).with_context(|| format!("read {}", clips_dir.display()))? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let manifest_path = entry.path().join("manifest.json");
        if !manifest_path.is_file() {
            continue;
        }
        let raw = fs::read_to_string(&manifest_path)?;
        let v: serde_json::Value = serde_json::from_str(&raw)?;
        if v.get("sourceId").and_then(|x| x.as_str()) == Some(source_id) {
            if let Some(id) = v.get("id").and_then(|x| x.as_str()) {
                refs.push(id.to_string());
            }
        }
    }
    refs.sort();
    Ok(refs)
}

pub fn delete_source(sources_dir: &Path, clips_dir: &Path, source_id: &str) -> Result<()> {
    validate_source_id(source_id)?;
    let refs = clips_referencing_source(clips_dir, source_id)?;
    if !refs.is_empty() {
        anyhow::bail!("source is referenced by clips: {}", refs.join(", "));
    }
    let dir = sources_dir.join(source_id);
    if !dir.is_dir() {
        anyhow::bail!("source not found: {source_id}");
    }
    fs::remove_dir_all(&dir).with_context(|| format!("remove {}", dir.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_and_list_png_source() {
        let tmp = std::env::temp_dir().join(format!("glowbe-src-test-{}", Uuid::new_v4()));
        let sources = tmp.join("sources");
        fs::create_dir_all(&sources).unwrap();
        let img = image::RgbaImage::from_pixel(4, 2, image::Rgba([10, 20, 30, 255]));
        let mut buf = Vec::new();
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
            .unwrap();
        let s = store_uploaded_source(&sources, &buf, "png").unwrap();
        assert_eq!(s.frame_count, 1);
        assert_eq!(s.width, 4);
        let list = list_sources(&sources).unwrap();
        assert_eq!(list.len(), 1);
        let _ = fs::remove_dir_all(tmp);
    }
}
