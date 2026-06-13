use std::fs;
use std::path::Path;

use anyhow::Result;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub device: Device,
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

impl Device {
    pub fn esp_ip_host(&self) -> Option<&str> {
        self.esp_ip
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Output {
    pub udp_port: u16,
    pub target_fps: u32,
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
}

#[derive(Debug, Clone, Deserialize)]
pub struct Modes {
    #[serde(default = "default_mode")]
    pub default: String,
}

fn default_mode() -> String {
    "loop".into()
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
