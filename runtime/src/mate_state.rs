//! Per-device mate mode runtime state (expression, animation, face samples).

use std::sync::RwLock as StdRwLock;
use std::time::{Duration, Instant};

use anyhow::Context;

use crate::mate::{
    self, BlinkState, BreathingParams, Expression, FaceFrame, FaceFrameParams, MateSamplesCache,
    MateTransition, PresetRegistry,
};

pub struct MateRuntimeState {
    frame_params: StdRwLock<FaceFrameParams>,
    samples_cache: StdRwLock<Option<MateSamplesCache>>,
    expression: StdRwLock<Option<Expression>>,
    preset_id: StdRwLock<Option<String>>,
    transition: StdRwLock<Option<MateTransition>>,
    transition_rotate: StdRwLock<bool>,
    breathing: StdRwLock<BreathingParams>,
    breath_clock: StdRwLock<BreathClock>,
    blink: StdRwLock<BlinkState>,
    anim_origin: Instant,
}

/// 呼吸位相を毎フレーム積分するための状態。周期が表情遷移中に変化しても、
/// 位相を連続に進めることで scale/上下位置が飛ぶ (バウンドする) のを防ぐ。
struct BreathClock {
    phase: f32,
    last: Instant,
}

impl MateRuntimeState {
    pub fn new(anim_origin: Instant) -> Self {
        Self {
            frame_params: StdRwLock::new(FaceFrameParams::default()),
            samples_cache: StdRwLock::new(None),
            expression: StdRwLock::new(None),
            preset_id: StdRwLock::new(None),
            transition: StdRwLock::new(None),
            transition_rotate: StdRwLock::new(false),
            breathing: StdRwLock::new(BreathingParams::default()),
            breath_clock: StdRwLock::new(BreathClock {
                phase: 0.0,
                last: anim_origin,
            }),
            blink: StdRwLock::new(BlinkState::new(anim_origin)),
            anim_origin,
        }
    }

    pub fn clear_samples_cache(&self) {
        if let Ok(mut g) = self.samples_cache.write() {
            *g = None;
        }
    }

    pub fn preset_id(&self) -> Option<String> {
        self.preset_id.read().ok().and_then(|g| g.clone())
    }

    pub fn breathing_params(&self) -> BreathingParams {
        self.breathing.read().ok().map(|g| *g).unwrap_or_default()
    }

    pub fn set_breathing(&self, params: BreathingParams) {
        if let Ok(mut g) = self.breathing.write() {
            *g = params;
        }
    }

    pub fn transition_rotate(&self) -> bool {
        self.transition_rotate.read().map(|g| *g).unwrap_or(false)
    }

    pub fn set_transition_rotate(&self, rotate: bool) {
        if let Ok(mut g) = self.transition_rotate.write() {
            *g = rotate;
        }
    }

    pub fn trigger_blink(&self) {
        let now = Instant::now();
        if let Ok(mut g) = self.blink.write() {
            g.trigger(now);
        }
    }

    pub fn ensure_samples(
        &self,
        compiled_dir: &std::path::Path,
        layout_id: &str,
        front_yaw_deg: f32,
    ) -> anyhow::Result<()> {
        if !mate::layout_supported(layout_id) {
            anyhow::bail!("mate mode is not supported for layout {layout_id}");
        }
        let frame_params = *self
            .frame_params
            .read()
            .map_err(|e| anyhow::anyhow!("mate_frame_params lock: {e}"))?;
        let frame = FaceFrame::from_params(frame_params);
        let frame_key = frame.cache_key();
        let front_yaw_bits = f32::to_bits(front_yaw_deg);
        if let Ok(cache) = self.samples_cache.read() {
            if let Some(c) = cache.as_ref() {
                if c.layout_id == layout_id
                    && c.frame_key == frame_key
                    && c.front_yaw_bits == front_yaw_bits
                {
                    return Ok(());
                }
            }
        }
        let uv = mate::load_layout_uv_table(compiled_dir, layout_id)?;
        let samples = mate::build_face_samples_yawed(&uv, &frame, front_yaw_deg);
        let mut cache = self
            .samples_cache
            .write()
            .map_err(|e| anyhow::anyhow!("mate_samples_cache lock: {e}"))?;
        *cache = Some(MateSamplesCache {
            layout_id: layout_id.to_string(),
            frame_key,
            front_yaw_bits,
            front_yaw_deg,
            frame,
            uv,
            samples,
        });
        Ok(())
    }

    pub fn set_expression(
        &self,
        preset_id: &str,
        registry: &PresetRegistry,
        transition_ms: u32,
    ) -> anyhow::Result<()> {
        let to = registry
            .get(preset_id)
            .cloned()
            .with_context(|| format!("unknown mate preset: {preset_id}"))?;
        let now = Instant::now();
        if transition_ms == 0 {
            if let Ok(mut g) = self.transition.write() {
                *g = None;
            }
        } else {
            let from = self.expression_at(now);
            let duration = Duration::from_millis(transition_ms as u64);
            let rotate = self.transition_rotate();
            if let Ok(mut g) = self.transition.write() {
                *g = Some(MateTransition {
                    from,
                    to: to.clone(),
                    started: now,
                    duration,
                    rotate,
                });
            }
        }
        if let Ok(mut g) = self.expression.write() {
            *g = Some(to);
        }
        if let Ok(mut g) = self.preset_id.write() {
            *g = Some(preset_id.to_string());
        }
        Ok(())
    }

    pub fn ensure_default_expression(&self, registry: &PresetRegistry) -> anyhow::Result<()> {
        if self
            .expression
            .read()
            .ok()
            .and_then(|g| g.clone())
            .is_some()
        {
            return Ok(());
        }
        self.set_expression(mate::DEFAULT_PRESET_ID, registry, 0)
    }

    pub fn render(&self, rgb: &mut [u8]) {
        let cache = match self.samples_cache.read() {
            Ok(g) => g,
            Err(_) => {
                rgb.fill(0);
                return;
            }
        };
        let Some(cache) = cache.as_ref() else {
            rgb.fill(0);
            return;
        };
        let now = Instant::now();
        let expr = self.expression_at(now);
        let yaw_deg = self
            .transition
            .read()
            .ok()
            .and_then(|g| g.as_ref().map(|t| t.yaw_deg_at(now)))
            .unwrap_or(0.0);
        if let Ok(mut tr) = self.transition.write() {
            if let Some(ref transition) = *tr {
                if transition.is_complete(now) {
                    *tr = None;
                }
            }
        }
        let breathing = self.breathing_params();
        let breath_phase =
            self.advance_breath_phase(now, expr.breathing_period_ms, breathing.enabled);
        let mut blink_guard = match self.blink.write() {
            Ok(g) => g,
            Err(_) => {
                rgb.fill(0);
                return;
            }
        };
        let mods = mate::compute_modulation(
            now,
            self.anim_origin,
            &breathing,
            breath_phase,
            &mut blink_guard,
        );
        drop(blink_guard);
        let rotated;
        let samples: &[mate::FaceSample] = if yaw_deg.abs() > 1e-3 {
            rotated = mate::build_face_samples_yawed(
                &cache.uv,
                &cache.frame,
                cache.front_yaw_deg + yaw_deg,
            );
            &rotated
        } else {
            &cache.samples
        };
        mate::render(samples, &cache.frame, &expr, &mods, rgb);
    }

    /// 呼吸位相を経過時間ぶんだけ積分して返す。周期は瞬時値として使うため、
    /// 表情遷移で周期が補間されても位相は連続に進む。長いギャップ (モード切替など)
    /// で一気に飛ばないよう dt は上限を設ける。
    fn advance_breath_phase(&self, now: Instant, period_ms: u32, enabled: bool) -> f32 {
        let Ok(mut clock) = self.breath_clock.write() else {
            return 0.0;
        };
        let dt = now
            .saturating_duration_since(clock.last)
            .as_secs_f32()
            .min(0.1);
        clock.last = now;
        if enabled && period_ms > 0 {
            let period = period_ms as f32 / 1000.0;
            clock.phase += dt * std::f32::consts::TAU / period;
            clock.phase = clock.phase.rem_euclid(std::f32::consts::TAU);
        }
        clock.phase
    }

    fn expression_at(&self, now: Instant) -> Expression {
        if let Ok(guard) = self.transition.read() {
            if let Some(ref tr) = *guard {
                if !tr.is_complete(now) {
                    return tr.expr_at(now);
                }
            }
        }
        self.expression
            .read()
            .ok()
            .and_then(|g| g.clone())
            .unwrap_or(Expression {
                background: [0, 0, 0],
                parts: Vec::new(),
                breathing_period_ms: mate::DEFAULT_BREATH_PERIOD_MS,
            })
    }
}
