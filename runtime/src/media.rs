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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SequenceSource {
    kind: String,
    path: String,
    width: u32,
    height: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceSummary {
    pub id: String,
    pub layout_id: String,
    pub led_count: usize,
    pub frame_count: u32,
    pub fps: u32,
    pub source_kind: String,
    pub source_width: u32,
    pub source_height: u32,
    pub created_at_unix_sec: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompiledLayoutSummary {
    pub layout_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub led_count: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
}

pub fn list_compiled_layouts(compiled_dir: &Path) -> Result<Vec<CompiledLayoutSummary>> {
    let mut out: Vec<CompiledLayoutSummary> = Vec::new();
    let rd = fs::read_dir(compiled_dir)
        .with_context(|| format!("read_dir {}", compiled_dir.display()))?;
    for entry in rd {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(id) = name.strip_suffix(".meta.json").map(str::to_string) else {
            continue;
        };
        let raw = fs::read_to_string(entry.path())
            .with_context(|| format!("read {}", entry.path().display()))?;
        let v: serde_json::Value = serde_json::from_str(&raw).context("parse layout meta")?;
        let led_count = v["ledCount"].as_u64().unwrap_or(0).min(u64::from(u16::MAX)) as u16;
        let display_name = v["displayName"].as_str().map(String::from);
        let variant = v["variant"].as_str().map(String::from);
        out.push(CompiledLayoutSummary {
            layout_id: id,
            display_name,
            led_count,
            variant,
        });
    }
    out.sort_by(|a, b| a.layout_id.cmp(&b.layout_id));
    Ok(out)
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
        p.store(v.min(100), Ordering::Relaxed);
    }
}

fn load_ledmap(compiled_dir: &Path, layout_id: &str) -> Result<LedMap> {
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
    Ok(ledmap)
}

fn encode_frame(ledmap: &LedMap, image: &image::RgbaImage) -> Result<Vec<u8>> {
    let mut frame = vec![0u8; ledmap.leds.len() * 3];
    for led in &ledmap.leds {
        let [r, g, b] = sample_bilinear_rgb(image, led.u, led.v);
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
    Ok(frame)
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

fn build_frames_from_zip(
    source_path: &Path,
    ledmap: &LedMap,
    progress: Option<&Arc<AtomicU8>>,
) -> Result<(Vec<u8>, u32, SequenceSource)> {
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
    let w = first_img.width();
    let h = first_img.height();
    if w == 0 || h == 0 {
        anyhow::bail!("invalid image size in zip");
    }

    let frame_size = ledmap.leds.len() * 3;
    let mut all: Vec<u8> = Vec::with_capacity(frame_size * names.len());
    all.extend_from_slice(&encode_frame(ledmap, &first_img)?);
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
        if img.width() != w || img.height() != h {
            anyhow::bail!(
                "all zip images must share size {}×{}, but {name} is {}×{}",
                w,
                h,
                img.width(),
                img.height()
            );
        }
        all.extend_from_slice(&encode_frame(ledmap, &img)?);
        let pct = (((idx + 1) as u32 * 100) / names.len() as u32).min(99) as u8;
        set_prog(progress, pct.max(2));
    }

    let source = SequenceSource {
        kind: "equirectangular-image-sequence".to_string(),
        path: String::new(),
        width: w,
        height: h,
    };

    Ok((all, names.len() as u32, source))
}

fn build_frames_from_video(
    source_path: &Path,
    ledmap: &LedMap,
    fps: u32,
    progress: Option<&Arc<AtomicU8>>,
) -> Result<(Vec<u8>, u32, SequenceSource)> {
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
        .filter(|n| {
            let l = n.to_ascii_lowercase();
            l.ends_with(".png")
        })
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
    let w = first_img.width();
    let h = first_img.height();
    if w == 0 || h == 0 {
        let _ = fs::remove_dir_all(&tmp);
        anyhow::bail!("invalid frame size from video");
    }

    let frame_size = ledmap.leds.len() * 3;
    let mut all: Vec<u8> = Vec::with_capacity(frame_size * names.len());
    all.extend_from_slice(&encode_frame(ledmap, &first_img)?);
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
        if img.width() != w || img.height() != h {
            let _ = fs::remove_dir_all(&tmp);
            anyhow::bail!(
                "video frames must share size {}×{}, but {name} is {}×{}",
                w,
                h,
                img.width(),
                img.height()
            );
        }
        all.extend_from_slice(&encode_frame(ledmap, &img)?);
        let pct = (((idx + 1) as u32 * 100) / names.len() as u32).min(99) as u8;
        set_prog(progress, pct.max(2));
    }

    let _ = fs::remove_dir_all(&tmp);

    let source = SequenceSource {
        kind: "equirectangular-video".to_string(),
        path: String::new(),
        width: w,
        height: h,
    };

    Ok((all, names.len() as u32, source))
}

fn copy_upload_to_sequence_import(source_path: &Path, out_dir: &Path) -> Result<String> {
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

fn resolve_stored_import_path(seq_dir: &Path, source: &SequenceSource) -> Result<PathBuf> {
    let raw = Path::new(&source.path);
    let cand = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        seq_dir.join(raw)
    };
    if cand.is_file() {
        return Ok(cand);
    }
    for entry in fs::read_dir(seq_dir).with_context(|| format!("read {}", seq_dir.display()))? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("source-import.") && entry.file_type()?.is_file() {
            return Ok(entry.path());
        }
    }
    anyhow::bail!(
        "import media not found for sequence (expected {} or source-import.* under {})",
        cand.display(),
        seq_dir.display()
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

/// UI 用: シーケンスディレクトリに保存したインポート（画像 / zip 連番 / 動画）から 1 フレームを PNG で返す。
pub fn export_sequence_source_frame_png(
    sequences_dir: &Path,
    sequence_id: &str,
    frame_index: u32,
) -> Result<Vec<u8>> {
    if sequence_id.is_empty() || sequence_id.contains('/') || sequence_id.contains('\\') {
        anyhow::bail!("sequence id must be non-empty and path-safe");
    }
    let dir = sequences_dir.join(sequence_id);
    let manifest = read_manifest(&dir)?;
    if frame_index >= manifest.frame_count {
        anyhow::bail!(
            "frame index {} out of range (frameCount={})",
            frame_index,
            manifest.frame_count
        );
    }
    let import_path = resolve_stored_import_path(&dir, &manifest.source)?;
    let idx = frame_index as usize;
    match manifest.source.kind.as_str() {
        "equirectangular-image" => {
            if idx != 0 {
                anyhow::bail!("single-image sequence only has frame 0");
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
        "synthetic-expanding-ring-demo" => fs::read(&import_path)
            .with_context(|| format!("read synthetic thumbnail {}", import_path.display())),
        other => anyhow::bail!("unsupported source kind for preview: {other}"),
    }
}

/// シーケンスディレクトリをディスクから完全削除する。
pub fn delete_sequence_directory(sequences_dir: &Path, sequence_id: &str) -> Result<()> {
    if sequence_id.is_empty() || sequence_id.contains('/') || sequence_id.contains('\\') {
        anyhow::bail!("sequence id must be non-empty and must not contain path separators");
    }
    let dir = sequences_dir.join(sequence_id);
    if !dir.is_dir() {
        anyhow::bail!("sequence not found: {sequence_id}");
    }
    fs::remove_dir_all(&dir).with_context(|| format!("remove {}", dir.display()))?;
    Ok(())
}

fn write_gradient_placeholder_png(path: &Path, w: u32, h: u32) -> Result<()> {
    let mut img = image::RgbaImage::new(w, h);
    let wm = w.saturating_sub(1).max(1);
    let hm = h.saturating_sub(1).max(1);
    for (x, y, pixel) in img.enumerate_pixels_mut() {
        let r = (x * 255 / wm) as u8;
        let g = (y * 255 / hm) as u8;
        *pixel = image::Rgba([r, g, 220, 255]);
    }
    let mut buf = Vec::new();
    image::DynamicImage::from(img)
        .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
        .context("encode placeholder png")?;
    fs::write(path, buf).with_context(|| format!("write {}", path.display()))?;
    Ok(())
}

/// 合成デモ用: `frames.bin` + `manifest.json` + グリッド用プレースホルダ PNG。
#[allow(clippy::too_many_arguments)]
pub fn write_synthetic_demo_sequence(
    sequences_dir: &Path,
    sequence_id: &str,
    layout_id: &str,
    led_count: usize,
    fps: u32,
    frame_count: u32,
    frames: &[u8],
    display_name: Option<&str>,
) -> Result<PathBuf> {
    if sequence_id.is_empty() || sequence_id.contains('/') || sequence_id.contains('\\') {
        anyhow::bail!("sequence id must be non-empty and must not contain path separators");
    }
    let fps = fps.clamp(1, 120);
    let expected = led_count * 3 * frame_count as usize;
    if frames.len() != expected {
        anyhow::bail!(
            "frames size mismatch: got {}, expected {} ({} LEDs × {} frames × 3)",
            frames.len(),
            expected,
            led_count,
            frame_count
        );
    }
    let out_dir = sequences_dir.join(sequence_id);
    fs::create_dir_all(&out_dir).with_context(|| format!("create {}", out_dir.display()))?;
    fs::write(out_dir.join("frames.bin"), frames)
        .with_context(|| format!("write {}", out_dir.join("frames.bin").display()))?;
    write_gradient_placeholder_png(&out_dir.join("source-import.png"), 256, 128)?;

    let dn = sanitize_display_name(display_name);
    let manifest = SequenceManifest {
        format: "glowbe-sequence".to_string(),
        version: 1,
        id: sequence_id.to_string(),
        layout_id: layout_id.to_string(),
        led_count,
        frame_count,
        fps,
        source: SequenceSource {
            kind: "synthetic-expanding-ring-demo".to_string(),
            path: "source-import.png".to_string(),
            width: 256,
            height: 128,
        },
        created_at_unix_sec: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        display_name: dn,
    };
    let manifest_json = serde_json::to_vec_pretty(&manifest).context("serialize manifest")?;
    fs::write(
        out_dir.join("manifest.json"),
        [manifest_json, b"\n".to_vec()].concat(),
    )
    .with_context(|| format!("write {}", out_dir.join("manifest.json").display()))?;
    Ok(out_dir)
}

/// 正距円筒 **単一画像**、**ZIP 内 PNG/JPEG 連番**、または **動画（ffmpeg）** からシーケンスを生成する。
#[allow(clippy::too_many_arguments)]
pub fn convert_uploaded_media_to_sequence(
    source_path: &Path,
    sequence_id: &str,
    layout_id: &str,
    compiled_dir: &Path,
    sequences_dir: &Path,
    fps: u32,
    display_name: Option<&str>,
    progress: Option<&Arc<AtomicU8>>,
) -> Result<PathBuf> {
    let fps = fps.clamp(1, 120);
    if sequence_id.is_empty() || sequence_id.contains('/') || sequence_id.contains('\\') {
        anyhow::bail!("sequence id must be non-empty and must not contain path separators");
    }

    set_prog(progress, 2);
    let ledmap = load_ledmap(compiled_dir, layout_id)?;
    set_prog(progress, 5);

    let dn = sanitize_display_name(display_name);

    let (frame_bytes, frame_count, mut source) = if is_zip_file(source_path)? {
        build_frames_from_zip(source_path, &ledmap, progress)?
    } else if is_video_file(source_path) {
        build_frames_from_video(source_path, &ledmap, fps, progress)?
    } else {
        set_prog(progress, 12);
        let image = ImageReader::open(source_path)
            .with_context(|| format!("open {}", source_path.display()))?
            .decode()
            .with_context(|| format!("decode {}", source_path.display()))?
            .to_rgba8();
        let width = image.width();
        let height = image.height();
        if width == 0 || height == 0 {
            anyhow::bail!("image has zero width or height");
        }
        set_prog(progress, 40);
        let frame = encode_frame(&ledmap, &image)?;
        set_prog(progress, 85);
        let source = SequenceSource {
            kind: "equirectangular-image".to_string(),
            path: String::new(),
            width,
            height,
        };
        (frame, 1, source)
    };

    let out_dir = sequences_dir.join(sequence_id);
    fs::create_dir_all(&out_dir).with_context(|| format!("create {}", out_dir.display()))?;
    fs::write(out_dir.join("frames.bin"), &frame_bytes)
        .with_context(|| format!("write {}", out_dir.join("frames.bin").display()))?;

    let import_rel = copy_upload_to_sequence_import(source_path, &out_dir)?;
    source.path = import_rel;

    let manifest = SequenceManifest {
        format: "glowbe-sequence".to_string(),
        version: 1,
        id: sequence_id.to_string(),
        layout_id: layout_id.to_string(),
        led_count: ledmap.leds.len(),
        frame_count,
        fps,
        source,
        created_at_unix_sec: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        display_name: dn,
    };
    let manifest_json = serde_json::to_vec_pretty(&manifest).context("serialize manifest")?;
    fs::write(
        out_dir.join("manifest.json"),
        [manifest_json, b"\n".to_vec()].concat(),
    )
    .with_context(|| format!("write {}", out_dir.join("manifest.json").display()))?;

    set_prog(progress, 100);
    Ok(out_dir)
}

/// CLI 用: 単一画像のみ（表示名・進捗なし）。
pub fn convert_equirect_image_to_sequence(
    image_path: &Path,
    sequence_id: &str,
    layout_id: &str,
    compiled_dir: &Path,
    sequences_dir: &Path,
    fps: u32,
) -> Result<PathBuf> {
    convert_uploaded_media_to_sequence(
        image_path,
        sequence_id,
        layout_id,
        compiled_dir,
        sequences_dir,
        fps,
        None,
        None,
    )
}

/// `manifest.json` の `displayName` を更新（`None` または空文字でキー削除）。
pub fn set_sequence_display_name(
    sequences_dir: &Path,
    sequence_id: &str,
    display_name: Option<&str>,
) -> Result<()> {
    if sequence_id.is_empty() || sequence_id.contains('/') || sequence_id.contains('\\') {
        anyhow::bail!("sequence id must be non-empty and must not contain path separators");
    }
    let path = sequences_dir.join(sequence_id).join("manifest.json");
    let raw = fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
    let mut v: serde_json::Value =
        serde_json::from_str(&raw).with_context(|| format!("parse {}", path.display()))?;
    let obj = v
        .as_object_mut()
        .context("manifest root must be a JSON object")?;
    match sanitize_display_name(display_name) {
        None => {
            obj.remove("displayName");
        }
        Some(s) => {
            obj.insert("displayName".into(), serde_json::Value::String(s));
        }
    }
    let out = serde_json::to_vec_pretty(&v).context("serialize manifest")?;
    fs::write(&path, [out, b"\n".to_vec()].concat())
        .with_context(|| format!("write {}", path.display()))?;
    Ok(())
}

pub fn sequence_summary(sequences_dir: &Path, sequence_id: &str) -> Result<SequenceSummary> {
    if sequence_id.is_empty() || sequence_id.contains('/') || sequence_id.contains('\\') {
        anyhow::bail!("sequence id must be non-empty and must not contain path separators");
    }
    let dir = sequences_dir.join(sequence_id);
    let manifest = read_manifest(&dir)?;
    Ok(summary_from_manifest(&manifest))
}

fn summary_from_manifest(manifest: &SequenceManifest) -> SequenceSummary {
    SequenceSummary {
        id: manifest.id.clone(),
        layout_id: manifest.layout_id.clone(),
        led_count: manifest.led_count,
        frame_count: manifest.frame_count,
        fps: manifest.fps,
        source_kind: manifest.source.kind.clone(),
        source_width: manifest.source.width,
        source_height: manifest.source.height,
        created_at_unix_sec: manifest.created_at_unix_sec,
        display_name: manifest.display_name.clone(),
    }
}

pub fn load_sequence(sequence_dir: &Path, sequence_id: &str) -> Result<LoadedSequence> {
    if sequence_id.is_empty() || sequence_id.contains('/') || sequence_id.contains('\\') {
        anyhow::bail!("sequence id must be non-empty and must not contain path separators");
    }
    let dir = sequence_dir.join(sequence_id);
    let manifest = read_manifest(&dir)?;

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

pub fn list_sequences(sequence_dir: &Path) -> Result<Vec<SequenceSummary>> {
    if !sequence_dir.exists() {
        return Ok(Vec::new());
    }

    let mut out = Vec::new();
    for entry in
        fs::read_dir(sequence_dir).with_context(|| format!("read {}", sequence_dir.display()))?
    {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let dir = entry.path();
        if let Ok(manifest) = read_manifest(&dir) {
            out.push(summary_from_manifest(&manifest));
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

fn read_manifest(dir: &Path) -> Result<SequenceManifest> {
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
    Ok(manifest)
}

impl LoadedSequence {
    #[inline]
    pub fn frame_index_at(&self, elapsed: std::time::Duration) -> usize {
        ((elapsed.as_secs_f64() * self.fps as f64).floor() as usize) % self.frame_count.max(1)
    }

    pub fn copy_frame_at(&self, elapsed: std::time::Duration, out: &mut [u8]) -> Result<()> {
        let frame_size = self.led_count * 3;
        if out.len() != frame_size {
            anyhow::bail!(
                "output buffer size mismatch: got {}, expected {}",
                out.len(),
                frame_size
            );
        }
        let frame = self.frame_index_at(elapsed);
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
