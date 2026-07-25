use std::fs;
use std::path::Path;

use anyhow::Result;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub output: Output,
    pub server: Server,
    #[serde(default)]
    pub modes: Modes,
    #[serde(default)]
    pub assets: Assets,
    #[serde(default)]
    pub audio: Audio,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct Audio {
    /// Optional PipeWire node.name to capture on startup.
    #[serde(default)]
    pub default_input: Option<String>,
    /// Analysis / visualizer update hint (Hz). Reserved for future throttling.
    #[allow(dead_code)]
    #[serde(default = "default_analysis_hz")]
    pub analysis_hz: u32,
}

fn default_analysis_hz() -> u32 {
    60
}

#[derive(Debug, Clone, Deserialize)]
pub struct Output {
    pub udp_port: u16,
    #[serde(default = "default_status_port")]
    pub status_port: u16,
}

fn default_status_port() -> u16 {
    49153
}

#[derive(Debug, Clone, Deserialize)]
pub struct Server {
    pub bind: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct Assets {
    /// Directory containing `<layout_id>.meta.json` etc. Relative paths are from cwd.
    #[serde(default)]
    pub compiled_dir: Option<String>,
    /// Directory containing generated clip directories. Relative paths are from cwd.
    #[serde(default)]
    pub clips_dir: Option<String>,
    /// Directory containing source media entities. Relative paths are from cwd.
    #[serde(default)]
    pub sources_dir: Option<String>,
    /// Staging for `POST /api/v1/media/upload` before convert. Relative paths are from cwd.
    #[serde(default)]
    pub uploads_dir: Option<String>,
    /// Persistent device registry JSON. Default: `assets/devices.json` under repo root.
    #[serde(default)]
    pub devices_path: Option<String>,
    /// TTF used by text mode glyph rasterization. Default: `assets/text/NotoSansJP.ttf` under repo root.
    #[serde(default)]
    pub text_font_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Modes {
    #[serde(default = "default_mode")]
    pub default: String,
}

fn default_mode() -> String {
    "idle".into()
}

impl Default for Modes {
    fn default() -> Self {
        Self {
            default: default_mode(),
        }
    }
}

pub fn load(path: &Path) -> Result<Config> {
    let raw = fs::read_to_string(path)?;
    let cfg: Config = toml::from_str(&raw)?;
    Ok(cfg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minimal_config_ok() {
        let raw = r#"
[output]
udp_port = 49152
[server]
bind = "0.0.0.0:8748"
"#;
        let cfg: Config = toml::from_str(raw).unwrap();
        assert_eq!(cfg.output.udp_port, 49152);
        assert_eq!(cfg.modes.default, "idle");
    }

    #[test]
    fn unknown_device_section_is_ignored() {
        // Old configs may still contain [device]; serde ignores unknown tables.
        let raw = r#"
[device]
esp_ip = "192.168.0.1"
layout_id = "geodesic-2v-60"
[output]
udp_port = 49152
[server]
bind = "0.0.0.0:8748"
"#;
        assert!(toml::from_str::<Config>(raw).is_ok());
    }
}
