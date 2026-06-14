use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use image::codecs::jpeg::JpegEncoder;
use image::{ExtendedColorType, ImageEncoder};
use tokio::net::UdpSocket;
use tracing::{debug, info, warn};

use crate::config::Config;
use crate::discover;
use crate::pattern;
use crate::state::{OutputMode, PreviewFrame, RipplePulse, SharedState};
use crate::wire;

async fn resolve_esp_socket(config: &Config) -> Result<SocketAddr> {
    if let Some(host) = config.device.esp_ip_host() {
        let addr: SocketAddr = format!("{}:{}", host, config.output.udp_port)
            .parse()
            .with_context(|| {
                format!(
                    "invalid device.esp_ip / port: {host}:{}",
                    config.output.udp_port
                )
            })?;
        return Ok(addr);
    }
    let found = tokio::task::spawn_blocking(discover::glowbe_udp_first_ipv4)
        .await
        .context("mDNS task join")?
        .context("mDNS: no _glowbe._udp service resolved (is ESP on same LAN?)")?;
    Ok(found)
}

pub async fn run(config: Config, app: SharedState, meta_path: PathBuf) -> Result<()> {
    let meta: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(&meta_path)
            .with_context(|| format!("read layout meta {}", meta_path.display()))?,
    )?;
    let led_count = meta["ledCount"].as_u64().context("ledCount in meta")? as u16;

    let status_port = config.output.status_port;
    tokio::spawn(status_listener(status_port, app.clone()));

    let frame_interval = Duration::from_secs_f64(1.0 / config.output.target_fps as f64);
    let mut rgb = vec![0u8; led_count as usize * 3];
    let mut frame_id = 0u32;
    let loop_start = Instant::now();
    let mut reconnect_backoff = Duration::from_millis(500);

    loop {
        let esp_addr = match resolve_esp_socket(&config).await {
            Ok(a) => a,
            Err(e) => {
                warn!("resolve ESP: {e:#}; retry in 2s");
                tokio::time::sleep(Duration::from_secs(2)).await;
                continue;
            }
        };

        let sock = match UdpSocket::bind("0.0.0.0:0").await {
            Ok(s) => s,
            Err(e) => {
                warn!("udp bind 0.0.0.0:0 failed: {e}; retry");
                tokio::time::sleep(reconnect_backoff).await;
                continue;
            }
        };
        if let Err(e) = sock.connect(esp_addr).await {
            warn!("udp connect {esp_addr} failed: {e}; retry");
            tokio::time::sleep(reconnect_backoff).await;
            continue;
        }

        info!(
            "output -> {} @ {} fps ({} LEDs)",
            esp_addr, config.output.target_fps, led_count
        );
        app.set_output_target_addr(esp_addr.to_string()).await;
        reconnect_backoff = Duration::from_millis(500);

        let mut sent_window = 0u64;
        let mut window_start = Instant::now();
        let mut ticker = tokio::time::interval(frame_interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut consecutive_frame_failures: u32 = 0;

        let mut last_preview_wall = Instant::now() - Duration::from_secs(60);

        'session: loop {
            ticker.tick().await;
            app.metrics.mark_tick();
            app.clear_expired_ripple();

            let t_ms = loop_start.elapsed().as_millis() as u32;
            match app.output_mode() {
                OutputMode::Idle | OutputMode::Ripple => rgb.fill(0),
                OutputMode::Loop => {
                    if let Some(sequence) = app.selected_sequence() {
                        if let Err(e) = sequence.copy_frame_at(loop_start.elapsed(), &mut rgb) {
                            warn!("sequence frame copy failed; falling back to pattern: {e:#}");
                            pattern::fill_loop_rgb(led_count as usize, t_ms, &mut rgb);
                        }
                    } else {
                        pattern::fill_loop_rgb(led_count as usize, t_ms, &mut rgb);
                    }
                }
            }

            if app.output_mode() == OutputMode::Ripple {
                try_apply_ripple_overlay(&app, &mut rgb);
            }

            if app.preview_tx.receiver_count() > 0 && last_preview_wall.elapsed() >= Duration::from_millis(500) {
                last_preview_wall = Instant::now();
                let q = app.preview_quality();
                if let Ok(jpeg) = encode_preview_jpeg(&rgb, q) {
                    let frame = Arc::new(PreviewFrame {
                        seq: frame_id as u64,
                        jpeg,
                    });
                    let _ = app.preview_tx.send(frame);
                }
            }

            let mut full_send_ok = true;
            for pkt in wire::encode_frame(led_count, frame_id, &rgb) {
                if let Err(e) = sock.send(&pkt).await {
                    warn!("udp send failed (dropping rest of frame): {e}");
                    full_send_ok = false;
                    break;
                }
            }

            frame_id = frame_id.wrapping_add(1);

            if full_send_ok {
                consecutive_frame_failures = 0;
                reconnect_backoff = Duration::from_millis(500);
                app.metrics.increment_frames_sent();
                sent_window += 1;
                if window_start.elapsed() >= Duration::from_secs(1) {
                    let fps = sent_window as f64 / window_start.elapsed().as_secs_f64();
                    app.metrics.set_fps_out(fps);
                    sent_window = 0;
                    window_start = Instant::now();
                }
            } else {
                consecutive_frame_failures += 1;
                if consecutive_frame_failures >= 60 {
                    warn!("udp: {consecutive_frame_failures} consecutive failed frames; reconnect");
                    break 'session;
                }
            }
        }

        tokio::time::sleep(reconnect_backoff).await;
        reconnect_backoff = (reconnect_backoff * 2).min(Duration::from_secs(5));
    }
}

async fn status_listener(port: u16, app: SharedState) {
    let bind_addr = format!("0.0.0.0:{port}");
    let sock = match UdpSocket::bind(&bind_addr).await {
        Ok(s) => s,
        Err(e) => {
            warn!("status bind {bind_addr} failed: {e}");
            return;
        }
    };
    info!("status listen {bind_addr}");

    let expected = app.expected_layout_hash;
    let mut buf = [0u8; 128];
    loop {
        match sock.recv_from(&mut buf).await {
            Ok((n, from)) => {
                if let Some(st) = wire::parse_status(&buf[..n]) {
                    debug!(
                        frames = st.frames_complete,
                        fps_rx = st.fps_rx(),
                        drops = st.drops,
                        rssi = st.rssi,
                        layout_hash = ?st.layout_hash,
                    );
                    let mismatch = match (expected, st.layout_hash) {
                        (Some(exp), Some(esp_h)) if exp != esp_h => {
                            warn!(
                                esp_layout_hash = format!("0x{esp_h:08x}"),
                                expected_layout_hash = format!("0x{exp:08x}"),
                                "STATUS layout hash mismatch"
                            );
                            true
                        }
                        (Some(_), Some(_)) => false,
                        (None, Some(esp_h)) => {
                            debug!(
                                esp_layout_hash = format!("0x{esp_h:08x}"),
                                "runtime meta has no layoutHash; skipping mismatch check"
                            );
                            false
                        }
                        _ => false,
                    };

                    let mut s = app.state.write().await;
                    s.fps_rx = Some(st.fps_rx());
                    s.esp_frames_complete = Some(st.frames_complete);
                    s.esp_rssi = Some(st.rssi);
                    s.esp_drops = Some(st.drops);
                    s.esp_status_addr = Some(from.to_string());
                    s.layout_mismatch = mismatch;
                }
            }
            Err(e) => {
                warn!("status recv: {e}");
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        }
    }
}

fn try_apply_ripple_overlay(app: &SharedState, rgb: &mut [u8]) {
    let uv_lock = app.ripple_uv.read().ok();
    let pulse_lock = app.ripple_pulse.read().ok();
    let Some(uv) = uv_lock.as_ref().and_then(|g| g.as_ref()) else {
        return;
    };
    let Some(pulse) = pulse_lock.as_ref().and_then(|g| g.as_ref()) else {
        return;
    };
    if uv.len() * 3 != rgb.len() {
        return;
    }
    let now = Instant::now();
    if now >= pulse.started + pulse.duration {
        return;
    }
    apply_ripple_blend(rgb, uv, pulse, now);
}

fn apply_ripple_blend(rgb: &mut [u8], uv: &[(f32, f32)], pulse: &RipplePulse, now: Instant) {
    let t = (now - pulse.started).as_secs_f32() / pulse.duration.as_secs_f32().max(1e-6);
    let decay = (1.0 - t).clamp(0.0, 1.0);
    let amp = pulse.amplitude.clamp(0.0, 4.0) * decay;
    if amp <= 0.0 {
        return;
    }
    const SIGMA: f32 = 0.11;
    let inv_2s2 = 1.0 / (2.0 * SIGMA * SIGMA);

    for (i, &(u, v)) in uv.iter().enumerate() {
        let du = (u - pulse.center_u).abs();
        let du = du.min(1.0 - du);
        let dv = v - pulse.center_v;
        let dist2 = du * du + dv * dv;
        let wave = (-dist2 * inv_2s2).exp() * amp;
        if wave <= 0.001 {
            continue;
        }
        let k = (wave * 220.0).min(220.0) as u16;
        let o = i * 3;
        rgb[o] = rgb[o].saturating_add((k * 200 / 220) as u8);
        rgb[o + 1] = rgb[o + 1].saturating_add((k * 240 / 220) as u8);
        rgb[o + 2] = rgb[o + 2].saturating_add((k * 255 / 220) as u8);
    }
}

fn encode_preview_jpeg(rgb: &[u8], quality: u8) -> Result<Vec<u8>> {
    let led_n = rgb.len() / 3;
    let w = led_n.min(2048) as u32;
    let h = 24u32;
    let mut buf_img = vec![0u8; (w * h * 3) as usize];
    for y in 0..h {
        for x in 0..w {
            let led = x as usize;
            if led < led_n {
                let ro = led * 3;
                let o = ((y * w + x) * 3) as usize;
                buf_img[o] = rgb[ro];
                buf_img[o + 1] = rgb[ro + 1];
                buf_img[o + 2] = rgb[ro + 2];
            }
        }
    }
    let mut out = Vec::new();
    let enc = JpegEncoder::new_with_quality(&mut out, quality.clamp(1, 95));
    enc.write_image(&buf_img, w, h, ExtendedColorType::Rgb8)?;
    Ok(out)
}
