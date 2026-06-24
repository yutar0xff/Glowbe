//! 永続デバイスレジストリ（`devices.json`）と LAN 探索の突合。

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use uuid::{Uuid, Version};

use crate::config::Config;
use crate::master_tone::{clamp_brightness, clamp_gamma};

pub use crate::master_tone::{DEFAULT_MASTER_BRIGHTNESS, DEFAULT_MASTER_GAMMA};

pub const DEFAULT_OUTPUT_FPS: u32 = 120;

/// 新規デバイス用の UUID v7（時系列ソート可能）。
pub fn new_device_id() -> String {
    Uuid::now_v7().to_string()
}

pub fn is_uuid_v7(id: &str) -> bool {
    Uuid::parse_str(id)
        .ok()
        .is_some_and(|u| u.get_version() == Some(Version::SortRand))
}

/// mDNS ホストラベル（`.local` や末尾の `.` なし）に正規化する。
pub fn normalize_mdns_hostname(raw: &str) -> Option<String> {
    let mut s = raw.trim().trim_end_matches('.').to_string();
    if s.is_empty() {
        return None;
    }
    if let Some(stripped) = s.strip_suffix(".local") {
        s = stripped.trim_end_matches('.').to_string();
    }
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

pub fn mdns_hosts_match(a: &str, b: &str) -> bool {
    match (normalize_mdns_hostname(a), normalize_mdns_hostname(b)) {
        (Some(x), Some(y)) => x == y,
        _ => false,
    }
}

fn validate_device_id(id: &str) -> Result<()> {
    if !is_uuid_v7(id) {
        anyhow::bail!("device id must be UUID version 7");
    }
    Ok(())
}

fn migrate_legacy_device_ids(devices: &mut [DeviceRecord]) -> bool {
    let mut changed = false;
    for d in devices.iter_mut() {
        if is_uuid_v7(&d.id) {
            continue;
        }
        let new_id = new_device_id();
        tracing::info!(old_id = %d.id, new_id = %new_id, "migrated device id to UUID v7");
        d.id = new_id;
        changed = true;
    }
    changed
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceRecord {
    pub id: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub esp_ip: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mdns_hostname: Option<String>,
    pub layout_id: String,
    pub output_fps: u32,
    #[serde(default = "default_master_brightness")]
    pub master_brightness: f64,
    #[serde(default = "default_master_gamma")]
    pub master_gamma: f64,
}

fn default_master_brightness() -> f64 {
    DEFAULT_MASTER_BRIGHTNESS
}

fn default_master_gamma() -> f64 {
    DEFAULT_MASTER_GAMMA
}

fn clamp_master_tone(rec: &mut DeviceRecord) {
    rec.master_brightness = clamp_brightness(rec.master_brightness);
    rec.master_gamma = clamp_gamma(rec.master_gamma);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DevicesFile {
    format: String,
    version: u32,
    devices: Vec<DeviceRecord>,
}

impl DevicesFile {
    fn from_devices(devices: Vec<DeviceRecord>) -> Self {
        Self {
            format: "glowbe-devices".into(),
            version: 1,
            devices,
        }
    }
}

#[derive(Debug, Clone)]
pub struct DeviceRegistry {
    path: PathBuf,
    devices: Vec<DeviceRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredEsp {
    pub hostname: String,
    pub ipv4: String,
    pub port: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registered_device_id: Option<String>,
}

impl DeviceRegistry {
    pub fn devices(&self) -> &[DeviceRecord] {
        &self.devices
    }

    pub fn load_or_seed(path: PathBuf, config: &Config, compiled_dir: &Path) -> Result<Self> {
        if path.exists() {
            let raw =
                fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
            let file: DevicesFile =
                serde_json::from_str(&raw).with_context(|| format!("parse {}", path.display()))?;
            if file.format != "glowbe-devices" || file.version != 1 {
                anyhow::bail!("unsupported devices file format/version");
            }
            let mut devices = file.devices;
            let mut tone_clamped = false;
            for rec in &mut devices {
                let before_b = rec.master_brightness;
                let before_g = rec.master_gamma;
                clamp_master_tone(rec);
                if rec.master_brightness != before_b || rec.master_gamma != before_g {
                    tone_clamped = true;
                }
            }
            if migrate_legacy_device_ids(&mut devices) {
                let reg = Self { path, devices };
                reg.validate_all(compiled_dir)?;
                reg.save()?;
                return Ok(reg);
            }
            let reg = Self { path, devices };
            reg.validate_all(compiled_dir)?;
            if tone_clamped {
                reg.save()?;
            }
            return Ok(reg);
        }

        let seeded = seed_from_config(config);
        let reg = Self {
            path,
            devices: seeded,
        };
        reg.validate_all(compiled_dir)?;
        reg.save()?;
        Ok(reg)
    }

    pub fn save(&self) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("create dir {}", parent.display()))?;
        }
        let file = DevicesFile::from_devices(self.devices.clone());
        let tmp = self.path.with_extension("json.tmp");
        let json = serde_json::to_string_pretty(&file).context("serialize devices")?;
        fs::write(&tmp, &json).with_context(|| format!("write {}", tmp.display()))?;
        if self.path.exists() {
            let bak = self.path.with_extension("json.bak");
            let _ = fs::copy(&self.path, &bak);
        }
        fs::rename(&tmp, &self.path).with_context(|| format!("rename {}", self.path.display()))?;
        Ok(())
    }

    pub fn upsert(&mut self, rec: DeviceRecord, compiled_dir: &Path) -> Result<()> {
        let mut rec = rec;
        rec.mdns_hostname = rec
            .mdns_hostname
            .as_deref()
            .and_then(normalize_mdns_hostname);
        clamp_master_tone(&mut rec);
        validate_record(&rec, compiled_dir)?;
        let replace_id = self
            .devices
            .iter()
            .any(|d| d.id == rec.id)
            .then_some(rec.id.as_str());
        validate_unique_ips(&self.devices, &rec, replace_id)?;
        if let Some(i) = self.devices.iter().position(|d| d.id == rec.id) {
            self.devices[i] = rec;
        } else {
            self.devices.push(rec);
        }
        self.save()
    }

    pub fn update_master_tone(&mut self, id: &str, brightness: f64, gamma: f64) -> Result<()> {
        let pos = self
            .devices
            .iter()
            .position(|d| d.id == id)
            .ok_or_else(|| anyhow::anyhow!("device not found: {id}"))?;
        self.devices[pos].master_brightness = clamp_brightness(brightness);
        self.devices[pos].master_gamma = clamp_gamma(gamma);
        self.save()
    }

    pub fn remove(&mut self, id: &str) -> Result<DeviceRecord> {
        if self.devices.len() <= 1 {
            anyhow::bail!("cannot remove the last registered device");
        }
        let pos = self
            .devices
            .iter()
            .position(|d| d.id == id)
            .ok_or_else(|| anyhow::anyhow!("device not found: {id}"))?;
        let removed = self.devices.remove(pos);
        self.save()?;
        Ok(removed)
    }

    pub fn validate_all(&self, compiled_dir: &Path) -> Result<()> {
        let mut seen_id = HashMap::new();
        let mut seen_ip = HashMap::new();
        for d in &self.devices {
            validate_record(d, compiled_dir)?;
            if seen_id.insert(d.id.clone(), true).is_some() {
                anyhow::bail!("duplicate device id: {}", d.id);
            }
            if let Some(ip) = d.esp_ip_host() {
                if seen_ip.insert(ip.to_string(), d.id.clone()).is_some() {
                    anyhow::bail!("duplicate esp_ip: {ip}");
                }
            }
        }
        Ok(())
    }

    pub fn merge_discovered(
        &self,
        discovered: &[crate::discover::GlowbeService],
    ) -> Vec<DiscoveredEsp> {
        let ip_to_id: HashMap<String, String> = self
            .devices
            .iter()
            .filter_map(|d| d.esp_ip_host().map(|ip| (ip.to_string(), d.id.clone())))
            .collect();
        let host_to_id: HashMap<String, String> = self
            .devices
            .iter()
            .filter_map(|d| {
                d.mdns_hostname
                    .as_deref()
                    .and_then(normalize_mdns_hostname)
                    .map(|h| (h, d.id.clone()))
            })
            .collect();
        discovered
            .iter()
            .map(|s| {
                let registered_device_id = ip_to_id
                    .get(&s.ipv4)
                    .cloned()
                    .or_else(|| host_to_id.get(&s.hostname).cloned());
                DiscoveredEsp {
                    hostname: s.hostname.clone(),
                    ipv4: s.ipv4.clone(),
                    port: s.port,
                    registered_device_id,
                }
            })
            .collect()
    }
}

impl DeviceRecord {
    pub fn esp_ip_host(&self) -> Option<&str> {
        self.esp_ip
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
    }

    pub fn mdns_host(&self) -> Option<&str> {
        self.mdns_hostname
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
    }
}

fn seed_from_config(config: &Config) -> Vec<DeviceRecord> {
    let mut devices = if !config.devices.is_empty() {
        config.devices.clone()
    } else {
        vec![DeviceRecord {
            id: new_device_id(),
            display_name: "Default".into(),
            esp_ip: config.device.esp_ip.clone(),
            mdns_hostname: None,
            layout_id: config.device.layout_id.clone(),
            output_fps: DEFAULT_OUTPUT_FPS,
            master_brightness: DEFAULT_MASTER_BRIGHTNESS,
            master_gamma: DEFAULT_MASTER_GAMMA,
        }]
    };
    migrate_legacy_device_ids(&mut devices);
    devices
}

fn validate_record(rec: &DeviceRecord, compiled_dir: &Path) -> Result<()> {
    validate_device_id(&rec.id)?;
    if rec.layout_id.is_empty() || rec.layout_id.contains('/') || rec.layout_id.contains('\\') {
        anyhow::bail!("layout_id invalid");
    }
    if rec.output_fps == 0 {
        anyhow::bail!("output_fps must be at least 1");
    }
    let meta = compiled_dir.join(format!("{}.meta.json", rec.layout_id));
    if !meta.is_file() {
        anyhow::bail!("unknown layout_id: {}", rec.layout_id);
    }
    Ok(())
}

fn validate_unique_ips(
    existing: &[DeviceRecord],
    new_rec: &DeviceRecord,
    replace_id: Option<&str>,
) -> Result<()> {
    let Some(ip) = new_rec.esp_ip_host() else {
        return Ok(());
    };
    for d in existing {
        if replace_id == Some(d.id.as_str()) {
            continue;
        }
        if d.esp_ip_host() == Some(ip) {
            anyhow::bail!("esp_ip already used by device {}", d.id);
        }
    }
    Ok(())
}

pub fn devices_json_path(config: &Config) -> Result<PathBuf> {
    if let Some(ref p) = config.assets.devices_path {
        let pb = PathBuf::from(p);
        if pb.is_absolute() {
            return Ok(pb);
        }
        return Ok(std::env::current_dir().context("cwd")?.join(pb));
    }
    find_repo_root().map(|r| r.join("assets/devices.json"))
}

fn find_repo_root() -> Result<PathBuf> {
    let mut dir = std::env::current_dir().context("cwd")?;
    loop {
        if dir.join("assets/compiled").is_dir() {
            return Ok(dir);
        }
        if !dir.pop() {
            anyhow::bail!("could not find repo root; set [assets].devices_path");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_mdns_hostname_strips_local_suffix() {
        assert_eq!(
            normalize_mdns_hostname("glowbe-60faces.local."),
            Some("glowbe-60faces".into())
        );
        assert_eq!(
            normalize_mdns_hostname("  glowbe-proto.local  "),
            Some("glowbe-proto".into())
        );
        assert!(mdns_hosts_match("glowbe-60faces", "glowbe-60faces.local"));
    }

    #[test]
    fn device_id_must_be_uuid_v7() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../assets/compiled");
        let rec = DeviceRecord {
            id: new_device_id(),
            display_name: "P".into(),
            esp_ip: Some("192.168.0.1".into()),
            mdns_hostname: None,
            layout_id: "prototype-icosahedron-15".into(),
            output_fps: DEFAULT_OUTPUT_FPS,
            master_brightness: DEFAULT_MASTER_BRIGHTNESS,
            master_gamma: DEFAULT_MASTER_GAMMA,
        };
        assert!(validate_record(&rec, &dir).is_ok());
        let bad = DeviceRecord {
            id: "proto-1".into(),
            ..rec.clone()
        };
        assert!(validate_record(&bad, &dir).is_err());
    }

    #[test]
    fn upsert_same_ip_for_same_device_is_allowed() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../assets/compiled");
        let id = new_device_id();
        let mut reg = DeviceRegistry {
            path: PathBuf::from("/tmp/glowbe-devices-test.json"),
            devices: vec![DeviceRecord {
                id: id.clone(),
                display_name: "A".into(),
                esp_ip: Some("10.0.0.1".into()),
                mdns_hostname: None,
                layout_id: "prototype-icosahedron-15".into(),
                output_fps: DEFAULT_OUTPUT_FPS,
                master_brightness: DEFAULT_MASTER_BRIGHTNESS,
                master_gamma: DEFAULT_MASTER_GAMMA,
            }],
        };
        let updated = DeviceRecord {
            id,
            display_name: "A2".into(),
            esp_ip: Some("10.0.0.1".into()),
            mdns_hostname: None,
            layout_id: "prototype-icosahedron-15".into(),
            output_fps: 60,
            master_brightness: DEFAULT_MASTER_BRIGHTNESS,
            master_gamma: DEFAULT_MASTER_GAMMA,
        };
        assert!(reg.upsert(updated, &dir).is_ok());
        assert_eq!(reg.devices[0].display_name, "A2");
    }
}
