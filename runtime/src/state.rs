use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, AtomicU8, Ordering};
use std::sync::Arc;
use std::sync::RwLock as StdRwLock;
use std::time::{Duration, Instant};

use anyhow::Context;
use tokio::sync::RwLock;

use crate::mate::{self, MateState};
use crate::media::{self, LoadedSequence};
use crate::metrics::OutputMetrics;

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
    /// 相棒（球面顔・手続き描画）。
    Mate,
}

impl OutputMode {
    const IDLE: u8 = 0;
    const LOOP: u8 = 1;
    const INTERACTIVE: u8 = 2;
    const MATE: u8 = 3;

    pub fn parse(id: &str) -> Option<Self> {
        match id {
            "idle" => Some(Self::Idle),
            "loop" => Some(Self::Loop),
            "interactive" => Some(Self::Interactive),
            "mate" => Some(Self::Mate),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Loop => "loop",
            Self::Interactive => "interactive",
            Self::Mate => "mate",
        }
    }

    fn code(self) -> u8 {
        match self {
            Self::Idle => Self::IDLE,
            Self::Loop => Self::LOOP,
            Self::Interactive => Self::INTERACTIVE,
            Self::Mate => Self::MATE,
        }
    }

    fn from_code(code: u8) -> Self {
        match code {
            Self::IDLE => Self::Idle,
            Self::LOOP => Self::Loop,
            Self::INTERACTIVE => Self::Interactive,
            Self::MATE => Self::Mate,
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
        sequence_id: String,
    },
    Failed {
        job_id: Option<String>,
        message: String,
    },
}

/// Shared application state: hot metrics + async-safe `RwLock` for ESP-derived fields.
pub struct SharedApp {
    pub metrics: Arc<OutputMetrics>,
    pub state: RwLock<RuntimeState>,
    mode_code: AtomicU8,
    sequence: StdRwLock<Option<Arc<LoadedSequence>>>,
    /// Compared with ESP STATUS `layout_hash`; updated when the active compiled layout changes.
    pub expected_layout_hash: StdRwLock<Option<u32>>,
    pub compiled_dir: std::path::PathBuf,
    pub sequences_dir: std::path::PathBuf,
    pub uploads_dir: std::path::PathBuf,
    pub media_uploads: RwLock<HashMap<String, MediaUploadEntry>>,
    /// `assets/compiled/<layout>.ledmap.json` 由来。インタラクティブ合成用（LED インデックス順）。
    pub(crate) interactive_uv: StdRwLock<Option<Vec<(f32, f32)>>>,
    /// Matches `interactive_uv` when populated; cleared on layout switch.
    pub(crate) interactive_uv_layout_id: StdRwLock<Option<String>>,
    pub(crate) interactive_pulses: StdRwLock<Vec<InteractivePulse>>,
    /// `interactive` モードのベース色。`None` のときは黒。
    pub(crate) interactive_solid: StdRwLock<Option<[u8; 3]>>,
    pub(crate) mate_state: StdRwLock<MateState>,
    /// WS `setEffect` またはパルス省略時に使う既定エフェクト。
    interactive_default_effect: AtomicU8,
    /// 全モード共通: 最終 RGB に掛ける明るさ（0–2、1 が既定）。
    master_brightness_bits: AtomicU32,
    /// 全モード共通: ガンマ（0.5–3.5、1 が線形に近い）。
    master_gamma_bits: AtomicU32,
    /// UDP 直前と同一の最終 RGB（`led_count * 3`）。`try_write` で出力ループから更新。
    pub(crate) preview_frame: StdRwLock<Vec<u8>>,
    /// `preview_frame` が更新されるたびに増分（WebSocket プレビュー用）。
    pub(crate) preview_seq: AtomicU32,
    /// UDP 静止スキップのキャッシュ無効化（モード変更など）。
    output_send_epoch: AtomicU32,
    /// 出力ループが毎フレーム書き込む `loop_start` からの経過（一時停止 API が参照）。
    pub(crate) loop_raw_elapsed_tick: StdRwLock<Duration>,
    pub(crate) loop_playback_timing: StdRwLock<LoopPlaybackTiming>,
}

/// Loop シーケンスのタイムライン（一時停止で `frozen_effective` を固定、再開で `skew` を補正）。
#[derive(Debug, Clone, Copy, Default)]
pub struct LoopPlaybackTiming {
    pub paused: bool,
    pub skew: Duration,
    pub frozen_effective: Duration,
}

pub type SharedState = Arc<SharedApp>;

pub fn new_shared(
    layout_id: String,
    led_count: u16,
    mode: String,
    expected_layout_hash: Option<u32>,
    compiled_dir: std::path::PathBuf,
    sequences_dir: std::path::PathBuf,
    uploads_dir: std::path::PathBuf,
) -> SharedState {
    let initial_mode = OutputMode::parse(&mode).unwrap_or(OutputMode::Loop);
    let preview_len = led_count as usize * 3;
    Arc::new(SharedApp {
        metrics: Arc::new(OutputMetrics::new()),
        state: RwLock::new(RuntimeState::new(
            layout_id,
            led_count,
            initial_mode.as_str().to_string(),
        )),
        mode_code: AtomicU8::new(initial_mode.code()),
        sequence: StdRwLock::new(None),
        expected_layout_hash: StdRwLock::new(expected_layout_hash),
        compiled_dir,
        sequences_dir,
        uploads_dir,
        media_uploads: RwLock::new(HashMap::new()),
        interactive_uv: StdRwLock::new(None),
        interactive_uv_layout_id: StdRwLock::new(None),
        interactive_pulses: StdRwLock::new(Vec::new()),
        interactive_solid: StdRwLock::new(None),
        mate_state: StdRwLock::new(MateState::default()),
        interactive_default_effect: AtomicU8::new(InteractiveEffectKind::ExpandingRingDiagonal.code()),
        master_brightness_bits: AtomicU32::new(f32::to_bits(1.0)),
        master_gamma_bits: AtomicU32::new(f32::to_bits(1.0)),
        preview_frame: StdRwLock::new(vec![0u8; preview_len]),
        preview_seq: AtomicU32::new(0),
        output_send_epoch: AtomicU32::new(0),
        loop_raw_elapsed_tick: StdRwLock::new(Duration::ZERO),
        loop_playback_timing: StdRwLock::new(LoopPlaybackTiming::default()),
    })
}

impl SharedApp {
    pub fn output_send_epoch(&self) -> u32 {
        self.output_send_epoch.load(Ordering::Acquire)
    }

    pub fn bump_output_send_epoch(&self) {
        self.output_send_epoch.fetch_add(1, Ordering::Release);
    }

    /// Switch the active compiled layout (UV, LED count, hash). Clears loop selection if the
    /// loaded sequence does not match the new layout. Does not persist `config.toml`.
    pub async fn switch_runtime_layout(&self, new_layout_id: String) -> anyhow::Result<()> {
        if new_layout_id.is_empty()
            || new_layout_id.contains('/')
            || new_layout_id.contains('\\')
        {
            anyhow::bail!("layout id must be non-empty and must not contain path separators");
        }
        let meta_path = self
            .compiled_dir
            .join(format!("{}.meta.json", new_layout_id));
        let meta_raw = std::fs::read_to_string(&meta_path)
            .with_context(|| format!("read layout meta {}", meta_path.display()))?;
        let meta: serde_json::Value =
            serde_json::from_str(&meta_raw).context("parse layout meta json")?;
        let led_count = meta["ledCount"].as_u64().context("ledCount in meta")? as u16;
        let expected_layout_hash = meta
            .get("layoutHash")
            .and_then(|v| v.as_u64())
            .map(|x| x as u32);

        if let Some(seq) = self.selected_sequence() {
            if seq.layout_id != new_layout_id || seq.led_count != led_count as usize {
                self.clear_sequence().await;
            }
        }

        if let Ok(mut w) = self.preview_frame.write() {
            *w = vec![0u8; led_count as usize * 3];
        }
        self.preview_seq.store(0, Ordering::Relaxed);

        if let Ok(mut g) = self.interactive_uv.write() {
            *g = None;
        }
        if let Ok(mut g) = self.interactive_uv_layout_id.write() {
            *g = None;
        }
        if let Ok(mut g) = self.interactive_solid.write() {
            *g = None;
        }

        if let Ok(mut g) = self.expected_layout_hash.write() {
            *g = expected_layout_hash;
        }

        let mut st = self.state.write().await;
        st.layout_id = new_layout_id;
        st.led_count = led_count;
        st.layout_mismatch = false;
        self.bump_output_send_epoch();
        Ok(())
    }

    pub fn output_mode(&self) -> OutputMode {
        OutputMode::from_code(self.mode_code.load(Ordering::Relaxed))
    }

    pub async fn set_output_mode(&self, mode: OutputMode) {
        self.reset_loop_playback_timing();
        self.mode_code.store(mode.code(), Ordering::Relaxed);
        self.bump_output_send_epoch();
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
        self.bump_output_send_epoch();
        let mut state = self.state.write().await;
        state.loop_sequence_id = Some(id);
    }

    pub async fn clear_sequence(&self) {
        if let Ok(mut slot) = self.sequence.write() {
            *slot = None;
        }
        self.bump_output_send_epoch();
        let mut state = self.state.write().await;
        state.loop_sequence_id = None;
        self.reset_loop_playback_timing();
    }

    pub fn reset_loop_playback_timing(&self) {
        if let Ok(mut g) = self.loop_playback_timing.write() {
            *g = LoopPlaybackTiming::default();
        }
    }

    pub fn record_loop_raw_tick(&self, raw: Duration) {
        if let Ok(mut w) = self.loop_raw_elapsed_tick.write() {
            *w = raw;
        }
    }

    pub fn sequence_elapsed_for_loop(&self, raw: Duration) -> Duration {
        let Ok(g) = self.loop_playback_timing.read() else {
            return raw;
        };
        if g.paused {
            g.frozen_effective
        } else {
            raw.saturating_sub(g.skew)
        }
    }

    pub fn pause_loop_playback(&self) {
        let raw = self
            .loop_raw_elapsed_tick
            .read()
            .map(|r| *r)
            .unwrap_or_else(|e| *e.into_inner());
        if let Ok(mut g) = self.loop_playback_timing.write() {
            let eff = raw.saturating_sub(g.skew);
            g.frozen_effective = eff;
            g.paused = true;
        }
    }

    pub fn resume_loop_playback(&self) {
        let raw = self
            .loop_raw_elapsed_tick
            .read()
            .map(|r| *r)
            .unwrap_or_else(|e| *e.into_inner());
        if let Ok(mut g) = self.loop_playback_timing.write() {
            if !g.paused {
                return;
            }
            g.skew = raw.saturating_sub(g.frozen_effective);
            g.paused = false;
        }
    }

    pub fn loop_playback_paused(&self) -> bool {
        self.loop_playback_timing
            .read()
            .ok()
            .map(|g| g.paused)
            .unwrap_or(false)
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

    pub fn set_interactive_solid_rgb(&self, rgb: Option<[u8; 3]>) {
        if let Ok(mut g) = self.interactive_solid.write() {
            *g = rgb;
        }
        self.bump_output_send_epoch();
    }

    /// `interactive` のベース（`None` は全 LED 0）。
    pub fn fill_interactive_base(&self, rgb: &mut [u8]) {
        let solid = self.interactive_solid.read().ok().and_then(|g| *g);
        if let Some([r, g_ch, b]) = solid {
            for px in rgb.chunks_exact_mut(3) {
                px[0] = r;
                px[1] = g_ch;
                px[2] = b;
            }
        } else {
            rgb.fill(0);
        }
    }

    /// インタラクティブ用 UV テーブルを読み込む（同一 `layout_id` / LED 数なら再読み込みしない）。
    pub fn ensure_interactive_uv(&self, layout_id: &str, led_count: usize) -> anyhow::Result<()> {
        if let (Ok(uv_g), Ok(id_g)) = (
            self.interactive_uv.read(),
            self.interactive_uv_layout_id.read(),
        ) {
            if let (Some(v), Some(id)) = (uv_g.as_ref(), id_g.as_deref()) {
                if id == layout_id && v.len() == led_count {
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
        let mut id_slot = self
            .interactive_uv_layout_id
            .write()
            .map_err(|e| anyhow::anyhow!("interactive_uv_layout_id lock poisoned: {e}"))?;
        *id_slot = Some(layout_id.to_string());
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
        self.bump_output_send_epoch();
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

    pub fn mate_apply_json(&self, v: &serde_json::Value) -> Result<(), String> {
        let mut g = self
            .mate_state
            .write()
            .map_err(|_| "mate_state lock poisoned".to_string())?;
        g.apply_json_patch(v)
    }

    pub fn mate_summary(&self) -> mate::MateSummary {
        self.mate_state
            .read()
            .ok()
            .map(|g| g.summary())
            .unwrap_or_else(|| MateState::default().summary())
    }
}
