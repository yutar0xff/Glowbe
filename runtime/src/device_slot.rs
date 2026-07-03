//! 1 台の ESP に対応するランタイム状態スロット。

use std::sync::atomic::{AtomicU32, AtomicU8, Ordering};
use std::sync::Arc;
use std::sync::RwLock as StdRwLock;
use std::time::{Duration, Instant};

use anyhow::Context;
use tokio::sync::RwLock;

use crate::clip::LoadedClip;
use crate::devices::DeviceRecord;
use crate::mate::{self, BreathingParams};
use crate::mate_state::MateRuntimeState;
use crate::media;
use crate::metrics::OutputMetrics;
use crate::state::{
    InteractiveEffectKind, InteractivePulse, LoopPlaybackTiming, OutputMode, RuntimeState,
    MAX_INTERACTIVE_PULSES,
};
use crate::text_state::{TextParams, TextRuntimeState};

pub struct DeviceSlot {
    pub record: StdRwLock<DeviceRecord>,
    pub metrics: Arc<OutputMetrics>,
    pub state: RwLock<RuntimeState>,
    mode_code: AtomicU8,
    clip: StdRwLock<Option<Arc<LoadedClip>>>,
    pub expected_layout_hash: StdRwLock<Option<u32>>,
    pub(crate) layout_uv: StdRwLock<Option<Vec<(f32, f32)>>>,
    pub(crate) layout_uv_layout_id: StdRwLock<Option<String>>,
    layout_uv_yaw_bits: AtomicU32,
    pub(crate) interactive_pulses: StdRwLock<Vec<InteractivePulse>>,
    pub(crate) interactive_solid: StdRwLock<Option<[u8; 3]>>,
    interactive_default_effect: AtomicU8,
    master_brightness_bits: AtomicU32,
    master_gamma_bits: AtomicU32,
    pub(crate) preview_frame: StdRwLock<Vec<u8>>,
    pub(crate) preview_seq: AtomicU32,
    output_send_epoch: AtomicU32,
    pub(crate) loop_raw_elapsed_tick: StdRwLock<Duration>,
    pub(crate) loop_playback_timing: StdRwLock<LoopPlaybackTiming>,
    mate: MateRuntimeState,
    text: TextRuntimeState,
}

impl DeviceSlot {
    pub fn from_record(
        record: DeviceRecord,
        default_mode: &str,
        compiled_dir: &std::path::Path,
    ) -> anyhow::Result<Arc<Self>> {
        let meta_path = compiled_dir.join(format!("{}.meta.json", record.layout_id));
        let meta_raw = std::fs::read_to_string(&meta_path)
            .with_context(|| format!("read {}", meta_path.display()))?;
        let meta: serde_json::Value = serde_json::from_str(&meta_raw).context("parse meta")?;
        let led_count = meta["ledCount"].as_u64().context("ledCount")? as u16;
        let expected_layout_hash = meta
            .get("layoutHash")
            .and_then(|v| v.as_u64())
            .map(|x| x as u32);
        let initial_mode = OutputMode::parse(default_mode).unwrap_or(OutputMode::Idle);
        let preview_len = led_count as usize * 3;
        let layout_id = record.layout_id.clone();
        let display = if record.display_name.is_empty() {
            record.id.clone()
        } else {
            record.display_name.clone()
        };
        let brightness = crate::master_tone::clamp_brightness_f32(record.master_brightness as f32);
        let gamma = crate::master_tone::clamp_gamma_f32(record.master_gamma as f32);
        let anim_origin = Instant::now();
        Ok(Arc::new(Self {
            record: StdRwLock::new(DeviceRecord {
                display_name: display,
                ..record
            }),
            metrics: Arc::new(OutputMetrics::new()),
            state: RwLock::new(RuntimeState::new(
                layout_id,
                led_count,
                initial_mode.as_str().to_string(),
            )),
            mode_code: AtomicU8::new(initial_mode.code()),
            clip: StdRwLock::new(None),
            expected_layout_hash: StdRwLock::new(expected_layout_hash),
            layout_uv: StdRwLock::new(None),
            layout_uv_layout_id: StdRwLock::new(None),
            layout_uv_yaw_bits: AtomicU32::new(f32::to_bits(f32::NAN)),
            interactive_pulses: StdRwLock::new(Vec::new()),
            interactive_solid: StdRwLock::new(None),
            interactive_default_effect: AtomicU8::new(
                InteractiveEffectKind::ExpandingRingDiagonal.code(),
            ),
            master_brightness_bits: AtomicU32::new(f32::to_bits(brightness)),
            master_gamma_bits: AtomicU32::new(f32::to_bits(gamma)),
            preview_frame: StdRwLock::new(vec![0u8; preview_len]),
            preview_seq: AtomicU32::new(0),
            output_send_epoch: AtomicU32::new(0),
            loop_raw_elapsed_tick: StdRwLock::new(Duration::ZERO),
            loop_playback_timing: StdRwLock::new(LoopPlaybackTiming::default()),
            mate: MateRuntimeState::new(anim_origin),
            text: TextRuntimeState::new(),
        }))
    }

    pub fn id(&self) -> String {
        self.record
            .read()
            .ok()
            .map(|r| r.id.clone())
            .unwrap_or_default()
    }

    pub fn record_snapshot(&self) -> DeviceRecord {
        self.record
            .read()
            .map(|r| r.clone())
            .unwrap_or_else(|e| e.into_inner().clone())
    }

    pub fn update_record(&self, rec: DeviceRecord) {
        self.set_master_tone(rec.master_brightness as f32, rec.master_gamma as f32);
        if let Ok(mut g) = self.record.write() {
            *g = rec;
        }
    }

    pub fn output_send_epoch(&self) -> u32 {
        self.output_send_epoch.load(Ordering::Acquire)
    }

    pub fn bump_output_send_epoch(&self) {
        self.output_send_epoch.fetch_add(1, Ordering::Release);
    }

    pub fn output_mode(&self) -> OutputMode {
        OutputMode::from_code(self.mode_code.load(Ordering::Relaxed))
    }

    pub async fn set_output_mode(&self, mode: OutputMode) {
        self.reset_loop_playback_timing();
        let prev = self.output_mode();
        self.mode_code.store(mode.code(), Ordering::Relaxed);
        // text へ切り替わったら必ず先頭の文字から表示し直す。
        if mode == OutputMode::Text && prev != OutputMode::Text {
            self.text.restart(Instant::now());
        }
        self.bump_output_send_epoch();
        let mut state = self.state.write().await;
        state.mode = mode.as_str().to_string();
    }

    pub fn selected_clip(&self) -> Option<Arc<LoadedClip>> {
        self.clip.read().ok().and_then(|guard| guard.clone())
    }

    pub async fn set_clip(&self, clip: LoadedClip) {
        let id = clip.id.clone();
        if let Ok(mut slot) = self.clip.write() {
            *slot = Some(Arc::new(clip));
        }
        self.bump_output_send_epoch();
        let mut state = self.state.write().await;
        state.loop_clip_id = Some(id);
    }

    pub async fn clear_clip(&self) {
        if let Ok(mut slot) = self.clip.write() {
            *slot = None;
        }
        self.bump_output_send_epoch();
        let mut state = self.state.write().await;
        state.loop_clip_id = None;
        self.reset_loop_playback_timing();
    }

    /// ループ再生のタイムラインを現在時点から巻き直す。以降 `clip_elapsed_for_loop`
    /// は 0 から進むため、クリップ選択やモード切替のたびにクリップは先頭から再生される。
    pub fn reset_loop_playback_timing(&self) {
        let raw = self
            .loop_raw_elapsed_tick
            .read()
            .map(|r| *r)
            .unwrap_or_else(|e| *e.into_inner());
        if let Ok(mut g) = self.loop_playback_timing.write() {
            *g = LoopPlaybackTiming {
                paused: false,
                skew: raw,
                frozen_effective: Duration::ZERO,
            };
        }
    }

    pub fn record_loop_raw_tick(&self, raw: Duration) {
        if let Ok(mut w) = self.loop_raw_elapsed_tick.write() {
            *w = raw;
        }
    }

    pub fn clip_elapsed_for_loop(&self, raw: Duration) -> Duration {
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

    /// ESP STATUS の `frames_complete` に合わせた送信 `frame_id` 起点。
    pub fn wire_frame_id_from_status(esp_frames_complete: Option<u32>) -> u32 {
        esp_frames_complete.map(|n| n.wrapping_add(1)).unwrap_or(0)
    }

    pub async fn apply_status(&self, from: String, st: &crate::wire::Status, mismatch: bool) {
        let mut s = self.state.write().await;
        s.fps_rx = Some(st.fps_rx());
        s.esp_frames_complete = Some(st.frames_complete);
        s.esp_rssi = Some(st.rssi);
        s.esp_drops = Some(st.drops);
        s.esp_status_addr = Some(from);
        s.layout_mismatch = mismatch;
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

    /// デバイス正面の yaw（度）。`0` が既定の正面。
    pub fn front_yaw_deg(&self) -> f32 {
        self.record
            .read()
            .map(|r| r.front_yaw_deg as f32)
            .unwrap_or(0.0)
    }

    /// レイアウト UV テーブル（正面 yaw 適用済み）。全モードの色生成が共有する。
    pub fn ensure_layout_uv(
        &self,
        compiled_dir: &std::path::Path,
        layout_id: &str,
        led_count: usize,
    ) -> anyhow::Result<()> {
        let front_yaw = self.front_yaw_deg();
        let yaw_bits = f32::to_bits(front_yaw);
        if let (Ok(uv_g), Ok(id_g)) = (self.layout_uv.read(), self.layout_uv_layout_id.read()) {
            if let (Some(v), Some(id)) = (uv_g.as_ref(), id_g.as_deref()) {
                if id == layout_id
                    && v.len() == led_count
                    && self.layout_uv_yaw_bits.load(Ordering::Relaxed) == yaw_bits
                {
                    return Ok(());
                }
            }
        }
        let layout = media::load_layout_uv(compiled_dir, layout_id)?;
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
                table[p.i] = (crate::sphere::apply_front_yaw_u(p.u, front_yaw), p.v);
            }
        }
        let mut slot = self
            .layout_uv
            .write()
            .map_err(|e| anyhow::anyhow!("layout_uv lock: {e}"))?;
        *slot = Some(table);
        let mut id_slot = self
            .layout_uv_layout_id
            .write()
            .map_err(|e| anyhow::anyhow!("layout_uv_layout_id lock: {e}"))?;
        *id_slot = Some(layout_id.to_string());
        self.layout_uv_yaw_bits.store(yaw_bits, Ordering::Relaxed);
        Ok(())
    }

    pub fn layout_uv_table(&self) -> Option<Vec<(f32, f32)>> {
        self.layout_uv.read().ok().and_then(|g| g.clone())
    }

    pub fn ensure_interactive_uv(
        &self,
        compiled_dir: &std::path::Path,
        layout_id: &str,
        led_count: usize,
    ) -> anyhow::Result<()> {
        self.ensure_layout_uv(compiled_dir, layout_id, led_count)
    }

    pub fn master_brightness(&self) -> f32 {
        f32::from_bits(self.master_brightness_bits.load(Ordering::Relaxed))
    }

    pub fn master_gamma(&self) -> f32 {
        f32::from_bits(self.master_gamma_bits.load(Ordering::Relaxed))
    }

    pub fn set_master_tone(&self, brightness: f32, gamma: f32) {
        let b = crate::master_tone::clamp_brightness_f32(brightness);
        let g = crate::master_tone::clamp_gamma_f32(gamma);
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

    pub async fn switch_layout(
        &self,
        compiled_dir: &std::path::Path,
        new_layout_id: String,
    ) -> anyhow::Result<()> {
        if new_layout_id.is_empty() || new_layout_id.contains('/') || new_layout_id.contains('\\') {
            anyhow::bail!("layout id must be non-empty and must not contain path separators");
        }
        let meta_path = compiled_dir.join(format!("{}.meta.json", new_layout_id));
        let meta_raw = std::fs::read_to_string(&meta_path)
            .with_context(|| format!("read layout meta {}", meta_path.display()))?;
        let meta: serde_json::Value =
            serde_json::from_str(&meta_raw).context("parse layout meta json")?;
        let led_count = meta["ledCount"].as_u64().context("ledCount in meta")? as u16;
        let expected_layout_hash = meta
            .get("layoutHash")
            .and_then(|v| v.as_u64())
            .map(|x| x as u32);

        if let Ok(mut w) = self.preview_frame.write() {
            *w = vec![0u8; led_count as usize * 3];
        }
        self.preview_seq.store(0, Ordering::Relaxed);

        if let Ok(mut g) = self.layout_uv.write() {
            *g = None;
        }
        if let Ok(mut g) = self.layout_uv_layout_id.write() {
            *g = None;
        }
        if let Ok(mut g) = self.interactive_solid.write() {
            *g = None;
        }
        self.mate.clear_samples_cache();
        self.text.clear_samples();
        if let Ok(mut g) = self.expected_layout_hash.write() {
            *g = expected_layout_hash;
        }

        let mut st = self.state.write().await;
        st.layout_id = new_layout_id;
        st.led_count = led_count;
        st.layout_mismatch = false;
        if let Ok(mut rec) = self.record.write() {
            rec.layout_id = st.layout_id.clone();
        }
        self.bump_output_send_epoch();
        Ok(())
    }

    pub fn mate_preset_id(&self) -> Option<String> {
        self.mate.preset_id()
    }

    pub fn ensure_mate_samples(
        &self,
        compiled_dir: &std::path::Path,
        layout_id: &str,
    ) -> anyhow::Result<()> {
        self.mate
            .ensure_samples(compiled_dir, layout_id, self.front_yaw_deg())
    }

    pub fn set_mate_expression(
        &self,
        preset_id: &str,
        registry: &mate::PresetRegistry,
        transition_ms: u32,
    ) -> anyhow::Result<()> {
        self.mate.set_expression(preset_id, registry, transition_ms)
    }

    pub fn mate_breathing_params(&self) -> BreathingParams {
        self.mate.breathing_params()
    }

    pub fn set_mate_breathing(&self, params: BreathingParams) {
        self.mate.set_breathing(params);
        self.bump_output_send_epoch();
    }

    pub fn mate_transition_rotate(&self) -> bool {
        self.mate.transition_rotate()
    }

    pub fn set_mate_transition_rotate(&self, rotate: bool) {
        self.mate.set_transition_rotate(rotate);
        self.bump_output_send_epoch();
    }

    pub fn trigger_mate_blink(&self) {
        self.mate.trigger_blink();
        self.bump_output_send_epoch();
    }

    pub fn ensure_mate_default(&self, registry: &mate::PresetRegistry) -> anyhow::Result<()> {
        self.mate.ensure_default_expression(registry)
    }

    pub fn render_mate(&self, rgb: &mut [u8]) {
        self.mate.render(rgb);
    }

    pub fn text_params(&self) -> TextParams {
        self.text.params()
    }

    pub fn set_text_params(&self, params: TextParams) {
        self.text.set_params(params);
        self.bump_output_send_epoch();
    }

    pub fn render_text(
        &self,
        font: Option<&fontdue::Font>,
        layout_id: &str,
        layout_uv: &[(f32, f32)],
        now: Instant,
        rgb: &mut [u8],
    ) {
        self.text
            .render(font, layout_uv, layout_id, self.front_yaw_deg(), now, rgb);
    }
}
