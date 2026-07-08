//! Layout-independent loop clips (built-in demos + mmap equirect media).

use std::fs::File;
use std::path::Path;
use std::time::Duration;

use anyhow::{Context, Result};
use memmap2::Mmap;

use crate::demos::{self, DemoId};
use crate::equirect;
use crate::media::{ClipManifest, ClipSummary};

#[derive(Debug)]
enum ClipSource {
    Demo(DemoId),
    Media(MediaClip),
}

#[derive(Debug)]
pub struct LoadedClip {
    pub id: String,
    /// Loop-media gamma from manifest. Demos use 1 (identity).
    pub gamma: f32,
    source: ClipSource,
}

#[derive(Debug)]
struct MediaClip {
    fps: u32,
    frame_count: u32,
    width: u32,
    height: u32,
    mmap: Mmap,
    _file: File,
}

impl MediaClip {
    fn open(dir: &Path, manifest: &ClipManifest) -> Result<Self> {
        let path = dir.join("equirect.bin");
        let file = File::open(&path).with_context(|| format!("open {}", path.display()))?;
        let mmap = unsafe { Mmap::map(&file).context("mmap equirect.bin")? };
        let frame_bytes = (manifest.width * manifest.height * 3) as usize;
        let expected = frame_bytes * manifest.frame_count as usize;
        if mmap.len() != expected {
            anyhow::bail!(
                "equirect.bin size mismatch: got {}, expected {} ({}×{}×{}×{})",
                mmap.len(),
                expected,
                manifest.frame_count,
                manifest.width,
                manifest.height,
                3
            );
        }
        Ok(Self {
            fps: manifest.fps,
            frame_count: manifest.frame_count,
            width: manifest.width,
            height: manifest.height,
            mmap,
            _file: file,
        })
    }

    fn frame_index_at(&self, elapsed: Duration) -> u32 {
        ((elapsed.as_secs_f64() * self.fps as f64).floor() as u32) % self.frame_count.max(1)
    }

    fn frame_slice(&self, index: u32) -> &[u8] {
        let frame_bytes = (self.width * self.height * 3) as usize;
        let start = index as usize * frame_bytes;
        &self.mmap[start..start + frame_bytes]
    }

    fn sample_into(&self, elapsed: Duration, uv: &[(f32, f32)], out: &mut [u8]) -> Result<()> {
        let expected = uv.len() * 3;
        if out.len() != expected {
            anyhow::bail!(
                "output buffer size mismatch: got {}, expected {}",
                out.len(),
                expected
            );
        }
        let idx = self.frame_index_at(elapsed);
        let frame = self.frame_slice(idx);
        for (i, &(u, v)) in uv.iter().enumerate() {
            let [r, g, b] = equirect::sample_bilinear_rgb(frame, self.width, self.height, u, v);
            let o = i * 3;
            out[o] = r;
            out[o + 1] = g;
            out[o + 2] = b;
        }
        Ok(())
    }
}

pub fn is_demo_id(id: &str) -> bool {
    DemoId::parse(id).is_some()
}

/// `demo/...` ビルトイン id、またはディスク上クリップ用の単一パスセグメント。
pub fn validate_clip_id(id: &str) -> Result<()> {
    if id.is_empty() {
        anyhow::bail!("clip id must be non-empty");
    }
    if DemoId::parse(id).is_some() {
        return Ok(());
    }
    if id.contains('/') || id.contains('\\') {
        anyhow::bail!("clip id must not contain path separators");
    }
    Ok(())
}

pub fn load_clip(clips_dir: &Path, clip_id: &str) -> Result<LoadedClip> {
    validate_clip_id(clip_id)?;
    if let Some(demo) = DemoId::parse(clip_id) {
        return Ok(LoadedClip {
            id: clip_id.to_string(),
            gamma: 1.0,
            source: ClipSource::Demo(demo),
        });
    }
    let dir = clips_dir.join(clip_id);
    let manifest = crate::media::read_clip_manifest(&dir)?;
    if manifest.id != clip_id {
        anyhow::bail!(
            "manifest id mismatch: got {}, expected {}",
            manifest.id,
            clip_id
        );
    }
    let media = MediaClip::open(&dir, &manifest)?;
    Ok(LoadedClip {
        id: clip_id.to_string(),
        gamma: crate::master_tone::clamp_clip_gamma_f32(manifest.gamma),
        source: ClipSource::Media(media),
    })
}

impl LoadedClip {
    pub fn sample_into(&self, elapsed: Duration, uv: &[(f32, f32)], out: &mut [u8]) -> Result<()> {
        match &self.source {
            ClipSource::Demo(d) => {
                demos::render(*d, elapsed, uv, out);
                Ok(())
            }
            ClipSource::Media(m) => m.sample_into(elapsed, uv, out),
        }
    }

    /// メディアクリップの現在ソースフレーム index。
    /// デモは procedural（離散ソースフレームを持たず、常にデバイス fps で描画）のため `None`。
    pub fn source_frame_index_at(&self, elapsed: Duration) -> Option<u32> {
        match &self.source {
            ClipSource::Demo(_) => None,
            ClipSource::Media(m) => Some(m.frame_index_at(elapsed)),
        }
    }
}

pub fn list_all_clips(clips_dir: &Path) -> Result<Vec<ClipSummary>> {
    let mut out = demos::demo_clip_summaries();
    out.extend(crate::media::list_media_clips(clips_dir)?);
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_clip_id_allows_builtin_demo_slash() {
        validate_clip_id("demo/expanding-rings").unwrap();
        validate_clip_id("up-550e8400-e29b-41d4-a716-446655440000").unwrap();
        assert!(validate_clip_id("").is_err());
        assert!(validate_clip_id("foo/bar").is_err());
    }
}
