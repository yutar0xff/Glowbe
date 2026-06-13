use std::sync::Arc;
use std::time::Instant;

use tokio::sync::RwLock;

use crate::metrics::OutputMetrics;

#[derive(Debug, Clone)]
pub struct RuntimeState {
    pub layout_id: String,
    pub led_count: u16,
    pub mode: String,
    pub fps_rx: Option<f64>,
    pub esp_rssi: Option<i8>,
    pub esp_drops: Option<u16>,
    pub layout_mismatch: bool,
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
    /// From `assets/compiled/<id>.meta.json` at startup; compared with ESP STATUS extension.
    pub expected_layout_hash: Option<u32>,
}

pub type SharedState = Arc<SharedApp>;

pub fn new_shared(
    layout_id: String,
    led_count: u16,
    mode: String,
    expected_layout_hash: Option<u32>,
) -> SharedState {
    Arc::new(SharedApp {
        metrics: Arc::new(OutputMetrics::new()),
        state: RwLock::new(RuntimeState::new(layout_id, led_count, mode)),
        expected_layout_hash,
    })
}
