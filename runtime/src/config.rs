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
}

#[derive(Debug, Clone, Deserialize)]
pub struct Device {
    pub esp_ip: String,
    pub layout_id: String,
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
