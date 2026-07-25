//! Shared audio engine: capture + browser ingest + analysis + snapshot for visualizers.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::analyze::{AnalysisFrame, Analyzer};
use super::capture::{self, CaptureHandle};
use super::types::{
    AudioInputDevice, AudioInputKind, AudioPlatformInfo, AudioVisualizerParams,
    AudioVisualizerSnapshot, BAND_COUNT, FFT_SIZE, RING_CAPACITY,
};

struct SharedRing {
    samples: VecDeque<f32>,
}

impl SharedRing {
    fn new() -> Self {
        Self {
            samples: VecDeque::with_capacity(RING_CAPACITY),
        }
    }

    fn clear(&mut self) {
        self.samples.clear();
    }

    fn push(&mut self, chunk: &[f32]) {
        for &s in chunk {
            if self.samples.len() >= RING_CAPACITY {
                self.samples.pop_front();
            }
            self.samples.push_back(s);
        }
    }

    fn copy_latest(&self, out: &mut [f32]) -> usize {
        let n = out.len().min(self.samples.len());
        if n == 0 {
            out.fill(0.0);
            return 0;
        }
        let start = self.samples.len() - n;
        let pad = out.len() - n;
        for i in 0..n {
            out[pad + i] = self.samples[start + i];
        }
        out[..pad].fill(0.0);
        n
    }
}

struct EngineInner {
    platform: AudioPlatformInfo,
    selected: Option<AudioInputDevice>,
    /// PipeWire input to restore when browser ingest ends.
    saved_pipewire: Option<AudioInputDevice>,
    capture: Option<CaptureHandle>,
    ingest_active: bool,
    ring: Arc<Mutex<SharedRing>>,
    analyzer: Analyzer,
    last_frame: AnalysisFrame,
    last_error: Option<String>,
    last_analyze: Instant,
}

pub struct AudioEngine {
    inner: Mutex<EngineInner>,
}

impl AudioEngine {
    pub fn new() -> Arc<Self> {
        let platform = capture::platform_info();
        Arc::new(Self {
            inner: Mutex::new(EngineInner {
                platform,
                selected: None,
                saved_pipewire: None,
                capture: None,
                ingest_active: false,
                ring: Arc::new(Mutex::new(SharedRing::new())),
                analyzer: Analyzer::new(),
                last_frame: AnalysisFrame::default(),
                last_error: None,
                last_analyze: Instant::now() - Duration::from_secs(1),
            }),
        })
    }

    pub fn platform(&self) -> AudioPlatformInfo {
        self.inner
            .lock()
            .map(|g| g.platform.clone())
            .unwrap_or_else(|_| capture::platform_info())
    }

    pub fn list_inputs(&self) -> Result<Vec<AudioInputDevice>, String> {
        capture::list_input_devices()
    }

    pub fn selected_input(&self) -> Option<AudioInputDevice> {
        self.inner.lock().ok().and_then(|g| {
            if g.ingest_active {
                None
            } else {
                g.selected.clone()
            }
        })
    }

    #[cfg(test)]
    pub fn ingest_active(&self) -> bool {
        self.inner
            .lock()
            .map(|g| g.ingest_active)
            .unwrap_or(false)
    }

    fn clear_ring_and_analyzer(g: &mut EngineInner) {
        if let Ok(mut ring) = g.ring.lock() {
            ring.clear();
        }
        g.analyzer.clear_smooth();
    }

    /// Stop PipeWire capture and accept browser PCM until `end_ingest`.
    pub fn begin_ingest(&self) -> Result<(), String> {
        let mut g = self
            .inner
            .lock()
            .map_err(|_| "audio engine lock poisoned".to_string())?;
        if g.ingest_active {
            return Ok(());
        }
        if let Some(h) = g.capture.take() {
            h.stop();
        }
        if g.selected.is_some() {
            g.saved_pipewire = g.selected.take();
        }
        Self::clear_ring_and_analyzer(&mut g);
        g.ingest_active = true;
        g.selected = Some(AudioInputDevice {
            id: "browser-ingest".into(),
            name: "Browser audio".into(),
            kind: AudioInputKind::Monitor,
        });
        g.last_error = None;
        Ok(())
    }

    pub fn push_ingest_samples(&self, samples: &[f32]) {
        let Ok(g) = self.inner.lock() else {
            return;
        };
        if !g.ingest_active {
            return;
        }
        let ring = Arc::clone(&g.ring);
        drop(g);
        let locked = ring.lock();
        if let Ok(mut guard) = locked {
            guard.push(samples);
        }
    }

    /// End browser ingest and optionally restore the previous PipeWire input.
    pub fn end_ingest(&self) {
        let restore_id = {
            let Ok(mut g) = self.inner.lock() else {
                return;
            };
            if !g.ingest_active {
                return;
            }
            g.ingest_active = false;
            g.selected = None;
            Self::clear_ring_and_analyzer(&mut g);
            g.saved_pipewire.take().map(|d| d.id)
        };
        if let Some(id) = restore_id {
            let _ = self.select_input(Some(&id));
        }
    }

    pub fn select_input(&self, id: Option<&str>) -> Result<Option<AudioInputDevice>, String> {
        let mut g = self
            .inner
            .lock()
            .map_err(|_| "audio engine lock poisoned".to_string())?;
        if g.ingest_active {
            return Err(
                "browser audio ingest is active; stop it before selecting a host input".into(),
            );
        }
        if let Some(h) = g.capture.take() {
            h.stop();
        }
        Self::clear_ring_and_analyzer(&mut g);
        g.last_frame = AnalysisFrame::default();

        let Some(id) = id.filter(|s| !s.is_empty()) else {
            g.selected = None;
            g.saved_pipewire = None;
            g.last_error = None;
            return Ok(None);
        };

        if !g.platform.available {
            let msg = g
                .platform
                .reason
                .clone()
                .unwrap_or_else(|| "audio unavailable".into());
            g.last_error = Some(msg.clone());
            return Err(msg);
        }

        let devices = capture::list_input_devices()?;
        let device = devices
            .into_iter()
            .find(|d| d.id == id)
            .ok_or_else(|| format!("unknown audio input: {id}"))?;

        let ring = Arc::clone(&g.ring);
        match capture::start_capture(&device.id, move |samples| {
            if let Ok(mut r) = ring.lock() {
                r.push(samples);
            }
        }) {
            Ok(handle) => {
                g.capture = Some(handle);
                g.selected = Some(device.clone());
                g.last_error = None;
                Ok(Some(device))
            }
            Err(e) => {
                g.selected = None;
                g.last_error = Some(e.clone());
                Err(e)
            }
        }
    }

    pub fn tick_analyze(&self, attack: f32, release: f32) {
        let Ok(mut g) = self.inner.lock() else {
            return;
        };
        if g.last_analyze.elapsed() < Duration::from_millis(15) {
            return;
        }
        g.last_analyze = Instant::now();

        let mut buf = vec![0.0f32; FFT_SIZE];
        let n = if let Ok(ring) = g.ring.lock() {
            ring.copy_latest(&mut buf)
        } else {
            0
        };
        if n < FFT_SIZE / 4 {
            // Hold the last frame — injecting silence collapses AGC peak and mutes
            // the display after brief ingest/WS underruns while music is still playing.
            return;
        }
        let frame = g.analyzer.process(&buf, attack, release);
        g.last_frame = frame;
    }

    pub fn snapshot(&self, params: &AudioVisualizerParams) -> AudioVisualizerSnapshot {
        self.tick_analyze(params.attack, params.release);
        let Ok(g) = self.inner.lock() else {
            return AudioVisualizerSnapshot::idle(params, Some("audio lock poisoned".into()));
        };
        let connected = g.ingest_active || (g.capture.is_some() && g.selected.is_some());
        let (input_id, input_name, input_kind) = match &g.selected {
            Some(d) => (Some(d.id.clone()), Some(d.name.clone()), Some(d.kind)),
            None => (None, None, None),
        };
        AudioVisualizerSnapshot {
            connected,
            input_id,
            input_name,
            input_kind,
            rms: g.last_frame.rms,
            peak: g.last_frame.peak,
            bass: g.last_frame.bass,
            beat: g.last_frame.beat,
            low: g.last_frame.low,
            mid: g.last_frame.mid,
            high: g.last_frame.high,
            centroid: g.last_frame.centroid,
            flux: g.last_frame.flux,
            onset: g.last_frame.onset,
            bands: g.analyzer.bands().to_vec(),
            pattern: params.pattern.as_str().to_string(),
            palette: params.palette.as_str().to_string(),
            intensity: params.intensity,
            motion: params.motion,
            persistence: params.persistence,
            gamma: params.gamma,
            attack: params.attack,
            release: params.release,
            error: g.last_error.clone(),
        }
    }

    pub fn analysis_levels(&self) -> (AnalysisFrame, Vec<f32>) {
        let Ok(g) = self.inner.lock() else {
            return (AnalysisFrame::default(), vec![0.0; BAND_COUNT]);
        };
        (g.last_frame, g.analyzer.bands().to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::types::AudioVisualizerPattern;

    #[test]
    fn snapshot_without_input_is_disconnected() {
        let eng = AudioEngine::new();
        let params = AudioVisualizerParams {
            pattern: AudioVisualizerPattern::ImpactConstellation,
            ..Default::default()
        };
        let snap = eng.snapshot(&params);
        assert!(!snap.connected);
        assert_eq!(snap.pattern, "impact-constellation");
        assert_eq!(snap.palette, "rainbow");
        assert_eq!(snap.bands.len(), BAND_COUNT);
    }

    #[test]
    fn ingest_marks_connected_and_accepts_samples() {
        let eng = AudioEngine::new();
        eng.begin_ingest().unwrap();
        assert!(eng.ingest_active());
        eng.push_ingest_samples(&[0.1, -0.1, 0.2, -0.2]);
        let params = AudioVisualizerParams::default();
        let snap = eng.snapshot(&params);
        assert!(snap.connected);
        assert_eq!(snap.input_id.as_deref(), Some("browser-ingest"));
        eng.end_ingest();
        assert!(!eng.ingest_active());
    }
}
