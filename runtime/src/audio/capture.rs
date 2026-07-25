//! Enumerate PipeWire nodes and capture PCM via `pw-cli` / `pw-record`.

use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use tracing::{info, warn};

use super::types::{AudioInputDevice, AudioInputKind, AudioPlatformInfo, SAMPLE_RATE};

#[cfg(target_os = "linux")]
pub fn platform_info() -> AudioPlatformInfo {
    let has_pw = which("pw-cli") && which("pw-record");
    if has_pw {
        AudioPlatformInfo {
            available: true,
            reason: None,
            backend: "pipewire",
        }
    } else {
        AudioPlatformInfo {
            available: false,
            reason: Some("pw-cli / pw-record not found (install pipewire-bin)".into()),
            backend: "none",
        }
    }
}

#[cfg(not(target_os = "linux"))]
pub fn platform_info() -> AudioPlatformInfo {
    AudioPlatformInfo {
        available: false,
        reason: Some("Audio Visualizer requires Linux PipeWire".into()),
        backend: "none",
    }
}

fn which(bin: &str) -> bool {
    Command::new("sh")
        .arg("-c")
        .arg(format!("command -v {bin} >/dev/null 2>&1"))
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// List capturable nodes: Audio/Source (mics) and Audio/Sink (playback monitors).
pub fn list_input_devices() -> Result<Vec<AudioInputDevice>, String> {
    #[cfg(not(target_os = "linux"))]
    {
        return Err("PipeWire audio is only available on Linux".into());
    }
    #[cfg(target_os = "linux")]
    {
        let platform = platform_info();
        if !platform.available {
            return Err(platform
                .reason
                .unwrap_or_else(|| "PipeWire unavailable".into()));
        }
        let output = Command::new("pw-cli")
            .args(["ls", "Node"])
            .output()
            .map_err(|e| format!("pw-cli failed: {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "pw-cli ls Node exited {}",
                output.status.code().unwrap_or(-1)
            ));
        }
        let text = String::from_utf8_lossy(&output.stdout);
        Ok(parse_pw_cli_nodes(&text))
    }
}

pub fn parse_pw_cli_nodes(text: &str) -> Vec<AudioInputDevice> {
    let mut out = Vec::new();
    let mut name: Option<String> = None;
    let mut description: Option<String> = None;
    let mut media_class: Option<String> = None;

    let flush = |name: &mut Option<String>,
                 description: &mut Option<String>,
                 media_class: &mut Option<String>,
                 out: &mut Vec<AudioInputDevice>| {
        let Some(n) = name.take() else {
            *description = None;
            *media_class = None;
            return;
        };
        let class = media_class.take().unwrap_or_default();
        let desc = description.take().unwrap_or_else(|| n.clone());
        let kind = if class == "Audio/Source" {
            Some(AudioInputKind::Source)
        } else if class == "Audio/Sink" {
            Some(AudioInputKind::Monitor)
        } else {
            None
        };
        if let Some(kind) = kind {
            let label = match kind {
                AudioInputKind::Source => desc,
                AudioInputKind::Monitor => format!("{desc} (monitor)"),
            };
            out.push(AudioInputDevice {
                id: n,
                name: label,
                kind,
            });
        }
    };

    for line in text.lines() {
        let t = line.trim();
        if t.starts_with("id ") {
            flush(&mut name, &mut description, &mut media_class, &mut out);
            continue;
        }
        if let Some(v) = prop(t, "node.name") {
            name = Some(v);
        } else if let Some(v) = prop(t, "node.description") {
            description = Some(v);
        } else if let Some(v) = prop(t, "media.class") {
            media_class = Some(v);
        }
    }
    flush(&mut name, &mut description, &mut media_class, &mut out);
    out.sort_by_key(|d| d.name.to_lowercase());
    out
}

fn prop(line: &str, key: &str) -> Option<String> {
    let prefix = format!("{key} = ");
    let rest = line.strip_prefix(&prefix)?;
    Some(rest.trim().trim_matches('"').to_string())
}

pub struct CaptureHandle {
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
    child: Arc<Mutex<Option<Child>>>,
}

impl CaptureHandle {
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::Release);
        if let Ok(mut g) = self.child.lock() {
            if let Some(mut c) = g.take() {
                let _ = c.kill();
                let _ = c.wait();
            }
        }
        if let Some(j) = self.join.take() {
            let _ = j.join();
        }
    }
}

impl Drop for CaptureHandle {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Ok(mut g) = self.child.lock() {
            if let Some(mut c) = g.take() {
                let _ = c.kill();
                let _ = c.wait();
            }
        }
    }
}

/// Start `pw-record` and push mono f32 samples into `on_samples`.
pub fn start_capture<F>(target_id: &str, mut on_samples: F) -> Result<CaptureHandle, String>
where
    F: FnMut(&[f32]) + Send + 'static,
{
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (target_id, &mut on_samples);
        return Err("PipeWire audio is only available on Linux".into());
    }
    #[cfg(target_os = "linux")]
    {
        if !platform_info().available {
            return Err(platform_info()
                .reason
                .unwrap_or_else(|| "PipeWire unavailable".into()));
        }
        let mut child = Command::new("pw-record")
            .args([
                "--target",
                target_id,
                "--rate",
                &SAMPLE_RATE.to_string(),
                "--channels",
                "1",
                "--format",
                "f32",
                "--latency",
                "20ms",
                "-",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("pw-record spawn failed: {e}"))?;

        let mut stdout = child
            .stdout
            .take()
            .ok_or_else(|| "pw-record stdout missing".to_string())?;
        let stop = Arc::new(AtomicBool::new(false));
        let stop_t = stop.clone();
        let child_arc = Arc::new(Mutex::new(Some(child)));
        let child_t = child_arc.clone();
        let target = target_id.to_string();

        let join = thread::Builder::new()
            .name("glowbe-pw-capture".into())
            .spawn(move || {
                info!(target = %target, "pipewire capture started");
                let mut buf = [0u8; 4096];
                let mut leftover = Vec::<u8>::new();
                while !stop_t.load(Ordering::Acquire) {
                    match stdout.read(&mut buf) {
                        Ok(0) => {
                            thread::sleep(Duration::from_millis(5));
                            // Check if process exited.
                            if let Ok(mut g) = child_t.lock() {
                                if let Some(c) = g.as_mut() {
                                    match c.try_wait() {
                                        Ok(Some(status)) => {
                                            warn!(
                                                "pw-record exited: {}",
                                                status.code().unwrap_or(-1)
                                            );
                                            break;
                                        }
                                        Ok(None) => {}
                                        Err(_) => break,
                                    }
                                }
                            }
                        }
                        Ok(n) => {
                            leftover.extend_from_slice(&buf[..n]);
                            let usable = leftover.len() / 4 * 4;
                            if usable == 0 {
                                continue;
                            }
                            let mut samples = Vec::with_capacity(usable / 4);
                            for chunk in leftover[..usable].chunks_exact(4) {
                                let bits =
                                    u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
                                samples.push(f32::from_bits(bits));
                            }
                            leftover.drain(..usable);
                            on_samples(&samples);
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                        Err(e) => {
                            warn!("pw-record read error: {e}");
                            break;
                        }
                    }
                }
                info!(target = %target, "pipewire capture stopped");
            })
            .map_err(|e| format!("capture thread: {e}"))?;

        Ok(CaptureHandle {
            stop,
            join: Some(join),
            child: child_arc,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_source_and_sink() {
        let text = r#"
	id 37, type PipeWire:Interface:Node/3
 		node.description = "USB Mic"
 		node.name = "alsa_input.usb.mic"
 		media.class = "Audio/Source"
	id 38, type PipeWire:Interface:Node/3
 		node.description = "Speakers"
 		node.name = "alsa_output.speakers"
 		media.class = "Audio/Sink"
	id 39, type PipeWire:Interface:Node/3
 		node.name = "Dummy-Driver"
"#;
        let devices = parse_pw_cli_nodes(text);
        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].kind, AudioInputKind::Monitor);
        assert!(devices[0].name.contains("monitor"));
        assert_eq!(devices[1].kind, AudioInputKind::Source);
        assert_eq!(devices[1].id, "alsa_input.usb.mic");
    }
}
