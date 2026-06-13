use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::{routing::get, Json, Router};
use serde::Serialize;

use crate::state::SharedState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StateResponse {
    layout_id: String,
    mode: String,
    fps_out: f64,
    fps_rx: Option<f64>,
    esp_rssi: Option<i8>,
    esp_drops: Option<u16>,
    led_count: u16,
    loop_sequence_id: Option<String>,
    uptime_sec: u64,
    frame_loop_stale_ms: u64,
    layout_mismatch: bool,
    frames_sent: u64,
}

pub fn router(app: SharedState) -> Router {
    let app_health = app.clone();
    Router::new()
        .route(
            "/api/v1/state",
            get({
                let app = app.clone();
                move || get_state(app.clone())
            }),
        )
        .route(
            "/health",
            get({
                let app = app_health.clone();
                move || health(app.clone())
            }),
        )
}

async fn get_state(app: SharedState) -> Json<StateResponse> {
    let s = app.state.read().await;
    Json(StateResponse {
        layout_id: s.layout_id.clone(),
        mode: s.mode.clone(),
        fps_out: app.metrics.fps_out(),
        fps_rx: s.fps_rx,
        esp_rssi: s.esp_rssi,
        esp_drops: s.esp_drops,
        led_count: s.led_count,
        loop_sequence_id: None,
        uptime_sec: s.uptime_sec(),
        frame_loop_stale_ms: app.metrics.frame_loop_stale_ms(),
        layout_mismatch: s.layout_mismatch,
        frames_sent: app.metrics.frames_sent(),
    })
}

async fn health(app: SharedState) -> impl IntoResponse {
    const STALE_MS: u64 = 1000;
    if app.metrics.frame_loop_stale_ms() > STALE_MS {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "stale: output loop tick too old",
        )
            .into_response()
    } else {
        (StatusCode::OK, "ok").into_response()
    }
}
