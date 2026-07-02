//! Shared helpers for mate HTTP and WebSocket handlers.

use std::path::Path;

use axum::http::StatusCode;
use axum::Json;

use crate::api::ErrorResponse;
use crate::device_slot::DeviceSlot;
use crate::mate::{self, PresetRegistry};
use crate::state::SharedState;

pub fn unsupported_layout_response(layout_id: &str) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse {
            error: format!("mate mode is not supported for layout {layout_id}"),
        }),
    )
}

pub fn read_mate_registry<'a>(
    app: &'a SharedState,
) -> Result<std::sync::RwLockReadGuard<'a, PresetRegistry>, (StatusCode, Json<ErrorResponse>)> {
    app.mate_presets.read().map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "mate presets lock poisoned".into(),
            }),
        )
    })
}

pub fn apply_mate_expression(
    slot: &DeviceSlot,
    registry: &PresetRegistry,
    compiled_dir: &Path,
    layout_id: &str,
    preset_id: &str,
    transition_ms: u32,
) -> Result<(), String> {
    slot.set_mate_expression(preset_id, registry, transition_ms)
        .map_err(|e| format!("{e:#}"))?;
    slot.ensure_mate_samples(compiled_dir, layout_id)
        .map_err(|e| format!("{e:#}"))?;
    Ok(())
}

pub fn guard_mate_layout(layout_id: &str) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
    if mate::layout_supported(layout_id) {
        Ok(())
    } else {
        Err(unsupported_layout_response(layout_id))
    }
}
