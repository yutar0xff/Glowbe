//! PipeWire-backed audio input and visualizer rendering.

mod analyze;
mod capture;
mod engine;
mod render;
mod types;

pub use engine::AudioEngine;
pub use render::{render_visualizer, RenderInput, VisualizerSceneState};
pub use types::{
    AudioInputDevice, AudioPlatformInfo, AudioVisualizerPalette, AudioVisualizerParams,
    AudioVisualizerPattern, AudioVisualizerSnapshot,
};
/// Re-exported for API clients matching on `AudioInputDevice.kind`.
#[allow(unused_imports)]
pub use types::AudioInputKind;
