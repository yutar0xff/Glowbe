use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{DefaultBodyLimit, Multipart, Path, Query};
use axum::http::header;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{
    routing::{get, patch, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::time;
use uuid::Uuid;

use crate::device_slot::DeviceSlot;
use crate::devices::DeviceRecord;
use crate::discover;
use crate::media;
use crate::mate;
use crate::state::{
    InteractiveEffectKind, InteractivePulse, MediaUploadEntry, MediaUploadPhase, OutputMode,
    RuntimeState, SharedState,
};

/// WebSocket バイナリ LED プレビュー（ビッグエンディアン）。ASCII `GBP1`。
const PREVIEW_FRAME_MAGIC: u32 = 0x4742_5031;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StateResponse {
    device_id: String,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    loop_source_frame: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mate: Option<mate::MateSummary>,
    loop_playback_paused: bool,
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
struct LoopPauseRequest {
    paused: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MasterToneRequest {
    brightness: f64,
    gamma: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceLayoutRequest {
    layout_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorResponse {
    error: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaUploadStoredResponse {
    upload_id: String,
    status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaConvertQueuedResponse {
    job_id: String,
    status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaUploadStatusResponse {
    upload_id: String,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    job_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sequence_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    progress: Option<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaConvertRequest {
    #[serde(default = "default_media_fps")]
    fps: u32,
    layout_id: String,
    #[serde(default)]
    display_name: Option<String>,
}

fn default_media_fps() -> u32 {
    30
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceIdQuery {
    #[serde(default)]
    device_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceListResponse {
    default_device_id: String,
    devices: Vec<DeviceRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    created_device_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceCreateRequest {
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    esp_ip: Option<String>,
    #[serde(default)]
    mdns_hostname: Option<String>,
    layout_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceUpdateRequest {
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    esp_ip: Option<String>,
    #[serde(default)]
    mdns_hostname: Option<String>,
    layout_id: String,
}

type ApiError = (StatusCode, Json<ErrorResponse>);

fn resolve_slot(app: &SharedState, q: &DeviceIdQuery) -> Result<Arc<DeviceSlot>, ApiError> {
    let id = app
        .resolve_device_id(q.device_id.as_deref())
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse { error: e }),
            )
        })?;
    app.device(&id).map_err(|e| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse { error: e }),
        )
    })
}

fn safe_disk_ext(file_name: Option<&str>) -> Result<&'static str, &'static str> {
    let ext = file_name
        .and_then(|n| std::path::Path::new(n).extension())
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase());
    let ext = ext.as_deref().unwrap_or("png");
    match ext {
        "jpg" | "jpeg" => Ok("jpg"),
        "png" => Ok("png"),
        "zip" => Ok("zip"),
        "mp4" => Ok("mp4"),
        "webm" => Ok("webm"),
        "mov" => Ok("mov"),
        "mkv" => Ok("mkv"),
        _ => Err("only .png, .jpg/.jpeg, .zip, or video (.mp4/.webm/.mov/.mkv) are supported"),
    }
}

fn media_status_json(upload_id: &str, entry: &MediaUploadEntry) -> MediaUploadStatusResponse {
    match &entry.phase {
        MediaUploadPhase::Stored => MediaUploadStatusResponse {
            upload_id: upload_id.to_string(),
            status: "stored",
            job_id: None,
            sequence_id: None,
            error: None,
            progress: None,
        },
        MediaUploadPhase::Converting { job_id, progress } => MediaUploadStatusResponse {
            upload_id: upload_id.to_string(),
            status: "running",
            job_id: Some(job_id.clone()),
            sequence_id: None,
            error: None,
            progress: Some(progress.load(Ordering::Relaxed)),
        },
        MediaUploadPhase::Done {
            job_id,
            sequence_id,
        } => MediaUploadStatusResponse {
            upload_id: upload_id.to_string(),
            status: "done",
            job_id: Some(job_id.clone()),
            sequence_id: Some(sequence_id.clone()),
            error: None,
            progress: Some(100),
        },
        MediaUploadPhase::Failed { job_id, message } => MediaUploadStatusResponse {
            upload_id: upload_id.to_string(),
            status: "failed",
            job_id: job_id.clone(),
            sequence_id: None,
            error: Some(message.clone()),
            progress: None,
        },
    }
}

async fn post_media_upload(app: SharedState, mut multipart: Multipart) -> impl IntoResponse {
    let mut file_bytes: Option<(axum::body::Bytes, Option<String>)> = None;
    while let Ok(Some(field)) = multipart.next_field().await {
        if field.name() != Some("file") {
            continue;
        }
        let fname = field.file_name().map(|s| s.to_string());
        match field.bytes().await {
            Ok(b) => {
                file_bytes = Some((b, fname));
                break;
            }
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse {
                        error: format!("read upload failed: {e}"),
                    }),
                )
                    .into_response();
            }
        }
    }
    let Some((data, fname)) = file_bytes else {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "multipart field \"file\" is required".into(),
            }),
        )
            .into_response();
    };

    let disk_ext = match safe_disk_ext(fname.as_deref()) {
        Ok(e) => e,
        Err(msg) => {
            return (
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                Json(ErrorResponse {
                    error: msg.into(),
                }),
            )
                .into_response();
        }
    };

    let upload_id = Uuid::new_v4().hyphenated().to_string();
    let dir = app.uploads_dir.join(&upload_id);
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("create upload dir: {e:#}"),
            }),
        )
            .into_response();
    }
    let dest = dir.join(format!("source.{disk_ext}"));
    if let Err(e) = std::fs::write(&dest, &data) {
        let _ = std::fs::remove_dir_all(&dir);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("write upload: {e:#}"),
            }),
        )
            .into_response();
    }

    let mut map = app.media_uploads.write().await;
    map.insert(
        upload_id.clone(),
        MediaUploadEntry {
            source_path: dest,
            phase: MediaUploadPhase::Stored,
        },
    );

    (
        StatusCode::OK,
        Json(MediaUploadStoredResponse {
            upload_id,
            status: "stored",
        }),
    )
        .into_response()
}

async fn get_media_upload_status(
    app: SharedState,
    Path(upload_id): Path<String>,
) -> impl IntoResponse {
    let Ok(uuid) = Uuid::parse_str(upload_id.trim()) else {
        return (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "unknown upload".into(),
            }),
        )
            .into_response();
    };
    let upload_id = uuid.hyphenated().to_string();
    let map = app.media_uploads.read().await;
    let Some(entry) = map.get(&upload_id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "unknown upload".into(),
            }),
        )
            .into_response();
    };
    let body = media_status_json(&upload_id, entry);
    (StatusCode::OK, Json(body)).into_response()
}

async fn post_media_convert(
    app: SharedState,
    Path(upload_id): Path<String>,
    Json(req): Json<MediaConvertRequest>,
) -> impl IntoResponse {
    let Ok(uuid) = Uuid::parse_str(upload_id.trim()) else {
        return (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "unknown upload".into(),
            }),
        )
            .into_response();
    };
    let upload_id = uuid.hyphenated().to_string();

    let layout_id = req.layout_id.trim();
    if layout_id.is_empty() || layout_id.contains('/') || layout_id.contains('\\') {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "layoutId must be non-empty and path-safe".into(),
            }),
        )
            .into_response();
    }
    let layout_id = layout_id.to_string();
    let fps = req.fps.clamp(1, 120);
    let display_name = media::sanitize_display_name(req.display_name.as_deref());

    let job_id = Uuid::new_v4().hyphenated().to_string();
    let sequence_id = format!("up-{upload_id}");
    let progress = Arc::new(AtomicU8::new(0));
    let progress_spawn = progress.clone();

    let source_path = {
        let mut map = app.media_uploads.write().await;
        let Some(entry) = map.get_mut(&upload_id) else {
            return (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "unknown upload".into(),
                }),
            )
                .into_response();
        };
        let allowed = matches!(
            &entry.phase,
            MediaUploadPhase::Stored | MediaUploadPhase::Failed { .. }
        );
        if !allowed {
            return (
                StatusCode::CONFLICT,
                Json(ErrorResponse {
                    error: "upload is already converting or already converted".into(),
                }),
            )
                .into_response();
        }
        let path = entry.source_path.clone();
        entry.phase = MediaUploadPhase::Converting {
            job_id: job_id.clone(),
            progress,
        };
        path
    };

    let compiled_dir = app.compiled_dir.clone();
    let sequences_dir = app.sequences_dir.clone();
    let app2 = app.clone();
    let job_id_spawn = job_id.clone();
    let upload_id_spawn = upload_id.clone();
    let sequence_id_spawn = sequence_id.clone();

    tokio::spawn(async move {
        let sequence_for_blocking = sequence_id_spawn.clone();
        let display_opt = display_name;
        let res = tokio::task::spawn_blocking(move || {
            media::convert_uploaded_media_to_sequence(
                &source_path,
                &sequence_for_blocking,
                &layout_id,
                &compiled_dir,
                &sequences_dir,
                fps,
                display_opt.as_deref(),
                Some(&progress_spawn),
            )
        })
        .await;

        let mut map = app2.media_uploads.write().await;
        let Some(entry) = map.get_mut(&upload_id_spawn) else {
            return;
        };
        match res {
            Ok(Ok(_)) => {
                entry.phase = MediaUploadPhase::Done {
                    job_id: job_id_spawn.clone(),
                    sequence_id: sequence_id_spawn,
                };
            }
            Ok(Err(e)) => {
                entry.phase = MediaUploadPhase::Failed {
                    job_id: Some(job_id_spawn.clone()),
                    message: format!("{e:#}"),
                };
            }
            Err(e) => {
                entry.phase = MediaUploadPhase::Failed {
                    job_id: Some(job_id_spawn.clone()),
                    message: format!("convert task failed: {e}"),
                };
            }
        }
    });

    (
        StatusCode::OK,
        Json(MediaConvertQueuedResponse {
            job_id,
            status: "queued",
        }),
    )
        .into_response()
}

pub fn router(app: SharedState) -> Router {
    let upload_router = Router::new()
        .route(
            "/api/v1/media/upload",
            post({
                let app = app.clone();
                move |multipart: Multipart| {
                    let app = app.clone();
                    async move { post_media_upload(app, multipart).await }
                }
            }),
        )
        .layer(DefaultBodyLimit::max(48 * 1024 * 1024));

    let app_health = app.clone();
    let main = Router::new()
        .route(
            "/api/v1/devices",
            get({
                let app = app.clone();
                move || get_devices(app.clone())
            })
            .post({
                let app = app.clone();
                move |body| post_device(app.clone(), body)
            }),
        )
        .route(
            "/api/v1/devices/discovered",
            get({
                let app = app.clone();
                move || get_devices_discovered(app.clone())
            }),
        )
        .route(
            "/api/v1/devices/{device_id}",
            patch({
                let app = app.clone();
                move |path, body| patch_device(app.clone(), path, body)
            })
            .delete({
                let app = app.clone();
                move |path| delete_device(app.clone(), path)
            }),
        )
        .route(
            "/api/v1/state",
            get({
                let app = app.clone();
                move |q| get_state(app.clone(), q)
            }),
        )
        .route(
            "/api/v1/mode",
            post({
                let app = app.clone();
                move |q, body| post_mode(app.clone(), q, body)
            }),
        )
        .route(
            "/api/v1/loop/select",
            post({
                let app = app.clone();
                move |q, body| post_loop_select(app.clone(), q, body)
            }),
        )
        .route(
            "/api/v1/loop/clear-selection",
            post({
                let app = app.clone();
                move |q| post_loop_clear_selection(app.clone(), q)
            }),
        )
        .route(
            "/api/v1/loop/pause",
            post({
                let app = app.clone();
                move |q, body| post_loop_pause(app.clone(), q, body)
            }),
        )
        .route(
            "/api/v1/master-tone",
            post({
                let app = app.clone();
                move |q, body| post_master_tone(app.clone(), q, body)
            }),
        )
        .route(
            "/api/v1/mate/state",
            post({
                let app = app.clone();
                move |q, body| post_mate_state(app.clone(), q, body)
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
            "/api/v1/sequences/{sequence_id}",
            patch({
                let app = app.clone();
                move |path, body| patch_sequence_display(app.clone(), path, body)
            })
            .delete({
                let app = app.clone();
                move |path: Path<String>| {
                    let app = app.clone();
                    async move { delete_sequence(app, path).await }
                }
            }),
        )
        .route(
            "/api/v1/sequences/{sequence_id}/source-frame/{frame_index}",
            get({
                let app = app.clone();
                move |path: Path<(String, u32)>| {
                    let app = app.clone();
                    async move { get_sequence_source_frame(app, path).await }
                }
            }),
        )
        .route(
            "/api/v1/layout/uv",
            get({
                let app = app.clone();
                move |q| get_layout_uv(app.clone(), q)
            }),
        )
        .route(
            "/api/v1/layouts",
            get({
                let app = app.clone();
                move || get_layout_catalog(app.clone())
            }),
        )
        .route(
            "/api/v1/device/layout",
            post({
                let app = app.clone();
                move |q, body| post_device_layout(app.clone(), q, body)
            }),
        )
        .route(
            "/api/v1/media/{upload_id}/convert",
            post({
                let app = app.clone();
                move |path, body| post_media_convert(app.clone(), path, body)
            }),
        )
        .route(
            "/api/v1/media/{upload_id}",
            get({
                let app = app.clone();
                move |path| get_media_upload_status(app.clone(), path)
            }),
        )
        .route(
            "/api/v1/ws",
            get({
                let app = app.clone();
                move |ws, q| ws_handler(ws, q, app.clone())
            }),
        )
        .route(
            "/health",
            get({
                let app = app_health.clone();
                move || health(app.clone())
            }),
        );

    upload_router.merge(main)
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(q): Query<DeviceIdQuery>,
    app: SharedState,
) -> impl IntoResponse {
    let device_id = match app.resolve_device_id(q.device_id.as_deref()) {
        Ok(id) => id,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse { error: e }),
            )
                .into_response();
        }
    };
    ws.on_upgrade(move |socket| ws_loop(socket, app, device_id))
}

async fn ws_loop(mut socket: WebSocket, app: SharedState, device_id: String) {
    let slot = match app.device(&device_id) {
        Ok(s) => s,
        Err(_) => return,
    };
    if send_ws_state(&mut socket, &slot).await.is_err() {
        return;
    }

    let preview_wanted = Arc::new(AtomicBool::new(false));
    let mut ticker = time::interval(Duration::from_secs(1));
    ticker.set_missed_tick_behavior(time::MissedTickBehavior::Skip);
    let mut preview_ticker = time::interval(Duration::from_secs_f64(1.0 / 30.0));
    preview_ticker.set_missed_tick_behavior(time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            _ = ticker.tick() => {
                if send_ws_state(&mut socket, &slot).await.is_err() {
                    return;
                }
            }
            _ = preview_ticker.tick(), if preview_wanted.load(Ordering::Relaxed) => {
                if send_preview_frame(&mut socket, &slot).await.is_err() {
                    return;
                }
            }
            maybe_msg = socket.recv() => {
                let Some(Ok(msg)) = maybe_msg else {
                    return;
                };
                match msg {
                    Message::Text(text) => {
                        if handle_ws_text(&mut socket, &text, &app, &slot, &preview_wanted).await.is_err() {
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

async fn send_preview_frame(socket: &mut WebSocket, slot: &DeviceSlot) -> Result<(), axum::Error> {
    let led_count = { slot.state.read().await.led_count };
    let expected = led_count as usize * 3;
    let (seq, rgb) = {
        let guard = match slot.preview_frame.read() {
            Ok(g) => g,
            Err(_) => return Ok(()),
        };
        if guard.len() != expected {
            return Ok(());
        }
        let seq = slot.preview_seq.load(Ordering::Acquire);
        (seq, guard.clone())
    };
    let mut buf = Vec::with_capacity(12 + rgb.len());
    buf.extend_from_slice(&PREVIEW_FRAME_MAGIC.to_be_bytes());
    buf.extend_from_slice(&seq.to_be_bytes());
    buf.extend_from_slice(&led_count.to_be_bytes());
    buf.extend_from_slice(&0u16.to_be_bytes());
    buf.extend_from_slice(&rgb);
    socket.send(Message::Binary(buf.into())).await
}

async fn send_ws_state(socket: &mut WebSocket, slot: &DeviceSlot) -> Result<(), axum::Error> {
    let s = slot.state.read().await;
    let msg = WsStateMessage {
        kind: "state",
        state: state_response(slot, &s),
    };
    let text = serde_json::to_string(&msg).expect("serialize ws state");
    socket.send(Message::Text(text.into())).await
}

async fn handle_ws_text(
    socket: &mut WebSocket,
    text: &str,
    app: &SharedState,
    slot: &DeviceSlot,
    preview_wanted: &Arc<AtomicBool>,
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
        "getLayoutUv" => {
            let layout_id = {
                let s = slot.state.read().await;
                s.layout_id.clone()
            };
            match media::load_layout_uv(&app.compiled_dir, &layout_id) {
                Ok(uv) => {
                    let mut payload = serde_json::to_value(&uv).expect("serialize layout uv");
                    if let serde_json::Value::Object(ref mut m) = payload {
                        m.insert(
                            "type".into(),
                            serde_json::Value::String("layoutUv".into()),
                        );
                    }
                    socket
                        .send(Message::Text(payload.to_string().into()))
                        .await?;
                }
                Err(e) => {
                    let reply = json!({
                        "type": "event_status",
                        "event": "getLayoutUv",
                        "status": "error",
                        "reason": format!("{e:#}")
                    });
                    socket.send(Message::Text(reply.to_string().into())).await?;
                }
            }
        }
        "ping" => {
            let reply = json!({ "type": "pong" });
            socket.send(Message::Text(reply.to_string().into())).await?;
        }
        "previewSubscribe" => {
            let enable = v.get("enable").and_then(|x| x.as_bool()).unwrap_or(true);
            preview_wanted.store(enable, Ordering::Relaxed);
            let reply = json!({
                "type": "event_status",
                "event": "previewSubscribe",
                "status": "ok",
                "enable": enable
            });
            socket.send(Message::Text(reply.to_string().into())).await?;
        }
        "masterSettings" => {
            let cur_b = slot.master_brightness();
            let cur_g = slot.master_gamma();
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
            slot.set_master_tone(brightness, gamma);
            let reply = json!({
                "type": "event_status",
                "event": "masterSettings",
                "status": "ok",
                "brightness": f64::from(slot.master_brightness()),
                "gamma": f64::from(slot.master_gamma())
            });
            socket.send(Message::Text(reply.to_string().into())).await?;
        }
        "interactive" => {
            if slot.output_mode() != OutputMode::Interactive {
                let reply = json!({
                    "type": "event_status",
                    "event": "interactive",
                    "status": "error",
                    "reason": "interactive WS events apply only in output mode \"interactive\""
                });
                socket.send(Message::Text(reply.to_string().into())).await?;
                return Ok(());
            }

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
                slot.set_interactive_default_effect(ef);
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
            if let Some("setSolid") = v.get("action").and_then(|a| a.as_str()) {
                let enabled = v
                    .get("enabled")
                    .and_then(|x| x.as_bool())
                    .unwrap_or(false);
                if !enabled {
                    slot.set_interactive_solid_rgb(None);
                    let reply = json!({
                        "type": "event_status",
                        "event": "interactive",
                        "status": "ok",
                        "action": "setSolid",
                        "enabled": false
                    });
                    socket.send(Message::Text(reply.to_string().into())).await?;
                    return Ok(());
                }
                let tri: [u8; 3] = if let Some(arr) = v.get("colorRgb").and_then(|x| x.as_array()) {
                    if arr.len() != 3 {
                        let reply = json!({
                            "type": "event_status",
                            "event": "interactive",
                            "status": "error",
                            "reason": "setSolid colorRgb must be [r,g,b]"
                        });
                        socket.send(Message::Text(reply.to_string().into())).await?;
                        return Ok(());
                    }
                    let mut out = [0u8; 3];
                    for (i, slot) in out.iter_mut().enumerate() {
                        let x = arr[i].as_f64().unwrap_or(0.0);
                        *slot = x.round().clamp(0.0, 255.0) as u8;
                    }
                    out
                } else {
                    let r = v.get("r").and_then(|x| x.as_f64()).unwrap_or(0.0);
                    let g = v.get("g").and_then(|x| x.as_f64()).unwrap_or(0.0);
                    let b = v.get("b").and_then(|x| x.as_f64()).unwrap_or(0.0);
                    [
                        r.round().clamp(0.0, 255.0) as u8,
                        g.round().clamp(0.0, 255.0) as u8,
                        b.round().clamp(0.0, 255.0) as u8,
                    ]
                };
                slot.set_interactive_solid_rgb(Some(tri));
                let reply = json!({
                    "type": "event_status",
                    "event": "interactive",
                    "status": "ok",
                    "action": "setSolid",
                    "enabled": true,
                    "colorRgb": [tri[0], tri[1], tri[2]]
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
                .unwrap_or_else(|| slot.interactive_default_effect());

            let (layout_id, led_count) = {
                let s = slot.state.read().await;
                (s.layout_id.clone(), s.led_count as usize)
            };

            let reply = match slot.ensure_interactive_uv(&app.compiled_dir, &layout_id, led_count) {
                Ok(()) => {
                    let pulse = build_interactive_pulse(&v, u, v_coord, amplitude, duration_ms, sigma_rad, effect);
                    slot.push_interactive_pulse(pulse);
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
        "mate" => {
            if slot.output_mode() != OutputMode::Mate {
                let reply = json!({
                    "type": "event_status",
                    "event": "mate",
                    "status": "error",
                    "reason": "mate WS events apply only in output mode \"mate\""
                });
                socket.send(Message::Text(reply.to_string().into())).await?;
                return Ok(());
            }

            let action = v.get("action").and_then(|a| a.as_str()).unwrap_or("");
            let patch = match action {
                "setExpression" => {
                    let Some(expr) = v.get("expression").and_then(|x| x.as_str()) else {
                        let reply = json!({
                            "type": "event_status",
                            "event": "mate",
                            "status": "error",
                            "reason": "setExpression requires \"expression\""
                        });
                        socket.send(Message::Text(reply.to_string().into())).await?;
                        return Ok(());
                    };
                    json!({ "expression": expr })
                }
                "setMood" => {
                    let Some(mood) = v.get("mood").and_then(|x| x.as_str()) else {
                        let reply = json!({
                            "type": "event_status",
                            "event": "mate",
                            "status": "error",
                            "reason": "setMood requires \"mood\""
                        });
                        socket.send(Message::Text(reply.to_string().into())).await?;
                        return Ok(());
                    };
                    json!({ "mood": mood })
                }
                "setIdle" => {
                    use serde_json::Map;
                    let mut idle = Map::new();
                    if let Some(r) = v.get("routine").and_then(|x| x.as_str()) {
                        idle.insert("routine".into(), json!(r));
                    }
                    if let Some(sp) = v.get("speed").and_then(|x| x.as_f64()) {
                        idle.insert("speed".into(), json!(sp));
                    }
                    if let Some(ax) = v.get("axis").and_then(|x| x.as_array()) {
                        idle.insert("axis".into(), json!(ax));
                    }
                    if idle.is_empty() {
                        let reply = json!({
                            "type": "event_status",
                            "event": "mate",
                            "status": "error",
                            "reason": "setIdle requires \"routine\", \"speed\", and/or \"axis\""
                        });
                        socket.send(Message::Text(reply.to_string().into())).await?;
                        return Ok(());
                    }
                    json!({ "idle": serde_json::Value::Object(idle) })
                }
                "setGaze" => {
                    use serde_json::Map;
                    let mut top = Map::new();
                    let mut gaze = Map::new();
                    if let Some(u) = v.get("u").and_then(|x| x.as_f64()) {
                        gaze.insert("u".into(), json!(u));
                    }
                    if let Some(vv) = v.get("v").and_then(|x| x.as_f64()) {
                        gaze.insert("v".into(), json!(vv));
                    }
                    if !gaze.is_empty() {
                        top.insert("gaze".into(), serde_json::Value::Object(gaze));
                    }
                    if let Some(gp) = v.get("gazePull").and_then(|x| x.as_f64()) {
                        top.insert("gazePull".into(), json!(gp));
                    }
                    if let Some(c) = v.get("cluster").and_then(|x| x.as_f64()) {
                        top.insert("cluster".into(), json!(c));
                    }
                    if top.is_empty() {
                        let reply = json!({
                            "type": "event_status",
                            "event": "mate",
                            "status": "error",
                            "reason": "setGaze requires \"u\"/\"v\" and/or \"gazePull\"/\"cluster\""
                        });
                        socket.send(Message::Text(reply.to_string().into())).await?;
                        return Ok(());
                    }
                    serde_json::Value::Object(top)
                }
                "setDynamics" => {
                    use serde_json::Map;
                    let mut d = Map::new();
                    if let Some(x) = v.get("stiffness").and_then(|x| x.as_f64()) {
                        d.insert("stiffness".into(), json!(x));
                    }
                    if let Some(x) = v.get("damping").and_then(|x| x.as_f64()) {
                        d.insert("damping".into(), json!(x));
                    }
                    if let Some(x) = v.get("floatiness").and_then(|x| x.as_f64()) {
                        d.insert("floatiness".into(), json!(x));
                    }
                    if let Some(x) = v.get("trailLag").and_then(|x| x.as_f64()) {
                        d.insert("trailLag".into(), json!(x));
                    }
                    if d.is_empty() {
                        let reply = json!({
                            "type": "event_status",
                            "event": "mate",
                            "status": "error",
                            "reason": "setDynamics requires at least one of stiffness, damping, floatiness, trailLag"
                        });
                        socket.send(Message::Text(reply.to_string().into())).await?;
                        return Ok(());
                    }
                    json!({ "dynamics": serde_json::Value::Object(d) })
                }
                "setAppearance" => {
                    use serde_json::Map;
                    let mut ap = Map::new();
                    if let Some(c) = v.get("color").and_then(|x| x.as_array()) {
                        ap.insert("color".into(), json!(c));
                    }
                    if let Some(x) = v.get("brightness").and_then(|x| x.as_f64()) {
                        ap.insert("brightness".into(), json!(x));
                    }
                    if let Some(x) = v.get("faceAngularRadiusDeg").and_then(|x| x.as_f64()) {
                        ap.insert("faceAngularRadiusDeg".into(), json!(x));
                    }
                    if let Some(x) = v.get("featureScale").and_then(|x| x.as_f64()) {
                        ap.insert("featureScale".into(), json!(x));
                    }
                    if let Some(x) = v.get("eyeSpacing").and_then(|x| x.as_f64()) {
                        ap.insert("eyeSpacing".into(), json!(x));
                    }
                    if let Some(x) = v.get("faceScale").and_then(|x| x.as_f64()) {
                        ap.insert("faceScale".into(), json!(x));
                    }
                    if let Some(x) = v.get("partsScale").and_then(|x| x.as_f64()) {
                        ap.insert("partsScale".into(), json!(x));
                    }
                    if let Some(x) = v.get("useExpressionTint").and_then(|x| x.as_bool()) {
                        ap.insert("useExpressionTint".into(), json!(x));
                    }
                    if ap.is_empty() {
                        let reply = json!({
                            "type": "event_status",
                            "event": "mate",
                            "status": "error",
                            "reason": "setAppearance requires color, brightness, faceAngularRadiusDeg, featureScale, eyeSpacing, faceScale, partsScale, and/or useExpressionTint"
                        });
                        socket.send(Message::Text(reply.to_string().into())).await?;
                        return Ok(());
                    }
                    json!({ "appearance": serde_json::Value::Object(ap) })
                }
                "setAuto" => {
                    use serde_json::Map;
                    let mut a = Map::new();
                    if let Some(x) = v.get("breath").and_then(|x| x.as_bool()) {
                        a.insert("breath".into(), json!(x));
                    }
                    if let Some(x) = v.get("blink").and_then(|x| x.as_bool()) {
                        a.insert("blink".into(), json!(x));
                    }
                    if let Some(x) = v.get("saccade").and_then(|x| x.as_bool()) {
                        a.insert("saccade".into(), json!(x));
                    }
                    if let Some(x) = v.get("tremor").and_then(|x| x.as_bool()) {
                        a.insert("tremor".into(), json!(x));
                    }
                    if a.is_empty() {
                        let reply = json!({
                            "type": "event_status",
                            "event": "mate",
                            "status": "error",
                            "reason": "setAuto requires at least one of breath, blink, saccade, tremor"
                        });
                        socket.send(Message::Text(reply.to_string().into())).await?;
                        return Ok(());
                    }
                    json!({ "auto": serde_json::Value::Object(a) })
                }
                "setMouthOpen" => {
                    let Some(val) = v.get("value").and_then(|x| x.as_f64()) else {
                        let reply = json!({
                            "type": "event_status",
                            "event": "mate",
                            "status": "error",
                            "reason": "setMouthOpen requires \"value\""
                        });
                        socket.send(Message::Text(reply.to_string().into())).await?;
                        return Ok(());
                    };
                    json!({ "mouthOpen": val })
                }
                "clearMouthOpen" => json!({ "clearMouthOpen": true }),
                _ => {
                    let reply = json!({
                        "type": "event_status",
                        "event": "mate",
                        "status": "error",
                        "reason": format!("unknown mate action: {action}")
                    });
                    socket.send(Message::Text(reply.to_string().into())).await?;
                    return Ok(());
                }
            };

            match slot.mate_apply_json(&patch) {
                Ok(()) => {
                    let reply = json!({
                        "type": "event_status",
                        "event": "mate",
                        "status": "ok",
                        "action": action
                    });
                    socket.send(Message::Text(reply.to_string().into())).await?;
                }
                Err(e) => {
                    let reply = json!({
                        "type": "event_status",
                        "event": "mate",
                        "status": "error",
                        "reason": e
                    });
                    socket.send(Message::Text(reply.to_string().into())).await?;
                }
            }
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

async fn get_sequence_source_frame(
    app: SharedState,
    Path((sequence_id, frame_index)): Path<(String, u32)>,
) -> impl IntoResponse {
    if sequence_id.is_empty() || sequence_id.contains('/') || sequence_id.contains('\\') {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "sequenceId must be non-empty and path-safe".into(),
            }),
        )
            .into_response();
    }

    let sequences_dir = app.sequences_dir.clone();
    let res = tokio::task::spawn_blocking(move || {
        media::export_sequence_source_frame_png(&sequences_dir, &sequence_id, frame_index)
    })
    .await;

    match res {
        Ok(Ok(bytes)) => match Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "image/png")
            .body(Body::from(bytes))
        {
            Ok(r) => r.into_response(),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("response build: {e}"),
                }),
            )
                .into_response(),
        },
        Ok(Err(e)) => (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: format!("{e:#}"),
            }),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("source-frame task: {e}"),
            }),
        )
            .into_response(),
    }
}

async fn get_state(
    app: SharedState,
    Query(q): Query<DeviceIdQuery>,
) -> Result<Json<StateResponse>, ApiError> {
    let slot = resolve_slot(&app, &q)?;
    let s = slot.state.read().await;
    Ok(Json(state_response(&slot, &s)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SequencePatchRequest {
    display_name: String,
}

async fn patch_sequence_display(
    app: SharedState,
    Path(sequence_id): Path<String>,
    Json(body): Json<SequencePatchRequest>,
) -> impl IntoResponse {
    if sequence_id.is_empty() || sequence_id.contains('/') || sequence_id.contains('\\') {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "sequenceId must be non-empty and path-safe".into(),
            }),
        )
            .into_response();
    }
    let manifest_path = app
        .sequences_dir
        .join(&sequence_id)
        .join("manifest.json");
    if !manifest_path.is_file() {
        return (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "sequence not found".into(),
            }),
        )
            .into_response();
    }
    if let Err(e) = media::set_sequence_display_name(
        &app.sequences_dir,
        &sequence_id,
        Some(body.display_name.as_str()),
    ) {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!("{e:#}"),
            }),
        )
            .into_response();
    }
    match media::sequence_summary(&app.sequences_dir, &sequence_id) {
        Ok(s) => (StatusCode::OK, Json(s)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("read sequence after patch: {e:#}"),
            }),
        )
            .into_response(),
    }
}

async fn delete_sequence(app: SharedState, Path(sequence_id): Path<String>) -> impl IntoResponse {
    if sequence_id.is_empty() || sequence_id.contains('/') || sequence_id.contains('\\') {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "sequenceId must be non-empty and path-safe".into(),
            }),
        )
            .into_response();
    }

    let should_clear = app.devices_ordered().iter().any(|slot| {
        slot.state
            .try_read()
            .ok()
            .and_then(|s| s.loop_sequence_id.clone())
            == Some(sequence_id.clone())
    });
    if should_clear {
        for slot in app.devices_ordered() {
            let clear = slot
                .state
                .try_read()
                .ok()
                .and_then(|s| s.loop_sequence_id.clone())
                == Some(sequence_id.clone());
            if clear {
                slot.clear_sequence().await;
            }
        }
    }

    let sequences_dir = app.sequences_dir.clone();
    let id = sequence_id.clone();
    let res = tokio::task::spawn_blocking(move || media::delete_sequence_directory(&sequences_dir, &id)).await;

    match res {
        Ok(Ok(())) => StatusCode::NO_CONTENT.into_response(),
        Ok(Err(e)) => {
            let msg = format!("{e:#}");
            let code = if msg.contains("not found") {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::BAD_REQUEST
            };
            (code, Json(ErrorResponse { error: msg })).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("delete task: {e}"),
            }),
        )
            .into_response(),
    }
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

async fn get_layout_catalog(app: SharedState) -> impl IntoResponse {
    match media::list_compiled_layouts(&app.compiled_dir) {
        Ok(layouts) => (StatusCode::OK, Json(layouts)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("list layouts failed: {e:#}"),
            }),
        )
            .into_response(),
    }
}

async fn post_device_layout(
    app: SharedState,
    Query(q): Query<DeviceIdQuery>,
    Json(req): Json<DeviceLayoutRequest>,
) -> impl IntoResponse {
    let slot = match resolve_slot(&app, &q) {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };
    match slot.switch_layout(&app.compiled_dir, req.layout_id).await {
        Ok(()) => {
            let mut rec = slot.record_snapshot();
            rec.layout_id = slot.state.read().await.layout_id.clone();
            let _ = app.with_registry_mut(|reg| {
                reg.upsert(rec.clone(), &app.compiled_dir)?;
                Ok(())
            });
            slot.update_record(rec);
            let s = slot.state.read().await;
            (StatusCode::OK, Json(state_response(&slot, &s))).into_response()
        }
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!("{e:#}"),
            }),
        )
            .into_response(),
    }
}

async fn get_layout_uv(
    app: SharedState,
    Query(q): Query<DeviceIdQuery>,
) -> impl IntoResponse {
    let slot = match resolve_slot(&app, &q) {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };
    let layout_id = {
        let s = slot.state.read().await;
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

async fn post_mode(
    app: SharedState,
    Query(q): Query<DeviceIdQuery>,
    Json(req): Json<ModeRequest>,
) -> impl IntoResponse {
    let slot = match resolve_slot(&app, &q) {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };
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
        slot.clear_sequence().await;
    }
    slot.set_output_mode(mode).await;
    if mode == OutputMode::Mate {
        let (layout_id, led_count) = {
            let s = slot.state.read().await;
            (s.layout_id.clone(), s.led_count as usize)
        };
        if let Err(e) = slot.ensure_interactive_uv(&app.compiled_dir, &layout_id, led_count) {
            tracing::warn!("mate: ensure_interactive_uv failed: {e:#}");
        }
    }
    let s = slot.state.read().await;
    (StatusCode::OK, Json(state_response(&slot, &s))).into_response()
}

fn state_response(slot: &DeviceSlot, s: &RuntimeState) -> StateResponse {
    let mate = if s.mode == "mate" {
        Some(slot.mate_summary())
    } else {
        None
    };
    StateResponse {
        device_id: slot.id(),
        layout_id: s.layout_id.clone(),
        mode: s.mode.clone(),
        fps_out: slot.metrics.fps_out(),
        fps_rx: s.fps_rx,
        esp_frames_complete: s.esp_frames_complete,
        esp_rssi: s.esp_rssi,
        esp_drops: s.esp_drops,
        esp_status_addr: s.esp_status_addr.clone(),
        output_target_addr: s.output_target_addr.clone(),
        led_count: s.led_count,
        loop_sequence_id: s.loop_sequence_id.clone(),
        uptime_sec: s.uptime_sec(),
        frame_loop_stale_ms: slot.metrics.frame_loop_stale_ms(),
        layout_mismatch: s.layout_mismatch,
        frames_sent: slot.metrics.frames_sent(),
        master_brightness: f64::from(slot.master_brightness()),
        master_gamma: f64::from(slot.master_gamma()),
        loop_source_frame: slot.metrics.loop_source_frame(),
        mate,
        loop_playback_paused: slot.loop_playback_paused(),
    }
}

async fn post_loop_select(
    app: SharedState,
    Query(q): Query<DeviceIdQuery>,
    Json(req): Json<LoopSelectRequest>,
) -> impl IntoResponse {
    let slot = match resolve_slot(&app, &q) {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };
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
        let s = slot.state.read().await;
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

    slot.set_sequence(sequence).await;
    slot.set_output_mode(OutputMode::Loop).await;
    let s = slot.state.read().await;
    (StatusCode::OK, Json(state_response(&slot, &s))).into_response()
}

async fn post_loop_clear_selection(
    app: SharedState,
    Query(q): Query<DeviceIdQuery>,
) -> impl IntoResponse {
    let slot = match resolve_slot(&app, &q) {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };
    slot.clear_sequence().await;
    slot.set_output_mode(OutputMode::Loop).await;
    let s = slot.state.read().await;
    (StatusCode::OK, Json(state_response(&slot, &s))).into_response()
}

async fn post_loop_pause(
    app: SharedState,
    Query(q): Query<DeviceIdQuery>,
    Json(req): Json<LoopPauseRequest>,
) -> impl IntoResponse {
    let slot = match resolve_slot(&app, &q) {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };
    if req.paused {
        slot.pause_loop_playback();
    } else {
        slot.resume_loop_playback();
    }
    let s = slot.state.read().await;
    (StatusCode::OK, Json(state_response(&slot, &s))).into_response()
}

async fn post_master_tone(
    app: SharedState,
    Query(q): Query<DeviceIdQuery>,
    Json(req): Json<MasterToneRequest>,
) -> impl IntoResponse {
    let slot = match resolve_slot(&app, &q) {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };
    slot.set_master_tone(req.brightness as f32, req.gamma as f32);
    let s = slot.state.read().await;
    (StatusCode::OK, Json(state_response(&slot, &s))).into_response()
}

async fn post_mate_state(
    app: SharedState,
    Query(q): Query<DeviceIdQuery>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let slot = match resolve_slot(&app, &q) {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };
    if slot.output_mode() != OutputMode::Mate {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "mate state applies only in output mode \"mate\"".to_string(),
            }),
        )
            .into_response();
    }
    if let Err(e) = slot.mate_apply_json(&req) {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: e,
            }),
        )
            .into_response();
    }
    let s = slot.state.read().await;
    (StatusCode::OK, Json(state_response(&slot, &s))).into_response()
}

async fn get_devices(app: SharedState) -> impl IntoResponse {
    match app.registry_snapshot() {
        Ok(reg) => (
            StatusCode::OK,
            Json(DeviceListResponse {
                default_device_id: app.default_device_id.clone(),
                devices: reg.devices().to_vec(),
                created_device_id: None,
            }),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error: e }),
        )
            .into_response(),
    }
}

async fn get_devices_discovered(app: SharedState) -> impl IntoResponse {
    let discovered = tokio::task::spawn_blocking(|| discover::glowbe_udp_all(Duration::from_secs(8)))
        .await
        .unwrap_or_default();
    let merged = match app.registry_snapshot() {
        Ok(reg) => reg.merge_discovered(&discovered),
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse { error: e }),
            )
                .into_response();
        }
    };
    (StatusCode::OK, Json(merged)).into_response()
}

async fn post_device(
    app: SharedState,
    Json(req): Json<DeviceCreateRequest>,
) -> impl IntoResponse {
    let rec = DeviceRecord {
        id: crate::devices::new_device_id(),
        display_name: req.display_name,
        esp_ip: req.esp_ip,
        mdns_hostname: req.mdns_hostname,
        layout_id: req.layout_id,
    };
    if let Err(e) = app.with_registry_mut(|reg| {
        reg.upsert(rec.clone(), &app.compiled_dir)?;
        Ok(())
    }) {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse { error: e }),
        )
            .into_response();
    }
    let created_id = rec.id.clone();
    if let Err(e) = app.upsert_device_slot(rec, &app.default_mode) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error: e }),
        )
            .into_response();
    }
    match app.registry_snapshot() {
        Ok(reg) => (
            StatusCode::CREATED,
            Json(DeviceListResponse {
                default_device_id: app.default_device_id.clone(),
                devices: reg.devices().to_vec(),
                created_device_id: Some(created_id),
            }),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error: e }),
        )
            .into_response(),
    }
}

async fn patch_device(
    app: SharedState,
    Path(device_id): Path<String>,
    Json(req): Json<DeviceUpdateRequest>,
) -> impl IntoResponse {
    if !crate::devices::is_uuid_v7(&device_id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "device id must be UUID version 7".into(),
            }),
        )
            .into_response();
    }
    let slot = match app.device(&device_id) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse { error: e }),
            )
                .into_response();
        }
    };
    let old_layout = slot.state.read().await.layout_id.clone();
    let rec = DeviceRecord {
        id: device_id,
        display_name: req.display_name,
        esp_ip: req.esp_ip,
        mdns_hostname: req.mdns_hostname,
        layout_id: req.layout_id,
    };
    if let Err(e) = app.with_registry_mut(|reg| {
        reg.upsert(rec.clone(), &app.compiled_dir)?;
        Ok(())
    }) {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse { error: e }),
        )
            .into_response();
    }
    slot.update_record(rec.clone());
    slot.bump_output_send_epoch();
    if old_layout != rec.layout_id {
        if let Err(e) = slot.switch_layout(&app.compiled_dir, rec.layout_id).await {
            return (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: format!("{e:#}"),
                }),
            )
                .into_response();
        }
    }
    match app.registry_snapshot() {
        Ok(reg) => (
            StatusCode::OK,
            Json(DeviceListResponse {
                default_device_id: app.default_device_id.clone(),
                devices: reg.devices().to_vec(),
                created_device_id: None,
            }),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error: e }),
        )
            .into_response(),
    }
}

async fn delete_device(app: SharedState, Path(device_id): Path<String>) -> impl IntoResponse {
    if let Err(e) = app.with_registry_mut(|reg| {
        reg.remove(&device_id)?;
        Ok(())
    }) {
        let code = if e.contains("not found") {
            StatusCode::NOT_FOUND
        } else {
            StatusCode::BAD_REQUEST
        };
        return (code, Json(ErrorResponse { error: e })).into_response();
    }
    if let Err(e) = app.remove_device_slot(&device_id) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error: e }),
        )
            .into_response();
    }
    StatusCode::NO_CONTENT.into_response()
}

async fn health(app: SharedState) -> impl IntoResponse {
    const STALE_MS: u64 = 1000;
    let stale = app.devices_ordered().iter().all(|slot| {
        slot.metrics.frame_loop_stale_ms() > STALE_MS
    });
    if stale && !app.devices_ordered().is_empty() {
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
            let dyn_ = crate::output::ring_dynamics(ring_speed, ring_thickness_rad);
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
