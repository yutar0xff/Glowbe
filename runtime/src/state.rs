use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;
use std::sync::RwLock as StdRwLock;
use std::time::Instant;

use tokio::sync::RwLock;

use crate::media::LoadedSequence;
use crate::metrics::OutputMetrics;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputMode {
    Idle,
    Loop,
}

impl OutputMode {
    const IDLE: u8 = 0;
    const LOOP: u8 = 1;

    pub fn parse(id: &str) -> Option<Self> {
        match id {
            "idle" => Some(Self::Idle),
            "loop" => Some(Self::Loop),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Loop => "loop",
        }
    }

    fn code(self) -> u8 {
        match self {
            Self::Idle => Self::IDLE,
            Self::Loop => Self::LOOP,
        }
    }

    fn from_code(code: u8) -> Self {
        match code {
            Self::IDLE => Self::Idle,
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
    pub esp_rssi: Option<i8>,
    pub esp_drops: Option<u16>,
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
            esp_rssi: None,
            esp_drops: None,
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
    pub sequences_dir: std::path::PathBuf,
}

pub type SharedState = Arc<SharedApp>;

pub fn new_shared(
    layout_id: String,
    led_count: u16,
    mode: String,
    expected_layout_hash: Option<u32>,
    sequences_dir: std::path::PathBuf,
) -> SharedState {
    let initial_mode = OutputMode::parse(&mode).unwrap_or(OutputMode::Loop);
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
        sequences_dir,
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
}
