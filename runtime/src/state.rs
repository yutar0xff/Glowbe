use std::sync::Arc;
use std::time::Instant;

use tokio::sync::RwLock;

#[derive(Debug, Clone)]
pub struct RuntimeState {
    pub layout_id: String,
    pub led_count: u16,
    pub mode: String,
    pub frames_sent: u64,
    pub fps_out: f64,
    pub fps_rx: Option<f64>,
    pub esp_rssi: Option<i8>,
    pub esp_drops: Option<u16>,
    pub started_at: Instant,
}

impl RuntimeState {
    pub fn new(layout_id: String, led_count: u16, mode: String) -> Self {
        Self {
            layout_id,
            led_count,
            mode,
            frames_sent: 0,
            fps_out: 0.0,
            fps_rx: None,
            esp_rssi: None,
            esp_drops: None,
            started_at: Instant::now(),
        }
    }

    pub fn uptime_sec(&self) -> u64 {
        self.started_at.elapsed().as_secs()
    }
}

pub type SharedState = Arc<RwLock<RuntimeState>>;

pub fn new_shared(layout_id: String, led_count: u16, mode: String) -> SharedState {
    Arc::new(RwLock::new(RuntimeState::new(layout_id, led_count, mode)))
}
