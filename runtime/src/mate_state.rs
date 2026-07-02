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
    breathing: StdRwLock<BreathingParams>,
    blink: StdRwLock<BlinkState>,
    anim_origin: Instant,
}

impl MateRuntimeState {
    pub fn new(anim_origin: Instant) -> Self {
        Self {
            frame_params: StdRwLock::new(FaceFrameParams::default()),
            samples_cache: StdRwLock::new(None),
            expression: StdRwLock::new(None),
            preset_id: StdRwLock::new(None),
            transition: StdRwLock::new(None),
            breathing: StdRwLock::new(BreathingParams::default()),
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
        let samples = mate::load_face_samples(compiled_dir, layout_id, &frame, front_yaw_deg)?;
        let mut cache = self
            .samples_cache
            .write()
            .map_err(|e| anyhow::anyhow!("mate_samples_cache lock: {e}"))?;
        *cache = Some(MateSamplesCache {
            layout_id: layout_id.to_string(),
            frame_key,
            front_yaw_bits,
            frame,
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
            if let Ok(mut g) = self.transition.write() {
                *g = Some(MateTransition {
                    from,
                    to: to.clone(),
                    started: now,
                    duration,
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

    pub fn ensure_neutral(&self, registry: &PresetRegistry) -> anyhow::Result<()> {
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
        if let Ok(mut tr) = self.transition.write() {
            if let Some(ref transition) = *tr {
                if transition.is_complete(now) {
                    *tr = None;
                }
            }
        }
        let breathing = self.breathing_params();
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
            expr.breathing_period_ms,
            &mut blink_guard,
        );
        drop(blink_guard);
        mate::render(&cache.samples, &cache.frame, &expr, &mods, rgb);
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
