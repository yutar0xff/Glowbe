use std::fs;
use std::io::{Read, Seek};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use image::ImageReader;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::equirect::{self, DEFAULT_HEIGHT, DEFAULT_WIDTH};

/// ZIP 内の連番画像から取り込むフレーム数の上限（メモリ・処理時間の安全弁）。
const MAX_ZIP_FRAMES: usize = 3600;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LedMap {
    layout_id: String,
    leds: Vec<LedPoint>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedPoint {
    pub i: usize,
    pub u: f32,
    pub v: f32,
    #[serde(default)]
    pub channel: usize,
    #[serde(default)]
    pub chain_index: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutUv {
    pub layout_id: String,
    pub led_count: usize,
    pub leds: Vec<LedPoint>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipManifest {
    pub format: String,
    pub version: u8,
    pub id: String,
    pub kind: String,
    pub fps: u32,
    pub frame_count: u32,
    pub width: u32,
    pub height: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(default)]
    pub thumb_frame_index: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placement: Option<crate::clip_placement::ClipPlacement>,
    /// Loop-media gamma (device-independent). 1 = identity; >1 darkens midtones.
    #[serde(default = "default_clip_gamma")]
    pub gamma: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<ClipSourceMeta>,
    pub created_at_unix_sec: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

fn default_clip_gamma() -> f32 {
    crate::master_tone::DEFAULT_CLIP_GAMMA as f32
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipSourceMeta {
    pub kind: String,
    pub path: String,
    pub orig_width: u32,
    pub orig_height: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipSummary {
    pub id: String,
    pub kind: String,
    pub frame_count: u32,
    pub fps: u32,
    pub width: u32,
    pub height: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumb_frame_index: Option<u32>,
    pub source_kind: Option<String>,
    pub source_width: u32,
    pub source_height: u32,
    pub created_at_unix_sec: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_demo: Option<bool>,
    /// Loop-media gamma (demos are always 1).
    pub gamma: f32,
}

pub fn load_layout_uv(compiled_dir: &Path, layout_id: &str) -> Result<LayoutUv> {
    if layout_id.is_empty() || layout_id.contains('/') || layout_id.contains('\\') {
        anyhow::bail!("layout id must be non-empty and must not contain path separators");
    }

    let ledmap_path = compiled_dir.join(format!("{layout_id}.ledmap.json"));
    let ledmap_raw = fs::read_to_string(&ledmap_path)
        .with_context(|| format!("read {}", ledmap_path.display()))?;
    let ledmap: LedMap = serde_json::from_str(&ledmap_raw)
        .with_context(|| format!("parse {}", ledmap_path.display()))?;
    if ledmap.layout_id != layout_id {
        anyhow::bail!(
            "layout id mismatch in ledmap: got {}, expected {}",
            ledmap.layout_id,
            layout_id
        );
    }

    Ok(LayoutUv {
        layout_id: ledmap.layout_id,
        led_count: ledmap.leds.len(),
        leds: ledmap.leds,
    })
}

/// UI 用の短い表示名。空・空白のみは `None`（キー省略 / 削除）。
pub fn sanitize_display_name(input: Option<&str>) -> Option<String> {
    let t = input?.trim();
    if t.is_empty() {
        return None;
    }
    let s: String = t
        .chars()
        .take(120)
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let s = s.trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

fn set_prog(progress: Option<&Arc<AtomicU8>>, v: u8) {
    if let Some(p) = progress {
        let v = v.min(100);
        loop {
            let cur = p.load(Ordering::Relaxed);
            if v <= cur {
                break;
            }
            if p.compare_exchange_weak(cur, v, Ordering::Relaxed, Ordering::Relaxed)
                .is_ok()
            {
                break;
            }
        }
    }
}

fn is_zip_file(path: &Path) -> Result<bool> {
    if path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("zip"))
    {
        return Ok(true);
    }
    let mut f = fs::File::open(path).with_context(|| format!("open {}", path.display()))?;
    let mut sig = [0u8; 4];
    let n = f.read(&mut sig).unwrap_or(0);
    Ok(n >= 4 && sig[0] == 0x50 && sig[1] == 0x4b && sig[2] == 0x03 && sig[3] == 0x04)
}

fn is_image_zip_entry(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".png") || lower.ends_with(".jpg") || lower.ends_with(".jpeg")
}

fn is_video_file(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| {
        matches!(
            e.to_ascii_lowercase().as_str(),
            "mp4" | "webm" | "mov" | "mkv"
        )
    })
}

pub fn is_zip_file_public(path: &Path) -> Result<bool> {
    is_zip_file(path)
}

pub fn is_video_file_public(path: &Path) -> bool {
    is_video_file(path)
}

pub fn probe_zip_image_sequence(path: &Path) -> Result<(u32, u32, u32)> {
    let file = fs::File::open(path).with_context(|| format!("open {}", path.display()))?;
    let mut archive =
        zip::ZipArchive::new(std::io::BufReader::new(file)).context("open zip archive")?;
    let names = zip_collect_image_names(&mut archive)?;
    let mut first_buf = Vec::new();
    archive
        .by_name(&names[0])
        .with_context(|| format!("zip entry {}", names[0]))?
        .read_to_end(&mut first_buf)
        .with_context(|| format!("read zip entry {}", names[0]))?;
    let first_img = image::load_from_memory(&first_buf)
        .with_context(|| format!("decode {}", names[0]))?
        .to_rgba8();
    Ok((first_img.width(), first_img.height(), names.len() as u32))
}

pub fn probe_video_dimensions(path: &Path) -> Result<(u32, u32)> {
    let out = std::env::temp_dir().join(format!("glowbe-probe-{}.png", Uuid::new_v4()));
    let st = Command::new("ffmpeg")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-y")
        .arg("-i")
        .arg(path)
        .arg("-frames:v")
        .arg("1")
        .arg(&out)
        .status()
        .context("spawn ffmpeg for video probe")?;
    if !st.success() {
        let _ = fs::remove_file(&out);
        anyhow::bail!("ffmpeg failed probing video dimensions");
    }
    let img = ImageReader::open(&out)
        .with_context(|| format!("open {}", out.display()))?
        .decode()
        .with_context(|| format!("decode {}", out.display()))?
        .to_rgba8();
    let _ = fs::remove_file(&out);
    Ok((img.width(), img.height()))
}

pub fn export_source_frame_png_from_path(
    path: &Path,
    kind: &str,
    fps: u32,
    frame_index: u32,
) -> Result<Vec<u8>> {
    let idx = frame_index as usize;
    match kind {
        "equirectangular-image" => {
            if idx != 0 {
                anyhow::bail!("single-image source only has frame 0");
            }
            let image = ImageReader::open(path)
                .with_context(|| format!("open {}", path.display()))?
                .decode()
                .with_context(|| format!("decode {}", path.display()))?
                .to_rgba8();
            rgba_to_png_bytes(&image)
        }
        "equirectangular-image-sequence" => {
            let rgba = read_zip_entry_rgba(path, idx)?;
            rgba_to_png_bytes(&rgba)
        }
        "equirectangular-video" => extract_video_frame_png(path, fps, frame_index),
        other => anyhow::bail!("unsupported source kind: {other}"),
    }
}

pub fn load_source_frame_rgba_from_path(
    path: &Path,
    kind: &str,
    fps: u32,
    frame_index: u32,
) -> Result<image::RgbaImage> {
    let png = export_source_frame_png_from_path(path, kind, fps, frame_index)?;
    Ok(image::load_from_memory(&png)
        .context("decode frame")?
        .to_rgba8())
}

fn zip_collect_image_names<R: Read + Seek>(
    archive: &mut zip::ZipArchive<R>,
) -> Result<Vec<String>> {
    let mut names: Vec<String> = Vec::new();
    for i in 0..archive.len() {
        let f = archive
            .by_index(i)
            .with_context(|| format!("zip index {i}"))?;
        if !f.is_file() {
            continue;
        }
        let name = f.name().to_string();
        if name.contains("__MACOSX") || name.contains("..") {
            continue;
        }
        if is_image_zip_entry(&name) {
            names.push(name);
        }
    }
    if names.is_empty() {
        anyhow::bail!("zip contains no png/jpeg images");
    }
    names.sort();
    Ok(names)
}

fn build_equirect_from_zip(
    source_path: &Path,
    width: u32,
    height: u32,
    progress: Option<&Arc<AtomicU8>>,
) -> Result<(Vec<u8>, u32, ClipSourceMeta)> {
    let file =
        fs::File::open(source_path).with_context(|| format!("open {}", source_path.display()))?;
    let mut archive =
        zip::ZipArchive::new(std::io::BufReader::new(file)).context("open zip archive")?;

    let names = zip_collect_image_names(&mut archive)?;
    if names.len() > MAX_ZIP_FRAMES {
        anyhow::bail!("zip has too many images (max {MAX_ZIP_FRAMES})");
    }

    let mut first_buf = Vec::new();
    {
        let mut e = archive
            .by_name(&names[0])
            .with_context(|| format!("zip entry {}", names[0]))?;
        e.read_to_end(&mut first_buf)
            .with_context(|| format!("read zip entry {}", names[0]))?;
    }
    let first_img = image::load_from_memory(&first_buf)
        .with_context(|| format!("decode {}", names[0]))?
        .to_rgba8();
    let orig_w = first_img.width();
    let orig_h = first_img.height();
    if orig_w == 0 || orig_h == 0 {
        anyhow::bail!("invalid image size in zip");
    }

    let frame_size = (width * height * 3) as usize;
    let mut all: Vec<u8> = Vec::with_capacity(frame_size * names.len());
    all.extend_from_slice(&equirect::rgba_to_equirect_rgb(&first_img, width, height));
    set_prog(
        progress,
        (100u32.saturating_div(names.len() as u32).max(1)) as u8,
    );

    for (idx, name) in names.iter().enumerate().skip(1) {
        let mut buf = Vec::new();
        let mut e = archive
            .by_name(name)
            .with_context(|| format!("zip entry {name}"))?;
        e.read_to_end(&mut buf)
            .with_context(|| format!("read zip entry {name}"))?;
        let img = image::load_from_memory(&buf)
            .with_context(|| format!("decode {name}"))?
            .to_rgba8();
        if img.width() != orig_w || img.height() != orig_h {
            anyhow::bail!(
                "all zip images must share size {}×{}, but {name} is {}×{}",
                orig_w,
                orig_h,
                img.width(),
                img.height()
            );
        }
        all.extend_from_slice(&equirect::rgba_to_equirect_rgb(&img, width, height));
        let pct = (((idx + 1) as u32 * 100) / names.len() as u32).min(99) as u8;
        set_prog(progress, pct.max(2));
    }

    let source = ClipSourceMeta {
        kind: "equirectangular-image-sequence".to_string(),
        path: String::new(),
        orig_width: orig_w,
        orig_height: orig_h,
    };

    Ok((all, names.len() as u32, source))
}

fn build_equirect_from_video(
    source_path: &Path,
    width: u32,
    height: u32,
    fps: u32,
    progress: Option<&Arc<AtomicU8>>,
) -> Result<(Vec<u8>, u32, ClipSourceMeta)> {
    let tmp = std::env::temp_dir().join(format!("glowbe-vid-{}", Uuid::new_v4()));
    fs::create_dir_all(&tmp).with_context(|| format!("mkdir {}", tmp.display()))?;
    let out_pattern = tmp.join("frame_%06d.png");
    let out_pattern_s = out_pattern.to_string_lossy().to_string();

    set_prog(progress, 8);
    let st = Command::new("ffmpeg")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-y")
        .arg("-i")
        .arg(source_path)
        .arg("-vf")
        .arg(format!("fps={fps}"))
        .arg("-frames:v")
        .arg(format!("{MAX_ZIP_FRAMES}"))
        .arg(&out_pattern_s)
        .status()
        .context("spawn ffmpeg (is ffmpeg installed?)")?;

    if !st.success() {
        let _ = fs::remove_dir_all(&tmp);
        anyhow::bail!("ffmpeg failed while extracting video frames");
    }

    let mut names: Vec<String> = fs::read_dir(&tmp)
        .with_context(|| format!("read {}", tmp.display()))?
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.to_ascii_lowercase().ends_with(".png"))
        .collect();
    names.sort();
    if names.is_empty() {
        let _ = fs::remove_dir_all(&tmp);
        anyhow::bail!("ffmpeg produced no png frames (unsupported codec?)");
    }
    if names.len() > MAX_ZIP_FRAMES {
        let _ = fs::remove_dir_all(&tmp);
        anyhow::bail!("too many video frames after extract (max {MAX_ZIP_FRAMES})");
    }

    set_prog(progress, 18);
    let first_path = tmp.join(&names[0]);
    let first_img = ImageReader::open(&first_path)
        .with_context(|| format!("open {}", first_path.display()))?
        .decode()
        .with_context(|| format!("decode {}", first_path.display()))?
        .to_rgba8();
    let orig_w = first_img.width();
    let orig_h = first_img.height();
    if orig_w == 0 || orig_h == 0 {
        let _ = fs::remove_dir_all(&tmp);
        anyhow::bail!("invalid frame size from video");
    }

    let frame_size = (width * height * 3) as usize;
    let mut all: Vec<u8> = Vec::with_capacity(frame_size * names.len());
    all.extend_from_slice(&equirect::rgba_to_equirect_rgb(&first_img, width, height));
    set_prog(
        progress,
        (100u32.saturating_div(names.len() as u32).max(1)) as u8,
    );

    for (idx, name) in names.iter().enumerate().skip(1) {
        let p = tmp.join(name);
        let img = ImageReader::open(&p)
            .with_context(|| format!("open {}", p.display()))?
            .decode()
            .with_context(|| format!("decode {}", p.display()))?
            .to_rgba8();
        if img.width() != orig_w || img.height() != orig_h {
            let _ = fs::remove_dir_all(&tmp);
            anyhow::bail!(
                "video frames must share size {}×{}, but {name} is {}×{}",
                orig_w,
                orig_h,
                img.width(),
                img.height()
            );
        }
        all.extend_from_slice(&equirect::rgba_to_equirect_rgb(&img, width, height));
        let pct = (((idx + 1) as u32 * 100) / names.len() as u32).min(99) as u8;
        set_prog(progress, pct.max(2));
    }

    let _ = fs::remove_dir_all(&tmp);

    let source = ClipSourceMeta {
        kind: "equirectangular-video".to_string(),
        path: String::new(),
        orig_width: orig_w,
        orig_height: orig_h,
    };

    Ok((all, names.len() as u32, source))
}

fn copy_upload_to_clip_import(source_path: &Path, out_dir: &Path) -> Result<String> {
    let ext = source_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("bin")
        .to_ascii_lowercase();
    let name = format!("source-import.{ext}");
    let dest = out_dir.join(&name);
    fs::copy(source_path, &dest).with_context(|| format!("copy import to {}", dest.display()))?;
    Ok(name)
}

fn rgba_to_png_bytes(img: &image::RgbaImage) -> Result<Vec<u8>> {
    let mut buf = Vec::new();
    image::DynamicImage::ImageRgba8(img.clone())
        .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
        .context("encode png")?;
    Ok(buf)
}

fn resolve_stored_import_path(clip_dir: &Path, source: &ClipSourceMeta) -> Result<PathBuf> {
    let raw = Path::new(&source.path);
    let cand = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        clip_dir.join(raw)
    };
    if cand.is_file() {
        return Ok(cand);
    }
    for entry in fs::read_dir(clip_dir).with_context(|| format!("read {}", clip_dir.display()))? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("source-import.") && entry.file_type()?.is_file() {
            return Ok(entry.path());
        }
    }
    anyhow::bail!(
        "import media not found for clip (expected {} or source-import.* under {})",
        cand.display(),
        clip_dir.display()
    )
}

fn read_zip_entry_rgba(zip_path: &Path, entry_index: usize) -> Result<image::RgbaImage> {
    let file = fs::File::open(zip_path).with_context(|| format!("open {}", zip_path.display()))?;
    let mut archive = zip::ZipArchive::new(std::io::BufReader::new(file)).context("open zip")?;
    let names = zip_collect_image_names(&mut archive)?;
    let name = names
        .get(entry_index)
        .with_context(|| format!("zip frame index {entry_index} out of range"))?;
    let mut buf = Vec::new();
    archive
        .by_name(name)
        .with_context(|| format!("zip entry {name}"))?
        .read_to_end(&mut buf)
        .with_context(|| format!("read zip entry {name}"))?;
    Ok(image::load_from_memory(&buf)
        .with_context(|| format!("decode {name}"))?
        .to_rgba8())
}

fn extract_video_frame_png(import_path: &Path, fps: u32, frame_index: u32) -> Result<Vec<u8>> {
    let t_sec = frame_index as f64 / fps.max(1) as f64;
    let out = std::env::temp_dir().join(format!("glowbe-vf-{}.png", Uuid::new_v4()));
    let st = Command::new("ffmpeg")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-y")
        .arg("-ss")
        .arg(format!("{t_sec:.6}"))
        .arg("-i")
        .arg(import_path)
        .arg("-frames:v")
        .arg("1")
        .arg(&out)
        .status()
        .context("spawn ffmpeg for video frame")?;
    if !st.success() {
        let _ = fs::remove_file(&out);
        anyhow::bail!("ffmpeg failed extracting video frame at t={t_sec}s");
    }
    let bytes = fs::read(&out).with_context(|| format!("read {}", out.display()))?;
    let _ = fs::remove_file(&out);
    Ok(bytes)
}

/// UI 用: クリップディレクトリに保存したインポートから 1 フレームを PNG で返す。
pub fn export_clip_source_frame_png(
    clips_dir: &Path,
    clip_id: &str,
    frame_index: u32,
) -> Result<Vec<u8>> {
    crate::clip::validate_clip_id(clip_id)?;
    if crate::clip::is_demo_id(clip_id) {
        anyhow::bail!("demo clips have no stored source frame");
    }
    let dir = clips_dir.join(clip_id);
    let manifest = read_clip_manifest(&dir)?;
    if frame_index >= manifest.frame_count {
        anyhow::bail!(
            "frame index {} out of range (frameCount={})",
            frame_index,
            manifest.frame_count
        );
    }
    let import_path = resolve_stored_import_path(
        &dir,
        manifest
            .source
            .as_ref()
            .context("clip has no source metadata")?,
    )?;
    let idx = frame_index as usize;
    match manifest
        .source
        .as_ref()
        .context("clip has no source metadata")?
        .kind
        .as_str()
    {
        "equirectangular-image" => {
            if idx != 0 {
                anyhow::bail!("single-image clip only has frame 0");
            }
            let image = ImageReader::open(&import_path)
                .with_context(|| format!("open {}", import_path.display()))?
                .decode()
                .with_context(|| format!("decode {}", import_path.display()))?
                .to_rgba8();
            rgba_to_png_bytes(&image)
        }
        "equirectangular-image-sequence" => {
            let rgba = read_zip_entry_rgba(&import_path, idx)?;
            rgba_to_png_bytes(&rgba)
        }
        "equirectangular-video" => extract_video_frame_png(&import_path, manifest.fps, frame_index),
        other => anyhow::bail!("unsupported source kind for preview: {other}"),
    }
}

/// クリップディレクトリをディスクから完全削除する。
pub fn delete_clip_directory(clips_dir: &Path, clip_id: &str) -> Result<()> {
    crate::clip::validate_clip_id(clip_id)?;
    if crate::clip::is_demo_id(clip_id) {
        anyhow::bail!("cannot delete built-in demo clip");
    }
    let dir = clips_dir.join(clip_id);
    if !dir.is_dir() {
        anyhow::bail!("clip not found: {clip_id}");
    }
    fs::remove_dir_all(&dir).with_context(|| format!("remove {}", dir.display()))?;
    Ok(())
}

fn clip_kind_from_source(source_kind: &str) -> String {
    match source_kind {
        "equirectangular-image" => "equirect-image".to_string(),
        "equirectangular-image-sequence" => "equirect-image-sequence".to_string(),
        "equirectangular-video" => "equirect-video".to_string(),
        other => other.to_string(),
    }
}

/// 正距円筒 **単一画像**、**ZIP 内 PNG/JPEG 連番**、または **動画（ffmpeg）** からクリップを生成する。
#[allow(clippy::too_many_arguments)]
pub fn convert_uploaded_media_to_clip(
    source_path: &Path,
    clip_id: &str,
    clips_dir: &Path,
    fps: u32,
    display_name: Option<&str>,
    width: u32,
    height: u32,
    progress: Option<&Arc<AtomicU8>>,
) -> Result<PathBuf> {
    let fps = fps.clamp(1, 120);
    let width = width.max(1);
    let height = height.max(1);
    crate::clip::validate_clip_id(clip_id)?;

    set_prog(progress, 2);
    let dn = sanitize_display_name(display_name);

    let (frame_bytes, frame_count, mut source) = if is_zip_file(source_path)? {
        build_equirect_from_zip(source_path, width, height, progress)?
    } else if is_video_file(source_path) {
        build_equirect_from_video(source_path, width, height, fps, progress)?
    } else {
        set_prog(progress, 12);
        let image = ImageReader::open(source_path)
            .with_context(|| format!("open {}", source_path.display()))?
            .decode()
            .with_context(|| format!("decode {}", source_path.display()))?
            .to_rgba8();
        let orig_w = image.width();
        let orig_h = image.height();
        if orig_w == 0 || orig_h == 0 {
            anyhow::bail!("image has zero width or height");
        }
        set_prog(progress, 40);
        let frame = equirect::rgba_to_equirect_rgb(&image, width, height);
        set_prog(progress, 85);
        let source = ClipSourceMeta {
            kind: "equirectangular-image".to_string(),
            path: String::new(),
            orig_width: orig_w,
            orig_height: orig_h,
        };
        (frame, 1, source)
    };

    let out_dir = clips_dir.join(clip_id);
    fs::create_dir_all(&out_dir).with_context(|| format!("create {}", out_dir.display()))?;
    fs::write(out_dir.join("equirect.bin"), &frame_bytes)
        .with_context(|| format!("write {}", out_dir.join("equirect.bin").display()))?;

    let import_rel = copy_upload_to_clip_import(source_path, &out_dir)?;
    source.path = import_rel;

    let kind = clip_kind_from_source(&source.kind);
    let manifest = ClipManifest {
        format: "glowbe-clip".to_string(),
        version: 1,
        id: clip_id.to_string(),
        kind,
        fps,
        frame_count,
        width,
        height,
        source_id: None,
        thumb_frame_index: 0,
        placement: None,
        gamma: default_clip_gamma(),
        source: Some(source),
        created_at_unix_sec: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        display_name: dn,
    };
    write_clip_manifest(&out_dir, &manifest)?;

    set_prog(progress, 100);
    Ok(out_dir)
}

/// CLI 用: 単一画像のみ（表示名・進捗なし）。
pub fn convert_equirect_image_to_clip(
    image_path: &Path,
    clip_id: &str,
    clips_dir: &Path,
    fps: u32,
) -> Result<PathBuf> {
    convert_uploaded_media_to_clip(
        image_path,
        clip_id,
        clips_dir,
        fps,
        None,
        DEFAULT_WIDTH,
        DEFAULT_HEIGHT,
        None,
    )
}

/// `manifest.json` の `displayName` / `thumbFrameIndex` / `gamma` を更新。
pub fn patch_clip_manifest(
    clips_dir: &Path,
    clip_id: &str,
    display_name: Option<&str>,
    thumb_frame_index: Option<u32>,
    gamma: Option<f32>,
) -> Result<()> {
    crate::clip::validate_clip_id(clip_id)?;
    if crate::clip::is_demo_id(clip_id) {
        anyhow::bail!("cannot edit built-in demo clip");
    }
    let dir = clips_dir.join(clip_id);
    let mut manifest = read_clip_manifest(&dir)?;
    if let Some(dn) = display_name {
        manifest.display_name = sanitize_display_name(Some(dn));
    }
    if let Some(idx) = thumb_frame_index {
        manifest.thumb_frame_index = idx;
    }
    if let Some(g) = gamma {
        manifest.gamma = crate::master_tone::clamp_clip_gamma_f32(g);
    }
    write_clip_manifest(&dir, &manifest)
}

pub fn clip_summary(clips_dir: &Path, clip_id: &str) -> Result<ClipSummary> {
    crate::clip::validate_clip_id(clip_id)?;
    if let Some(demo) = crate::demos::DemoId::parse(clip_id) {
        return crate::demos::demo_clip_summaries()
            .into_iter()
            .find(|s| s.id == demo.clip_id())
            .context("demo summary missing");
    }
    let dir = clips_dir.join(clip_id);
    let manifest = read_clip_manifest(&dir)?;
    Ok(summary_from_manifest(&manifest))
}

pub fn list_media_clips(clips_dir: &Path) -> Result<Vec<ClipSummary>> {
    if !clips_dir.exists() {
        return Ok(Vec::new());
    }

    let mut out = Vec::new();
    for entry in fs::read_dir(clips_dir).with_context(|| format!("read {}", clips_dir.display()))? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let dir = entry.path();
        if let Ok(manifest) = read_clip_manifest(&dir) {
            out.push(summary_from_manifest(&manifest));
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

pub fn read_clip_manifest(dir: &Path) -> Result<ClipManifest> {
    let manifest_path = dir.join("manifest.json");
    let manifest_raw = fs::read_to_string(&manifest_path)
        .with_context(|| format!("read {}", manifest_path.display()))?;
    let manifest: ClipManifest = serde_json::from_str(&manifest_raw)
        .with_context(|| format!("parse {}", manifest_path.display()))?;
    if manifest.format != "glowbe-clip" || manifest.version != 1 {
        anyhow::bail!(
            "unsupported clip format/version: {} v{}",
            manifest.format,
            manifest.version
        );
    }
    Ok(manifest)
}

fn write_clip_manifest(dir: &Path, manifest: &ClipManifest) -> Result<()> {
    let manifest_json = serde_json::to_vec_pretty(manifest).context("serialize manifest")?;
    fs::write(
        dir.join("manifest.json"),
        [manifest_json, b"\n".to_vec()].concat(),
    )
    .with_context(|| format!("write {}", dir.join("manifest.json").display()))?;
    Ok(())
}

fn summary_from_manifest(manifest: &ClipManifest) -> ClipSummary {
    let (source_kind, source_width, source_height) = if let Some(ref s) = manifest.source {
        (Some(s.kind.clone()), s.orig_width, s.orig_height)
    } else {
        (None, 0, 0)
    };
    ClipSummary {
        id: manifest.id.clone(),
        kind: manifest.kind.clone(),
        frame_count: manifest.frame_count,
        fps: manifest.fps,
        width: manifest.width,
        height: manifest.height,
        source_id: manifest.source_id.clone(),
        thumb_frame_index: Some(manifest.thumb_frame_index),
        source_kind,
        source_width,
        source_height,
        created_at_unix_sec: manifest.created_at_unix_sec,
        display_name: manifest.display_name.clone(),
        is_demo: None,
        gamma: crate::master_tone::clamp_clip_gamma_f32(manifest.gamma),
    }
}

/// Source エンティティから配置付きクリップを生成する（`source-import` は置かない）。
#[allow(clippy::too_many_arguments)]
pub fn convert_source_to_clip(
    sources_dir: &Path,
    source_id: &str,
    clip_id: &str,
    clips_dir: &Path,
    fps: u32,
    display_name: Option<&str>,
    thumb_frame_index: u32,
    placement: &crate::clip_placement::ClipPlacement,
    width: u32,
    height: u32,
    progress: Option<&Arc<AtomicU8>>,
) -> Result<PathBuf> {
    crate::clip::validate_clip_id(clip_id)?;
    crate::source::validate_source_id(source_id)?;
    let fps = fps.clamp(1, 120);
    let width = width.max(1);
    let height = height.max(1);

    let source_dir = sources_dir.join(source_id);
    let source_manifest = crate::source::read_source_manifest(&source_dir)?;
    let original = {
        let mut found = None;
        for entry in fs::read_dir(&source_dir)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("original.") && entry.file_type()?.is_file() {
                found = Some(entry.path());
                break;
            }
        }
        found.context("original file missing")?
    };

    set_prog(progress, 1);
    let dn = sanitize_display_name(display_name);
    let aspect = source_manifest.width as f32 / source_manifest.height.max(1) as f32;
    let mut placement = placement.clone();
    if !placement.source_aspect.is_finite() || placement.source_aspect <= 0.01 {
        placement.source_aspect = aspect;
    }

    let frame_count = match source_manifest.kind.as_str() {
        "equirectangular-video" => {
            let frames = bake_all_frames_from_video_source(
                &original, &placement, width, height, fps, progress,
            )?;
            write_equirect_bin(&clips_dir.join(clip_id), &frames)?;
            frames.1
        }
        "equirectangular-image-sequence" => {
            let frames =
                bake_all_frames_from_zip_source(&original, &placement, width, height, progress)?;
            write_equirect_bin(&clips_dir.join(clip_id), &frames)?;
            frames.1
        }
        "equirectangular-image" => {
            let rgba = load_source_frame_rgba_from_path(&original, &source_manifest.kind, fps, 0)?;
            let frame = crate::clip_placement::bake_frame_rgba_with_placement(
                &rgba, &placement, width, height,
            );
            let out_dir = clips_dir.join(clip_id);
            fs::create_dir_all(&out_dir)?;
            fs::write(out_dir.join("equirect.bin"), &frame)?;
            1
        }
        other => anyhow::bail!("unsupported source kind: {other}"),
    };

    let out_dir = clips_dir.join(clip_id);
    let kind = clip_kind_from_source(&source_manifest.kind);
    let manifest = ClipManifest {
        format: "glowbe-clip".into(),
        version: 1,
        id: clip_id.to_string(),
        kind,
        fps,
        frame_count,
        width,
        height,
        source_id: Some(source_id.to_string()),
        thumb_frame_index,
        placement: Some(placement),
        gamma: default_clip_gamma(),
        source: None,
        created_at_unix_sec: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        display_name: dn,
    };
    write_clip_manifest(&out_dir, &manifest)?;
    set_prog(progress, 100);
    Ok(out_dir)
}

fn write_equirect_bin(out_dir: &Path, frames: &(Vec<u8>, u32)) -> Result<()> {
    fs::create_dir_all(out_dir).with_context(|| format!("create {}", out_dir.display()))?;
    fs::write(out_dir.join("equirect.bin"), &frames.0)
        .with_context(|| format!("write {}", out_dir.join("equirect.bin").display()))?;
    Ok(())
}

fn bake_all_frames_from_zip_source(
    zip_path: &Path,
    placement: &crate::clip_placement::ClipPlacement,
    width: u32,
    height: u32,
    progress: Option<&Arc<AtomicU8>>,
) -> Result<(Vec<u8>, u32)> {
    let file = fs::File::open(zip_path).with_context(|| format!("open {}", zip_path.display()))?;
    let mut archive =
        zip::ZipArchive::new(std::io::BufReader::new(file)).context("open zip archive")?;
    let names = zip_collect_image_names(&mut archive)?;
    if names.len() > MAX_ZIP_FRAMES {
        anyhow::bail!("zip has too many images (max {MAX_ZIP_FRAMES})");
    }
    let frame_size = (width * height * 3) as usize;
    let mut all: Vec<u8> = Vec::with_capacity(frame_size * names.len());
    let n = names.len().max(1) as u32;
    for (idx, name) in names.iter().enumerate() {
        let mut buf = Vec::new();
        archive
            .by_name(name)
            .with_context(|| format!("zip entry {name}"))?
            .read_to_end(&mut buf)?;
        let rgba = image::load_from_memory(&buf)
            .with_context(|| format!("decode {name}"))?
            .to_rgba8();
        all.extend_from_slice(&crate::clip_placement::bake_frame_rgba_with_placement(
            &rgba, placement, width, height,
        ));
        let pct = (10 + ((idx + 1) as u32 * 89) / n).min(99) as u8;
        set_prog(progress, pct);
    }
    Ok((all, names.len() as u32))
}

fn bake_all_frames_from_video_source(
    video_path: &Path,
    placement: &crate::clip_placement::ClipPlacement,
    width: u32,
    height: u32,
    fps: u32,
    progress: Option<&Arc<AtomicU8>>,
) -> Result<(Vec<u8>, u32)> {
    let tmp = std::env::temp_dir().join(format!("glowbe-vid-{}", Uuid::new_v4()));
    fs::create_dir_all(&tmp)?;
    let out_pattern = tmp.join("frame_%06d.png");
    set_prog(progress, 5);
    let st = Command::new("ffmpeg")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-y")
        .arg("-i")
        .arg(video_path)
        .arg("-vf")
        .arg(format!("fps={fps}"))
        .arg("-frames:v")
        .arg(format!("{MAX_ZIP_FRAMES}"))
        .arg(out_pattern.to_string_lossy().as_ref())
        .status()
        .context("spawn ffmpeg")?;
    if !st.success() {
        let _ = fs::remove_dir_all(&tmp);
        anyhow::bail!("ffmpeg failed extracting video frames");
    }
    let mut names: Vec<String> = fs::read_dir(&tmp)?
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.to_ascii_lowercase().ends_with(".png"))
        .collect();
    names.sort();
    if names.is_empty() {
        let _ = fs::remove_dir_all(&tmp);
        anyhow::bail!("ffmpeg produced no frames");
    }
    set_prog(progress, 10);
    let frame_size = (width * height * 3) as usize;
    let mut all: Vec<u8> = Vec::with_capacity(frame_size * names.len());
    let n = names.len().max(1) as u32;
    for (idx, name) in names.iter().enumerate() {
        let p = tmp.join(name);
        let rgba = ImageReader::open(&p)?.decode()?.to_rgba8();
        all.extend_from_slice(&crate::clip_placement::bake_frame_rgba_with_placement(
            &rgba, placement, width, height,
        ));
        let pct = (10 + ((idx + 1) as u32 * 89) / n).min(99) as u8;
        set_prog(progress, pct);
    }
    let _ = fs::remove_dir_all(&tmp);
    Ok((all, names.len() as u32))
}

/// Clip サムネイル用: Source の thumb フレーム PNG（そのまま）。
pub fn export_clip_thumbnail_png(
    clips_dir: &Path,
    sources_dir: &Path,
    clip_id: &str,
) -> Result<Vec<u8>> {
    crate::clip::validate_clip_id(clip_id)?;
    if crate::clip::is_demo_id(clip_id) {
        anyhow::bail!("demo clips have no source thumbnail");
    }
    let dir = clips_dir.join(clip_id);
    let manifest = read_clip_manifest(&dir)?;
    let source_id = manifest
        .source_id
        .as_deref()
        .context("clip has no sourceId")?;
    crate::source::export_source_frame_png(sources_dir, source_id, manifest.thumb_frame_index)
}

/// 配置プレビュー: Source の 1 フレームを配置適用して PNG 返却。
pub fn preview_placement_frame_png(
    sources_dir: &Path,
    source_id: &str,
    frame_index: u32,
    placement: &crate::clip_placement::ClipPlacement,
    width: u32,
    height: u32,
) -> Result<Vec<u8>> {
    let rgba = crate::source::load_source_frame_rgba(sources_dir, source_id, frame_index)?;
    let rgb = crate::clip_placement::bake_frame_rgba_with_placement(
        &rgba,
        placement,
        width.max(1),
        height.max(1),
    );
    let mut img = image::RgbaImage::new(width.max(1), height.max(1));
    for y in 0..height.max(1) {
        for x in 0..width.max(1) {
            let o = ((y * width.max(1) + x) * 3) as usize;
            img.put_pixel(x, y, image::Rgba([rgb[o], rgb[o + 1], rgb[o + 2], 255]));
        }
    }
    rgba_to_png_bytes(&img)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_display_name_trims_and_drops_empty() {
        assert_eq!(sanitize_display_name(None), None);
        assert_eq!(sanitize_display_name(Some("")), None);
        assert_eq!(sanitize_display_name(Some("   ")), None);
        assert_eq!(
            sanitize_display_name(Some("  hello \n ")),
            Some("hello".into())
        );
    }
}
