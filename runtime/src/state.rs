use std::collections::HashMap;
use std::sync::Arc;
use std::sync::RwLock as StdRwLock;
use std::time::{Duration, Instant};

use anyhow::Context;
use tokio::sync::RwLock;

use crate::device_slot::DeviceSlot;
use crate::devices::{DeviceRecord, DeviceRegistry};
use crate::layouts;

/// インタラクティブ（消灯＋ WS 合成）で選べるエフェクト種別。
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InteractiveEffectKind {
    /// 球面上ガウス（ソフトスポット）。
    SphereGaussian = 0,
    /// タップ中心から大円角距離で等方に拡大する波面と残光トレイル。
    ExpandingRingDiagonal = 1,
}

impl InteractiveEffectKind {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "sphereGaussian" => Some(Self::SphereGaussian),
            "expandingRingDiagonal" => Some(Self::ExpandingRingDiagonal),
            _ => None,
        }
    }

    pub fn from_code(c: u8) -> Self {
        match c {
            1 => Self::ExpandingRingDiagonal,
            _ => Self::SphereGaussian,
        }
    }

    pub fn code(self) -> u8 {
        self as u8
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::SphereGaussian => "sphereGaussian",
            Self::ExpandingRingDiagonal => "expandingRingDiagonal",
        }
    }
}

/// UV クリック起点のワンショット合成（出力ループが `rgb` に加算する）。複数パルスは重ね合わせる。
#[derive(Debug, Clone, Copy)]
pub struct InteractivePulse {
    pub center_u: f32,
    pub center_v: f32,
    pub amplitude: f32,
    /// 球面ガウス / 輪の太さの基準（ラジアン）。
    pub sigma_rad: f32,
    pub effect: InteractiveEffectKind,
    pub started: Instant,
    pub duration: Duration,
    /// 加算色（0–255）。パルス生成時に固定（ランダム時もこの時点で確定）。
    pub color_r: u8,
    pub color_g: u8,
    pub color_b: u8,
    /// 輪の角方向への進み（`t` に対する係数）。既定 1。
    pub ring_speed: f32,
    /// 輪のガウス幅（ラジアン）。`<= 0` のとき `sigma_rad * 1.35` を使う。
    pub ring_thickness_rad: f32,
}

/// 同時に重ねられるインタラクティブ・パルスの上限（過去分は古い順に捨てる）。
pub const MAX_INTERACTIVE_PULSES: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputMode {
    /// 黒フレームのみ（WS インタラクティブ合成なし）。
    Idle,
    /// シーケンスまたはテストパターン。
    Loop,
    /// 消灯ベース。WebSocket のインタラクティブ・パルスのみ UDP に合成。
    Interactive,
    /// 顔パーツ SDF 合成（製品レイアウト向け）。
    Mate,
    /// 任意の文章を球面の周りに流すテキストモード。
    Text,
}

impl OutputMode {
    const IDLE: u8 = 0;
    const LOOP: u8 = 1;
    const INTERACTIVE: u8 = 2;
    const MATE: u8 = 3;
    const TEXT: u8 = 4;

    pub fn parse(id: &str) -> Option<Self> {
        match id {
            "idle" => Some(Self::Idle),
            "loop" => Some(Self::Loop),
            "interactive" => Some(Self::Interactive),
            "mate" => Some(Self::Mate),
            "text" => Some(Self::Text),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Loop => "loop",
            Self::Interactive => "interactive",
            Self::Mate => "mate",
            Self::Text => "text",
        }
    }

    pub(crate) fn code(self) -> u8 {
        match self {
            Self::Idle => Self::IDLE,
            Self::Loop => Self::LOOP,
            Self::Interactive => Self::INTERACTIVE,
            Self::Mate => Self::MATE,
            Self::Text => Self::TEXT,
        }
    }

    pub(crate) fn from_code(code: u8) -> Self {
        match code {
            Self::IDLE => Self::Idle,
            Self::LOOP => Self::Loop,
            Self::INTERACTIVE => Self::Interactive,
            Self::MATE => Self::Mate,
            Self::TEXT => Self::Text,
            _ => Self::Loop,
        }
    }
}

#[derive(Debug, Clone)]
pub struct RuntimeState {
    pub layout_id: String,
    pub led_count: u16,
    pub mode: String,
    pub fps_rx: Option<f64>,
    pub esp_frames_complete: Option<u32>,
    pub esp_rssi: Option<i8>,
    pub esp_drops: Option<u16>,
    pub esp_status_addr: Option<String>,
    pub output_target_addr: Option<String>,
    pub layout_mismatch: bool,
    pub esp_layout_hash: Option<u32>,
    pub loop_clip_id: Option<String>,
    pub started_at: Instant,
}

impl RuntimeState {
    pub fn new(layout_id: String, led_count: u16, mode: String) -> Self {
        Self {
            layout_id,
            led_count,
            mode,
            fps_rx: None,
            esp_frames_complete: None,
            esp_rssi: None,
            esp_drops: None,
            esp_status_addr: None,
            output_target_addr: None,
            layout_mismatch: false,
            esp_layout_hash: None,
            loop_clip_id: None,
            started_at: Instant::now(),
        }
    }

    pub fn uptime_sec(&self) -> u64 {
        self.started_at.elapsed().as_secs()
    }
}

/// Loop シーケンスのタイムライン。`skew` は再生開始時刻の基準（巻き直しやクリップ切替で
/// 現在の raw に合わせ、`clip_elapsed = raw - skew` を 0 から進める）。一時停止で
/// `frozen_effective` を固定し、再開で `skew` を補正する。
#[derive(Debug, Clone, Copy, Default)]
pub struct LoopPlaybackTiming {
    pub paused: bool,
    pub skew: Duration,
    pub frozen_effective: Duration,
}

/// `POST /api/v1/media/upload` で保存したファイルと変換ジョブの状態。
#[derive(Debug, Clone)]
pub struct MediaUploadEntry {
    pub source_path: std::path::PathBuf,
    pub phase: MediaUploadPhase,
}

#[derive(Debug, Clone)]
pub enum MediaUploadPhase {
    Stored,
    Converting {
        job_id: String,
        progress: std::sync::Arc<std::sync::atomic::AtomicU8>,
    },
    Done {
        job_id: String,
        clip_id: String,
    },
    Failed {
        job_id: Option<String>,
        message: String,
    },
}

/// `POST /api/v1/clips/create` の非同期変換ジョブ。
#[derive(Debug, Clone)]
pub enum ClipJobPhase {
    Running {
        progress: std::sync::Arc<std::sync::atomic::AtomicU8>,
    },
    Done {
        clip_id: String,
    },
    Failed {
        message: String,
    },
}

pub struct SharedApp {
    registry: StdRwLock<DeviceRegistry>,
    slots: StdRwLock<HashMap<String, Arc<DeviceSlot>>>,
    device_order: StdRwLock<Vec<String>>,
    pub default_device_id: String,
    pub default_mode: String,
    pub compiled_dir: std::path::PathBuf,
    pub repo_root: std::path::PathBuf,
    pub clips_dir: std::path::PathBuf,
    pub sources_dir: std::path::PathBuf,
    pub uploads_dir: std::path::PathBuf,
    pub media_uploads: RwLock<HashMap<String, MediaUploadEntry>>,
    pub clip_jobs: RwLock<HashMap<String, ClipJobPhase>>,
    pub mate_presets: StdRwLock<crate::mate::PresetRegistry>,
    /// text モードのグリフラスタライズに使うフォント。読み込み失敗時は `None`（背景色のみ描画）。
    pub text_font: Option<Arc<fontdue::Font>>,
}

pub type SharedState = Arc<SharedApp>;

#[allow(clippy::too_many_arguments)]
pub fn new_shared(
    registry: DeviceRegistry,
    default_mode: &str,
    repo_root: std::path::PathBuf,
    compiled_dir: std::path::PathBuf,
    clips_dir: std::path::PathBuf,
    sources_dir: std::path::PathBuf,
    uploads_dir: std::path::PathBuf,
    mate_assets_dir: std::path::PathBuf,
    text_font: Option<Arc<fontdue::Font>>,
) -> anyhow::Result<SharedState> {
    let default_device_id = registry
        .devices()
        .first()
        .map(|d| d.id.clone())
        .unwrap_or_else(|| "default".into());
    let mut slot_map = HashMap::new();
    let mut order = Vec::new();
    for rec in registry.devices() {
        let slot = DeviceSlot::from_record(rec.clone(), default_mode, &compiled_dir)?;
        order.push(rec.id.clone());
        slot_map.insert(rec.id.clone(), slot);
    }
    let mate_presets =
        crate::mate::PresetRegistry::load(&mate_assets_dir).context("mate presets")?;
    Ok(Arc::new(SharedApp {
        registry: StdRwLock::new(registry),
        slots: StdRwLock::new(slot_map),
        device_order: StdRwLock::new(order),
        default_device_id,
        default_mode: default_mode.to_string(),
        repo_root,
        compiled_dir,
        clips_dir,
        sources_dir,
        uploads_dir,
        media_uploads: RwLock::new(HashMap::new()),
        clip_jobs: RwLock::new(HashMap::new()),
        mate_presets: StdRwLock::new(mate_presets),
        text_font,
    }))
}

impl SharedApp {
    pub fn resolve_device_id(&self, id: Option<&str>) -> Result<String, String> {
        if let Some(id) = id.filter(|s| !s.is_empty()) {
            let slots = self
                .slots
                .read()
                .map_err(|_| "slots lock poisoned".to_string())?;
            if slots.contains_key(id) {
                return Ok(id.to_string());
            }
            return Err(format!("unknown deviceId: {id}"));
        }
        Ok(self.default_device_id.clone())
    }

    pub fn device(&self, device_id: &str) -> Result<Arc<DeviceSlot>, String> {
        self.slots
            .read()
            .map_err(|_| "slots lock poisoned".to_string())?
            .get(device_id)
            .cloned()
            .ok_or_else(|| format!("unknown device: {device_id}"))
    }

    pub fn devices_ordered(&self) -> Vec<Arc<DeviceSlot>> {
        let order = self
            .device_order
            .read()
            .ok()
            .map(|o| o.clone())
            .unwrap_or_default();
        let slots = self.slots.read().ok();
        order
            .into_iter()
            .filter_map(|id| slots.as_ref().and_then(|m| m.get(&id).cloned()))
            .collect()
    }

    pub fn registry_snapshot(&self) -> Result<DeviceRegistry, String> {
        self.registry
            .read()
            .map_err(|_| "registry lock poisoned".to_string())
            .map(|g| g.clone())
    }

    pub fn with_registry_mut<F, T>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce(&mut DeviceRegistry) -> Result<T, anyhow::Error>,
    {
        let mut g = self
            .registry
            .write()
            .map_err(|_| "registry lock poisoned".to_string())?;
        f(&mut g).map_err(|e| e.to_string())
    }

    pub fn upsert_device_slot(&self, rec: DeviceRecord, default_mode: &str) -> Result<(), String> {
        let slot = DeviceSlot::from_record(rec.clone(), default_mode, &self.compiled_dir)
            .map_err(|e| e.to_string())?;
        let mut slots = self
            .slots
            .write()
            .map_err(|_| "slots lock poisoned".to_string())?;
        let mut order = self
            .device_order
            .write()
            .map_err(|_| "slots lock poisoned".to_string())?;
        if !order.iter().any(|id| id == &rec.id) {
            order.push(rec.id.clone());
        }
        slots.insert(rec.id.clone(), slot);
        Ok(())
    }

    pub fn remove_device_slot(&self, id: &str) -> Result<(), String> {
        let mut slots = self
            .slots
            .write()
            .map_err(|_| "slots lock poisoned".to_string())?;
        let mut order = self
            .device_order
            .write()
            .map_err(|_| "slots lock poisoned".to_string())?;
        if !slots.contains_key(id) {
            return Err(format!("unknown device: {id}"));
        }
        slots.remove(id);
        order.retain(|x| x != id);
        if self.default_device_id == id {
            if let Some(next) = order.first() {
                // default_device_id is not interior-mutable; caller must handle via new_shared on restart
                tracing::warn!("removed default device {id}; restart recommended (next: {next})");
            }
        }
        Ok(())
    }

    pub fn find_device_by_status_ip(&self, ip: &str) -> Option<Arc<DeviceSlot>> {
        for slot in self.devices_ordered() {
            let rec = slot.record_snapshot();
            if rec.esp_ip_host() == Some(ip) {
                return Some(slot);
            }
        }
        for slot in self.devices_ordered() {
            let matched = {
                let Ok(st) = slot.state.try_read() else {
                    continue;
                };
                st.output_target_addr.as_deref().map(extract_ip).as_deref() == Some(ip)
                    || st.esp_status_addr.as_deref().map(extract_ip).as_deref() == Some(ip)
            };
            if matched {
                return Some(slot);
            }
        }
        None
    }
    pub fn refresh_expected_layout_hash(&self, layout_id: &str) {
        let hash = layouts::read_layout_hash(&self.compiled_dir, layout_id);
        for slot in self.devices_ordered() {
            let matches = slot
                .state
                .try_read()
                .map(|s| s.layout_id == layout_id)
                .unwrap_or(false);
            if matches {
                slot.set_expected_layout_hash(hash);
            }
        }
    }
}

fn extract_ip(addr: &str) -> String {
    addr.split(':').next().unwrap_or(addr).to_string()
}
