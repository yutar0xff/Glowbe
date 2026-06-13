use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Hot-path metrics (no `await` in the frame loop).
pub struct OutputMetrics {
    frames_sent: AtomicU64,
    fps_out_bits: AtomicU64,
    last_tick_wall_ms: AtomicU64,
}

fn wall_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

impl OutputMetrics {
    pub fn new() -> Self {
        let now = wall_ms();
        Self {
            frames_sent: AtomicU64::new(0),
            fps_out_bits: AtomicU64::new(f64::to_bits(0.0)),
            last_tick_wall_ms: AtomicU64::new(now),
        }
    }

    #[inline]
    pub fn mark_tick(&self) {
        self.last_tick_wall_ms.store(wall_ms(), Ordering::Relaxed);
    }

    #[inline]
    pub fn increment_frames_sent(&self) {
        self.frames_sent.fetch_add(1, Ordering::Relaxed);
    }

    #[inline]
    pub fn set_fps_out(&self, fps: f64) {
        self.fps_out_bits.store(fps.to_bits(), Ordering::Relaxed);
    }

    pub fn frames_sent(&self) -> u64 {
        self.frames_sent.load(Ordering::Relaxed)
    }

    pub fn fps_out(&self) -> f64 {
        f64::from_bits(self.fps_out_bits.load(Ordering::Relaxed))
    }

    /// Milliseconds since the last output-loop tick (wall clock).
    pub fn frame_loop_stale_ms(&self) -> u64 {
        let now = wall_ms();
        let last = self.last_tick_wall_ms.load(Ordering::Relaxed);
        now.saturating_sub(last)
    }
}
