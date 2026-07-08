use std::fs;
use std::path::Path;

use anyhow::Result;
use serde::Deserialize;

use crate::devices::DeviceRecord;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub device: Device,
    #[serde(default)]
    pub devices: Vec<DeviceRecord>,
    pub output: Output,
    pub server: Server,
    #[serde(default)]
    pub modes: Modes,
    #[serde(default)]
    pub assets: Assets,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Device {
    /// When omitted or empty, runtime discovers `_glowbe._udp` via mDNS.
    #[serde(default)]
    pub esp_ip: Option<String>,
    pub layout_id: String,
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
