use std::sync::atomic::{AtomicU32, AtomicU8, Ordering};
use std::sync::Arc;
use std::sync::RwLock as StdRwLock;
use std::time::{Duration, Instant};

use tokio::sync::RwLock;

use crate::media::{self, LoadedSequence};
use crate::metrics::OutputMetrics;

/// インタラクティブ（消灯＋ WS 合成）で選べるエフェクト種別。
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InteractiveEffectKind {
    /// 球面上ガウス（従来のソフト・リップル）。
    SphereGaussian = 0,
    /// タップ中心から大円角距離で等方に拡大する波面と残光トレイル。
    ExpandingRingDiagonal = 1,
}

impl InteractiveEffectKind {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "sphereGaussian" | "sphere_gaussian" => Some(Self::SphereGaussian),
            "expandingRingDiagonal" | "expanding_ring_diagonal" => Some(Self::ExpandingRingDiagonal),
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
}

impl OutputMode {
    const IDLE: u8 = 0;
    const LOOP: u8 = 1;
    const INTERACTIVE: u8 = 2;

    pub fn parse(id: &str) -> Option<Self> {
        match id {
            "idle" => Some(Self::Idle),
            "loop" => Some(Self::Loop),
            "interactive" | "ripple" => Some(Self::Interactive),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Loop => "loop",
            Self::Interactive => "interactive",
        }
    }

    fn code(self) -> u8 {
        match self {
            Self::Idle => Self::IDLE,
            Self::Loop => Self::LOOP,
            Self::Interactive => Self::INTERACTIVE,
        }
    }

    fn from_code(code: u8) -> Self {
        match code {
            Self::IDLE => Self::Idle,
            Self::LOOP => Self::Loop,
            Self::INTERACTIVE => Self::Interactive,
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
    /// `assets/compiled/<layout>.ledmap.json` 由来。インタラクティブ合成用（LED インデックス順）。
    pub(crate) interactive_uv: StdRwLock<Option<Vec<(f32, f32)>>>,
    pub(crate) interactive_pulses: StdRwLock<Vec<InteractivePulse>>,
    /// WS `setEffect` またはパルス省略時に使う既定エフェクト。
    interactive_default_effect: AtomicU8,
    /// 全モード共通: 最終 RGB に掛ける明るさ（0–2、1 が既定）。
    master_brightness_bits: AtomicU32,
    /// 全モード共通: ガンマ（0.5–3.5、1 が線形に近い）。
    master_gamma_bits: AtomicU32,
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
        interactive_uv: StdRwLock::new(None),
        interactive_pulses: StdRwLock::new(Vec::new()),
        interactive_default_effect: AtomicU8::new(InteractiveEffectKind::SphereGaussian.code()),
        master_brightness_bits: AtomicU32::new(f32::to_bits(1.0)),
        master_gamma_bits: AtomicU32::new(f32::to_bits(1.0)),
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

    pub fn interactive_default_effect(&self) -> InteractiveEffectKind {
        InteractiveEffectKind::from_code(self.interactive_default_effect.load(Ordering::Relaxed))
    }

    pub fn set_interactive_default_effect(&self, e: InteractiveEffectKind) {
        self.interactive_default_effect
            .store(e.code(), Ordering::Relaxed);
    }

    /// インタラクティブ用 UV テーブルを読み込む（同一 `layout_id` / LED 数なら再読み込みしない）。
    pub fn ensure_interactive_uv(&self, layout_id: &str, led_count: usize) -> anyhow::Result<()> {
        if let Ok(guard) = self.interactive_uv.read() {
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
            .interactive_uv
            .write()
            .map_err(|e| anyhow::anyhow!("interactive_uv lock poisoned: {e}"))?;
        *slot = Some(table);
        Ok(())
    }

    pub fn master_brightness(&self) -> f32 {
        f32::from_bits(self.master_brightness_bits.load(Ordering::Relaxed))
    }

    pub fn master_gamma(&self) -> f32 {
        f32::from_bits(self.master_gamma_bits.load(Ordering::Relaxed))
    }

    pub fn set_master_tone(&self, brightness: f32, gamma: f32) {
        let b = brightness.clamp(0.0, 2.0);
        let g = gamma.clamp(0.45, 3.5);
        self.master_brightness_bits
            .store(f32::to_bits(b), Ordering::Relaxed);
        self.master_gamma_bits
            .store(f32::to_bits(g), Ordering::Relaxed);
    }

    pub fn push_interactive_pulse(&self, pulse: InteractivePulse) {
        let Ok(mut g) = self.interactive_pulses.write() else {
            return;
        };
        g.push(pulse);
        while g.len() > MAX_INTERACTIVE_PULSES {
            g.remove(0);
        }
    }

    pub fn clear_expired_interactive_pulses(&self) {
        let Ok(mut g) = self.interactive_pulses.write() else {
            return;
        };
        let now = Instant::now();
        g.retain(|p| now < p.started + p.duration);
    }
}
