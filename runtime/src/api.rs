use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::{
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::media;
use crate::state::{OutputMode, RuntimeState, SharedState};

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

#[derive(Deserialize)]
struct ModeRequest {
    mode: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoopSelectRequest {
    sequence_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorResponse {
    error: String,
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
            "/api/v1/mode",
            post({
                let app = app.clone();
                move |body| post_mode(app.clone(), body)
            }),
        )
        .route(
            "/api/v1/loop/select",
            post({
                let app = app.clone();
                move |body| post_loop_select(app.clone(), body)
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
    Json(state_response(&app, &s))
}

async fn post_mode(app: SharedState, Json(req): Json<ModeRequest>) -> impl IntoResponse {
    let Some(mode) = OutputMode::parse(req.mode.as_str()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!("unsupported mode: {}", req.mode),
            }),
        )
            .into_response();
    };

    app.set_output_mode(mode).await;
    let s = app.state.read().await;
    (StatusCode::OK, Json(state_response(&app, &s))).into_response()
}

fn state_response(app: &SharedState, s: &RuntimeState) -> StateResponse {
    StateResponse {
        layout_id: s.layout_id.clone(),
        mode: s.mode.clone(),
        fps_out: app.metrics.fps_out(),
        fps_rx: s.fps_rx,
        esp_rssi: s.esp_rssi,
        esp_drops: s.esp_drops,
        led_count: s.led_count,
        loop_sequence_id: s.loop_sequence_id.clone(),
        uptime_sec: s.uptime_sec(),
        frame_loop_stale_ms: app.metrics.frame_loop_stale_ms(),
        layout_mismatch: s.layout_mismatch,
        frames_sent: app.metrics.frames_sent(),
    }
}

async fn post_loop_select(
    app: SharedState,
    Json(req): Json<LoopSelectRequest>,
) -> impl IntoResponse {
    let sequence = match media::load_sequence(&app.sequences_dir, &req.sequence_id) {
        Ok(sequence) => sequence,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: format!("load sequence failed: {e:#}"),
                }),
            )
                .into_response();
        }
    };

    let (layout_id, led_count) = {
        let s = app.state.read().await;
        (s.layout_id.clone(), s.led_count)
    };
    if sequence.layout_id != layout_id || sequence.led_count != led_count as usize {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!(
                    "sequence layout mismatch: {} / {} LEDs, runtime expects {} / {} LEDs",
                    sequence.layout_id, sequence.led_count, layout_id, led_count
                ),
            }),
        )
            .into_response();
    }

    app.set_sequence(sequence).await;
    app.set_output_mode(OutputMode::Loop).await;
    let s = app.state.read().await;
    (StatusCode::OK, Json(state_response(&app, &s))).into_response()
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
