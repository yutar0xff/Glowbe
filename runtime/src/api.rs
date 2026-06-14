use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::{
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use tokio::sync::broadcast;
use tokio::time::{self, Duration};

use crate::media;
use crate::state::{OutputMode, PreviewFrame, RuntimeState, SharedState};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StateResponse {
    layout_id: String,
    mode: String,
    fps_out: f64,
    fps_rx: Option<f64>,
    esp_frames_complete: Option<u32>,
    esp_rssi: Option<i8>,
    esp_drops: Option<u16>,
    esp_status_addr: Option<String>,
    output_target_addr: Option<String>,
    led_count: u16,
    loop_sequence_id: Option<String>,
    uptime_sec: u64,
    frame_loop_stale_ms: u64,
    layout_mismatch: bool,
    frames_sent: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WsStateMessage {
    #[serde(rename = "type")]
    kind: &'static str,
    #[serde(flatten)]
    state: StateResponse,
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
            "/api/v1/sequences",
            get({
                let app = app.clone();
                move || get_sequences(app.clone())
            }),
        )
        .route(
            "/api/v1/layout/uv",
            get({
                let app = app.clone();
                move || get_layout_uv(app.clone())
            }),
        )
        .route(
            "/api/v1/ws",
            get({
                let app = app.clone();
                move |ws| ws_handler(ws, app.clone())
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

async fn ws_handler(ws: WebSocketUpgrade, app: SharedState) -> impl IntoResponse {
    ws.on_upgrade(move |socket| ws_loop(socket, app))
}

async fn ws_loop(mut socket: WebSocket, app: SharedState) {
    if send_ws_state(&mut socket, &app).await.is_err() {
        return;
    }

    let mut ticker = time::interval(Duration::from_secs(1));
    ticker.set_missed_tick_behavior(time::MissedTickBehavior::Skip);
    let mut preview_rx: Option<broadcast::Receiver<Arc<PreviewFrame>>> = None;

    loop {
        tokio::select! {
            _ = ticker.tick() => {
                if send_ws_state(&mut socket, &app).await.is_err() {
                    return;
                }
                if let Some(ref mut rx) = preview_rx {
                    let mut latest: Option<Arc<PreviewFrame>> = None;
                    while let Ok(p) = rx.try_recv() {
                        latest = Some(p);
                    }
                    if let Some(p) = latest {
                        let data = STANDARD.encode(p.jpeg.as_slice());
                        let msg = json!({
                            "type": "preview_frame",
                            "format": "jpeg",
                            "seq": p.seq,
                            "data": data
                        });
                        if socket.send(Message::Text(msg.to_string().into())).await.is_err() {
                            return;
                        }
                    }
                }
            }
            maybe_msg = socket.recv() => {
                let Some(Ok(msg)) = maybe_msg else {
                    return;
                };
                match msg {
                    Message::Text(text) => {
                        if handle_ws_text(&mut socket, &text, &app, &mut preview_rx)
                            .await
                            .is_err()
                        {
                            return;
                        }
                    }
                    Message::Ping(payload) => {
                        if socket.send(Message::Pong(payload)).await.is_err() {
                            return;
                        }
                    }
                    Message::Close(_) => return,
                    _ => {}
                }
            }
        }
    }
}

async fn send_ws_state(socket: &mut WebSocket, app: &SharedState) -> Result<(), axum::Error> {
    let s = app.state.read().await;
    let msg = WsStateMessage {
        kind: "state",
        state: state_response(app, &s),
    };
    let text = serde_json::to_string(&msg).expect("serialize ws state");
    socket.send(Message::Text(text.into())).await
}

async fn handle_ws_text(
    socket: &mut WebSocket,
    text: &str,
    app: &SharedState,
    preview_rx: &mut Option<broadcast::Receiver<Arc<PreviewFrame>>>,
) -> Result<(), axum::Error> {
    let v: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(e) => {
            let reply = json!({
                "type": "error",
                "error": format!("invalid ws json: {e}")
            });
            socket.send(Message::Text(reply.to_string().into())).await?;
            return Ok(());
        }
    };

    let kind = v.get("type").and_then(|t| t.as_str()).unwrap_or("");

    match kind {
        "ping" => {
            let reply = json!({ "type": "pong" });
            socket.send(Message::Text(reply.to_string().into())).await?;
        }
        "subscribe_preview" => {
            let q = v
                .get("quality")
                .and_then(|x| x.as_u64())
                .unwrap_or(70)
                .clamp(1, 95) as u8;
            app.set_preview_quality(q);
            *preview_rx = Some(app.preview_tx.subscribe());
            let reply = json!({
                "type": "preview_status",
                "status": "available",
                "quality": q
            });
            socket.send(Message::Text(reply.to_string().into())).await?;
        }
        "unsubscribe_preview" => {
            *preview_rx = None;
            let reply = json!({
                "type": "preview_status",
                "status": "stopped",
                "reason": "client unsubscribed"
            });
            socket.send(Message::Text(reply.to_string().into())).await?;
        }
        "ripple" => {
            let u = v.get("u").and_then(|x| x.as_f64()).unwrap_or(0.5) as f32;
            let v_coord = v.get("v").and_then(|x| x.as_f64()).unwrap_or(0.5) as f32;
            let amplitude = v
                .get("amplitude")
                .and_then(|x| x.as_f64())
                .unwrap_or(1.0) as f32;
            let u = u.clamp(0.0, 1.0);
            let v_coord = v_coord.clamp(0.0, 1.0);
            let amplitude = amplitude.clamp(0.0, 4.0);

            let (layout_id, led_count) = {
                let s = app.state.read().await;
                (s.layout_id.clone(), s.led_count as usize)
            };

            if app.output_mode() != OutputMode::Ripple {
                let reply = json!({
                    "type": "event_status",
                    "event": "ripple",
                    "status": "error",
                    "reason": "ripple WS events apply only in output mode \"ripple\""
                });
                socket.send(Message::Text(reply.to_string().into())).await?;
                return Ok(());
            }

            let reply = match app.ensure_ripple_uv(&layout_id, led_count) {
                Ok(()) => {
                    app.set_ripple_pulse(u, v_coord, amplitude);
                    json!({
                        "type": "event_status",
                        "event": "ripple",
                        "status": "ok"
                    })
                }
                Err(e) => json!({
                    "type": "event_status",
                    "event": "ripple",
                    "status": "error",
                    "reason": format!("{e:#}")
                }),
            };
            socket.send(Message::Text(reply.to_string().into())).await?;
        }
        _ => {
            let reply = json!({
                "type": "error",
                "error": format!("unsupported ws message type: {kind}")
            });
            socket.send(Message::Text(reply.to_string().into())).await?;
        }
    }
    Ok(())
}

async fn get_state(app: SharedState) -> Json<StateResponse> {
    let s = app.state.read().await;
    Json(state_response(&app, &s))
}

async fn get_sequences(app: SharedState) -> impl IntoResponse {
    match media::list_sequences(&app.sequences_dir) {
        Ok(sequences) => (StatusCode::OK, Json(sequences)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("list sequences failed: {e:#}"),
            }),
        )
            .into_response(),
    }
}

async fn get_layout_uv(app: SharedState) -> impl IntoResponse {
    let layout_id = {
        let s = app.state.read().await;
        s.layout_id.clone()
    };
    match media::load_layout_uv(&app.compiled_dir, &layout_id) {
        Ok(layout) => (StatusCode::OK, Json(layout)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("load layout uv failed: {e:#}"),
            }),
        )
            .into_response(),
    }
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

    if mode == OutputMode::Idle {
        app.clear_sequence().await;
    }
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
        esp_frames_complete: s.esp_frames_complete,
        esp_rssi: s.esp_rssi,
        esp_drops: s.esp_drops,
        esp_status_addr: s.esp_status_addr.clone(),
        output_target_addr: s.output_target_addr.clone(),
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
