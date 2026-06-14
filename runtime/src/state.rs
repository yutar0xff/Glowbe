use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;
use std::sync::RwLock as StdRwLock;
use std::time::{Duration, Instant};

use tokio::sync::RwLock;
use tokio::sync::broadcast;

use crate::media::{self, LoadedSequence};
use crate::metrics::OutputMetrics;

/// WebSocket プレビュー用 JPEG（`Arc` で broadcast 共有）。
#[derive(Debug, Clone)]
pub struct PreviewFrame {
    pub seq: u64,
    pub jpeg: Vec<u8>,
}

/// UV 空間のクリック位置からの波紋（出力ループが `rgb` に合成する）。
#[derive(Debug, Clone, Copy)]
pub struct RipplePulse {
    pub center_u: f32,
    pub center_v: f32,
    pub amplitude: f32,
    pub started: Instant,
    pub duration: Duration,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputMode {
    /// 黒フレームのみ（WS の ripple は合成しない）。
    Idle,
    /// シーケンスまたはテストパターン。
    Loop,
    /// 消灯ベース。WebSocket の `ripple` だけが UDP フレームに載る。
    Ripple,
}

impl OutputMode {
    const IDLE: u8 = 0;
    const LOOP: u8 = 1;
    const RIPPLE: u8 = 2;

    pub fn parse(id: &str) -> Option<Self> {
        match id {
            "idle" => Some(Self::Idle),
            "loop" => Some(Self::Loop),
            "ripple" => Some(Self::Ripple),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Loop => "loop",
            Self::Ripple => "ripple",
        }
    }

    fn code(self) -> u8 {
        match self {
            Self::Idle => Self::IDLE,
            Self::Loop => Self::LOOP,
            Self::Ripple => Self::RIPPLE,
        }
    }

    fn from_code(code: u8) -> Self {
        match code {
            Self::IDLE => Self::Idle,
            Self::LOOP => Self::Loop,
            Self::RIPPLE => Self::Ripple,
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
    pub loop_sequence_id: Option<String>,
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
            loop_sequence_id: None,
            started_at: Instant::now(),
        }
    }

    pub fn uptime_sec(&self) -> u64 {
        self.started_at.elapsed().as_secs()
    }
}

/// Shared application state: hot metrics + async-safe `RwLock` for ESP-derived fields.
pub struct SharedApp {
    pub metrics: Arc<OutputMetrics>,
    pub state: RwLock<RuntimeState>,
    mode_code: AtomicU8,
    sequence: StdRwLock<Option<Arc<LoadedSequence>>>,
    /// From `assets/compiled/<id>.meta.json` at startup; compared with ESP STATUS extension.
    pub expected_layout_hash: Option<u32>,
    pub compiled_dir: std::path::PathBuf,
    pub sequences_dir: std::path::PathBuf,
    /// `assets/compiled/<layout>.ledmap.json` 由来。ripple 合成用（LED インデックス順）。
    pub(crate) ripple_uv: StdRwLock<Option<Vec<(f32, f32)>>>,
    pub(crate) ripple_pulse: StdRwLock<Option<RipplePulse>>,
    pub preview_tx: broadcast::Sender<Arc<PreviewFrame>>,
    preview_quality: AtomicU8,
}

pub type SharedState = Arc<SharedApp>;

pub fn new_shared(
    layout_id: String,
    led_count: u16,
    mode: String,
    expected_layout_hash: Option<u32>,
    compiled_dir: std::path::PathBuf,
    sequences_dir: std::path::PathBuf,
) -> SharedState {
    let initial_mode = OutputMode::parse(&mode).unwrap_or(OutputMode::Loop);
    let (preview_tx, _) = broadcast::channel::<Arc<PreviewFrame>>(8);
    Arc::new(SharedApp {
        metrics: Arc::new(OutputMetrics::new()),
        state: RwLock::new(RuntimeState::new(
            layout_id,
            led_count,
            initial_mode.as_str().to_string(),
        )),
        mode_code: AtomicU8::new(initial_mode.code()),
        sequence: StdRwLock::new(None),
        expected_layout_hash,
        compiled_dir,
        sequences_dir,
        ripple_uv: StdRwLock::new(None),
        ripple_pulse: StdRwLock::new(None),
        preview_tx,
        preview_quality: AtomicU8::new(75),
    })
}

impl SharedApp {
    pub fn output_mode(&self) -> OutputMode {
        OutputMode::from_code(self.mode_code.load(Ordering::Relaxed))
    }

    pub async fn set_output_mode(&self, mode: OutputMode) {
        self.mode_code.store(mode.code(), Ordering::Relaxed);
        let mut state = self.state.write().await;
        state.mode = mode.as_str().to_string();
    }

    pub fn selected_sequence(&self) -> Option<Arc<LoadedSequence>> {
        self.sequence.read().ok().and_then(|guard| guard.clone())
    }

    pub async fn set_sequence(&self, sequence: LoadedSequence) {
        let id = sequence.id.clone();
        if let Ok(mut slot) = self.sequence.write() {
            *slot = Some(Arc::new(sequence));
        }
        let mut state = self.state.write().await;
        state.loop_sequence_id = Some(id);
    }

    pub async fn clear_sequence(&self) {
        if let Ok(mut slot) = self.sequence.write() {
            *slot = None;
        }
        let mut state = self.state.write().await;
        state.loop_sequence_id = None;
    }

    pub async fn set_output_target_addr(&self, addr: String) {
        let mut state = self.state.write().await;
        state.output_target_addr = Some(addr);
    }

    /// ripple 用 UV テーブルを読み込む（同一 `layout_id` / LED 数なら再読み込みしない）。
    pub fn ensure_ripple_uv(&self, layout_id: &str, led_count: usize) -> anyhow::Result<()> {
        if let Ok(guard) = self.ripple_uv.read() {
            if let Some(v) = guard.as_ref() {
                if v.len() == led_count {
                    return Ok(());
                }
            }
        }
        let layout = media::load_layout_uv(&self.compiled_dir, layout_id)?;
        if layout.led_count != led_count {
            anyhow::bail!(
                "ledmap ledCount {} != runtime {}",
                layout.led_count,
                led_count
            );
        }
        let mut table = vec![(0.5f32, 0.5f32); led_count];
        for p in layout.leds {
            if p.i < table.len() {
                table[p.i] = (p.u, p.v);
            }
        }
        let mut slot = self
            .ripple_uv
            .write()
            .map_err(|e| anyhow::anyhow!("ripple_uv lock poisoned: {e}"))?;
        *slot = Some(table);
        Ok(())
    }

    pub fn set_preview_quality(&self, q: u8) {
        self.preview_quality.store(q.clamp(1, 95), Ordering::Relaxed);
    }

    pub fn preview_quality(&self) -> u8 {
        self.preview_quality.load(Ordering::Relaxed)
    }

    pub fn set_ripple_pulse(&self, center_u: f32, center_v: f32, amplitude: f32) {
        let pulse = RipplePulse {
            center_u,
            center_v,
            amplitude,
            started: Instant::now(),
            duration: Duration::from_millis(450),
        };
        if let Ok(mut g) = self.ripple_pulse.write() {
            *g = Some(pulse);
        }
    }

    pub fn clear_expired_ripple(&self) {
        let Ok(mut g) = self.ripple_pulse.write() else {
            return;
        };
        if let Some(p) = g.as_ref() {
            if Instant::now() >= p.started + p.duration {
                *g = None;
            }
        }
    }
}
