use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::{
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::{Duration, Instant};
use tokio::time;

use crate::media;
use crate::state::{
    InteractiveEffectKind, InteractivePulse, OutputMode, RuntimeState, SharedState,
};

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
    master_brightness: f64,
    master_gamma: f64,
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MasterToneRequest {
    brightness: f64,
    gamma: f64,
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
            "/api/v1/master-tone",
            post({
                let app = app.clone();
                move |body| post_master_tone(app.clone(), body)
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

    loop {
        tokio::select! {
            _ = ticker.tick() => {
                if send_ws_state(&mut socket, &app).await.is_err() {
                    return;
                }
            }
            maybe_msg = socket.recv() => {
                let Some(Ok(msg)) = maybe_msg else {
                    return;
                };
                match msg {
                    Message::Text(text) => {
                        if handle_ws_text(&mut socket, &text, &app).await.is_err() {
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
        "masterSettings" => {
            let cur_b = app.master_brightness();
            let cur_g = app.master_gamma();
            let brightness = v
                .get("brightness")
                .and_then(|x| x.as_f64())
                .map(|x| x as f32)
                .unwrap_or(cur_b);
            let gamma = v
                .get("gamma")
                .and_then(|x| x.as_f64())
                .map(|x| x as f32)
                .unwrap_or(cur_g);
            app.set_master_tone(brightness, gamma);
            let reply = json!({
                "type": "event_status",
                "event": "masterSettings",
                "status": "ok",
                "brightness": f64::from(app.master_brightness()),
                "gamma": f64::from(app.master_gamma())
            });
            socket.send(Message::Text(reply.to_string().into())).await?;
        }
        "interactive" | "ripple" => {
            if app.output_mode() != OutputMode::Interactive {
                let reply = json!({
                    "type": "event_status",
                    "event": "interactive",
                    "status": "error",
                    "reason": "interactive WS events apply only in output mode \"interactive\""
                });
                socket.send(Message::Text(reply.to_string().into())).await?;
                return Ok(());
            }

            if kind == "interactive" {
                if let Some("setEffect") = v.get("action").and_then(|a| a.as_str()) {
                    let Some(ef) = v
                        .get("effect")
                        .and_then(|e| e.as_str())
                        .and_then(InteractiveEffectKind::parse)
                    else {
                        let reply = json!({
                            "type": "event_status",
                            "event": "interactive",
                            "status": "error",
                            "reason": "setEffect requires \"effect\": \"sphereGaussian\" | \"expandingRingDiagonal\""
                        });
                        socket.send(Message::Text(reply.to_string().into())).await?;
                        return Ok(());
                    };
                    app.set_interactive_default_effect(ef);
                    let reply = json!({
                        "type": "event_status",
                        "event": "interactive",
                        "status": "ok",
                        "action": "setEffect",
                        "effect": ef.as_str()
                    });
                    socket.send(Message::Text(reply.to_string().into())).await?;
                    return Ok(());
                }
                if let Some(act) = v.get("action").and_then(|a| a.as_str()) {
                    if act != "pulse" {
                        let reply = json!({
                            "type": "event_status",
                            "event": "interactive",
                            "status": "error",
                            "reason": format!("unknown interactive action: {act}")
                        });
                        socket.send(Message::Text(reply.to_string().into())).await?;
                        return Ok(());
                    }
                }
            }

            let u = v.get("u").and_then(|x| x.as_f64()).unwrap_or(0.5) as f32;
            let v_coord = v.get("v").and_then(|x| x.as_f64()).unwrap_or(0.5) as f32;
            let amplitude = v
                .get("amplitude")
                .and_then(|x| x.as_f64())
                .unwrap_or(1.0) as f32;
            let u = u.clamp(0.0, 1.0);
            let v_coord = v_coord.clamp(0.0, 1.0);
            let amplitude = amplitude.clamp(0.0, 4.0);
            let duration_ms = v
                .get("durationMs")
                .and_then(|x| x.as_u64())
                .unwrap_or(450)
                .clamp(100, 5000) as u32;
            let sigma_rad = v
                .get("sigmaRad")
                .and_then(|x| x.as_f64())
                .unwrap_or(0.14) as f32;
            let sigma_rad = sigma_rad.clamp(0.02f32, 0.6f32);
            let effect = v
                .get("effect")
                .and_then(|e| e.as_str())
                .and_then(InteractiveEffectKind::parse)
                .unwrap_or_else(|| app.interactive_default_effect());

            let (layout_id, led_count) = {
                let s = app.state.read().await;
                (s.layout_id.clone(), s.led_count as usize)
            };

            let reply = match app.ensure_interactive_uv(&layout_id, led_count) {
                Ok(()) => {
                    let pulse = build_interactive_pulse(&v, u, v_coord, amplitude, duration_ms, sigma_rad, effect);
                    app.push_interactive_pulse(pulse);
                    json!({
                        "type": "event_status",
                        "event": "interactive",
                        "status": "ok",
                        "effect": effect.as_str()
                    })
                }
                Err(e) => json!({
                    "type": "event_status",
                    "event": "interactive",
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
        master_brightness: f64::from(app.master_brightness()),
        master_gamma: f64::from(app.master_gamma()),
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

async fn post_master_tone(
    app: SharedState,
    Json(req): Json<MasterToneRequest>,
) -> impl IntoResponse {
    app.set_master_tone(req.brightness as f32, req.gamma as f32);
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

fn mix64(mut x: u64) -> u64 {
    x ^= x >> 33;
    x = x.wrapping_mul(0xff51afd7ed558ccd);
    x ^= x >> 33;
    x = x.wrapping_mul(0xc4ceb9fe1a85ec53);
    x ^= x >> 33;
    x
}

fn hsv_to_rgb(h: f32, s: f32, v: f32) -> (u8, u8, u8) {
    let hh = (h.fract() + 1.0).fract() * 6.0;
    let sector = (hh as u32).min(5);
    let f = hh - sector as f32;
    let p = v * (1.0 - s);
    let q = v * (1.0 - f * s);
    let t = v * (1.0 - (1.0 - f) * s);
    let (r, g, b) = match sector {
        0 => (v, t, p),
        1 => (q, v, p),
        2 => (p, v, t),
        3 => (p, q, v),
        4 => (t, p, v),
        _ => (v, p, q),
    };
    (
        (r * 255.0).round().clamp(0.0, 255.0) as u8,
        (g * 255.0).round().clamp(0.0, 255.0) as u8,
        (b * 255.0).round().clamp(0.0, 255.0) as u8,
    )
}

fn vivid_rgb_from_seed(seed: u64) -> (u8, u8, u8) {
    let h = mix64(seed);
    let hue = (h % 1_000_000) as f32 / 1_000_000.0;
    hsv_to_rgb(hue, 0.9, 0.97)
}

fn parse_color_rgb(v: &serde_json::Value) -> Option<(u8, u8, u8)> {
    let arr = v.as_array()?;
    if arr.len() != 3 {
        return None;
    }
    let ch = |x: &serde_json::Value| -> Option<u8> {
        if let Some(u) = x.as_u64() {
            return Some((u.min(255)) as u8);
        }
        if let Some(f) = x.as_f64() {
            return Some(f.round().clamp(0.0, 255.0) as u8);
        }
        let i = x.as_i64()?;
        Some(i.clamp(0, 255) as u8)
    };
    Some((ch(&arr[0])?, ch(&arr[1])?, ch(&arr[2])?))
}

fn build_interactive_pulse(
    v: &serde_json::Value,
    u: f32,
    v_coord: f32,
    amplitude: f32,
    duration_ms: u32,
    sigma_rad: f32,
    effect: InteractiveEffectKind,
) -> InteractivePulse {
    let color_random = v.get("colorRandom").and_then(|x| x.as_bool()).unwrap_or(false);
    let time_seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(42);
    let tap_seed = (u.to_bits() as u64) ^ ((v_coord.to_bits() as u64) << 32);
    let (cr, cg, cb) = if color_random {
        vivid_rgb_from_seed(time_seed ^ tap_seed)
    } else if let Some(c) = v.get("colorRgb").and_then(parse_color_rgb) {
        c
    } else {
        (200, 240, 255)
    };

    let ring_speed = v
        .get("ringSpeed")
        .and_then(|x| x.as_f64())
        .unwrap_or(1.0) as f32;
    let ring_speed = ring_speed.clamp(0.12f32, 12.0f32);

    let ring_thickness_rad = v
        .get("ringThicknessRad")
        .and_then(|x| x.as_f64())
        .unwrap_or(0.0) as f32;
    let ring_thickness_rad = ring_thickness_rad.clamp(0.0f32, 0.38f32);

    let duration = match effect {
        InteractiveEffectKind::ExpandingRingDiagonal => {
            let dyn_ = crate::output::ripple_dynamics(ring_speed, ring_thickness_rad);
            Duration::from_secs_f32(dyn_.lifetime)
        }
        InteractiveEffectKind::SphereGaussian => Duration::from_millis(duration_ms as u64),
    };

    InteractivePulse {
        center_u: u,
        center_v: v_coord,
        amplitude,
        sigma_rad,
        effect,
        started: Instant::now(),
        duration,
        color_r: cr,
        color_g: cg,
        color_b: cb,
        ring_speed,
        ring_thickness_rad,
    }
}
