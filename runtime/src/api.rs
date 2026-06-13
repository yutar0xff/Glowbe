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
}

pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/api/v1/state", get({
            let state = state.clone();
            move || get_state(state.clone())
        }))
        .route("/health", get(|| async { "ok" }))
}

async fn get_state(state: SharedState) -> Json<StateResponse> {
    let s = state.read().await;
    Json(StateResponse {
        layout_id: s.layout_id.clone(),
        mode: s.mode.clone(),
        fps_out: s.fps_out,
        fps_rx: s.fps_rx,
        esp_rssi: s.esp_rssi,
        esp_drops: s.esp_drops,
        led_count: s.led_count,
        loop_sequence_id: None,
        uptime_sec: s.uptime_sec(),
    })
}
