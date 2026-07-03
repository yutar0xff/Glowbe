use std::collections::HashSet;
use std::net::SocketAddr;
use std::sync::atomic::Ordering;
use std::sync::{LazyLock, Mutex, OnceLock};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use tokio::net::UdpSocket;
use tracing::{debug, info, warn};

use crate::config::Config;
use crate::device_slot::DeviceSlot;
use crate::devices::{self, DeviceRecord};
use crate::discover;
use crate::pattern;
use crate::sphere::{angle_rad_between_unit, unit_dir_from_equirect_uv_y_up};
use crate::state::{InteractiveEffectKind, InteractivePulse, OutputMode, SharedState};
use crate::wire;

static OUTPUT_CONFIG: OnceLock<Config> = OnceLock::new();
static OUTPUT_LOOPS_STARTED: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

/// 起動済み output ループが無ければデバイス用タスクを spawn する（`POST /devices` 用）。
pub fn ensure_device_output_loop(app: &SharedState, device_id: &str) -> bool {
    let config = match OUTPUT_CONFIG.get() {
        Some(c) => c.clone(),
        None => return false,
    };
    let slot = match app.device(device_id) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let mut started = match OUTPUT_LOOPS_STARTED.lock() {
        Ok(g) => g,
        Err(_) => return false,
    };
    if !started.insert(device_id.to_string()) {
        return true;
    }
    drop(started);
    let app2 = app.clone();
    let id = device_id.to_string();
    tokio::spawn(async move {
        if let Err(e) = device_output_loop(config, app2, slot).await {
            tracing::error!("device {id} output loop ended: {e:#}");
        }
    });
    true
}

async fn resolve_esp_socket(config: &Config, record: &DeviceRecord) -> Result<SocketAddr> {
    if let Some(host) = record.esp_ip_host() {
        let addr: SocketAddr = format!("{}:{}", host, config.output.udp_port)
            .parse()
            .with_context(|| format!("invalid esp_ip / port: {host}:{}", config.output.udp_port))?;
        return Ok(addr);
    }
    if let Some(hostname) = record.mdns_host() {
        let found = tokio::task::spawn_blocking({
            let hostname = hostname.to_string();
            move || {
                discover::glowbe_udp_all(Duration::from_secs(8))
                    .into_iter()
                    .find(|s| devices::mdns_hosts_match(&s.hostname, &hostname))
                    .map(|s| s.addr)
            }
        })
        .await
        .context("mDNS task join")?;
        if let Some(addr) = found {
            return Ok(addr);
        }
        anyhow::bail!("mDNS: no service for hostname {hostname}");
    }
    let found = tokio::task::spawn_blocking(discover::glowbe_udp_first_ipv4)
        .await
        .context("mDNS task join")?
        .context("mDNS: no _glowbe._udp service resolved (set espIp or mdnsHostname)")?;
    Ok(found)
}

async fn wire_frame_id_baseline(slot: &DeviceSlot) -> u32 {
    for _ in 0..30 {
        {
            let s = slot.state.read().await;
            if let Some(n) = s.esp_frames_complete {
                return DeviceSlot::wire_frame_id_from_status(Some(n));
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    0
}

fn frame_id_before(a: u32, b: u32) -> bool {
    a != b && (a.wrapping_sub(b) as i32) < 0
}

async fn send_link_mode(sock: &UdpSocket, active: bool) {
    let pkt = wire::encode_link(active);
    if let Err(e) = sock.send(&pkt).await {
        warn!("udp link mode send failed: {e}");
    }
}

pub async fn run(config: Config, app: SharedState) -> Result<()> {
    let _ = OUTPUT_CONFIG.set(config.clone());
    let status_port = config.output.status_port;
    tokio::spawn(status_listener(status_port, app.clone()));

    let slots = app.devices_ordered();
    if slots.is_empty() {
        anyhow::bail!("no devices registered");
    }
    for slot in &slots {
        ensure_device_output_loop(&app, &slot.id());
    }
    std::future::pending::<()>().await;
    Ok(())
}

async fn device_output_loop(
    config: Config,
    app: SharedState,
    slot: std::sync::Arc<DeviceSlot>,
) -> Result<()> {
    let device_id = slot.id();
    let mut frame_id: u32 = 0;
    let mut frame_id_seeded = false;
    let loop_start = Instant::now();
    let mut reconnect_backoff = Duration::from_millis(500);

    let (mut led_count, mut rgb) = {
        let s = slot.state.read().await;
        let lc = s.led_count;
        (lc, vec![0u8; lc as usize * 3])
    };
    let mut layout_uv_layout_cache: Option<String> = None;
    let mut layout_uv_yaw_cache: f32 = f32::NAN;

    loop {
        let record = slot.record_snapshot();
        let target_fps = record.output_fps;
        let frame_interval = Duration::from_secs_f64(1.0 / target_fps as f64);
        let esp_addr = match resolve_esp_socket(&config, &record).await {
            Ok(a) => a,
            Err(e) => {
                warn!("device {device_id}: resolve ESP: {e:#}; retry in 2s");
                tokio::time::sleep(Duration::from_secs(2)).await;
                continue;
            }
        };

        let sock = match UdpSocket::bind("0.0.0.0:0").await {
            Ok(s) => s,
            Err(e) => {
                warn!("device {device_id}: udp bind failed: {e}; retry");
                tokio::time::sleep(reconnect_backoff).await;
                continue;
            }
        };
        if let Err(e) = sock.connect(esp_addr).await {
            warn!("device {device_id}: udp connect {esp_addr} failed: {e}; retry");
            tokio::time::sleep(reconnect_backoff).await;
            continue;
        }

        let baseline = wire_frame_id_baseline(&slot).await;
        if !frame_id_seeded {
            frame_id = baseline;
            frame_id_seeded = true;
        } else if frame_id_before(frame_id, baseline) {
            frame_id = baseline;
        }
        info!(
            "device {device_id} output -> {} @ {target_fps} fps ({} LEDs, frame_id={frame_id})",
            esp_addr, led_count
        );
        slot.set_output_target_addr(esp_addr.to_string()).await;
        reconnect_backoff = Duration::from_millis(500);

        let session_esp_ip = record.esp_ip_host().map(str::to_string);
        let session_mdns = record.mdns_host().map(str::to_string);
        let mut session_output_fps = target_fps;

        let mut last_sent_rgb: Option<Vec<u8>> = None;
        let mut last_send_epoch = slot.output_send_epoch();
        let mut force_sends_after_epoch: u8 = 0;
        let mut idle_link_economy_sent = false;

        let mut sent_window = 0u64;
        let mut window_start = Instant::now();
        let mut ticker = tokio::time::interval(frame_interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut consecutive_frame_failures: u32 = 0;

        'session: loop {
            ticker.tick().await;

            let rec = slot.record_snapshot();
            let cur_ip = rec.esp_ip_host().map(str::to_string);
            let cur_mdns = rec.mdns_host().map(str::to_string);
            if cur_ip != session_esp_ip || cur_mdns != session_mdns {
                warn!("device {device_id}: connection target changed; reconnecting");
                break 'session;
            }
            if rec.output_fps != session_output_fps {
                info!(
                    "device {device_id}: output_fps changed {session_output_fps} -> {}",
                    rec.output_fps
                );
                session_output_fps = rec.output_fps;
                let frame_interval = Duration::from_secs_f64(1.0 / session_output_fps as f64);
                ticker = tokio::time::interval(frame_interval);
                ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                sent_window = 0;
                window_start = Instant::now();
                last_sent_rgb = None;
                force_sends_after_epoch = 4;
                idle_link_economy_sent = false;
                send_link_mode(&sock, true).await;
                continue;
            }

            slot.metrics.mark_tick();
            slot.clear_expired_interactive_pulses();

            let (layout_id, lc) = {
                let s = slot.state.read().await;
                (s.layout_id.clone(), s.led_count)
            };
            let front_yaw = rec.front_yaw_deg as f32;
            let layout_changed =
                layout_uv_layout_cache.as_deref() != Some(layout_id.as_str()) || lc != led_count;
            let yaw_changed = layout_uv_yaw_cache.to_bits() != front_yaw.to_bits();
            if layout_changed || yaw_changed {
                if layout_changed {
                    led_count = lc;
                    rgb.resize(led_count as usize * 3, 0);
                    layout_uv_layout_cache = Some(layout_id.clone());
                }
                last_sent_rgb = None;
                force_sends_after_epoch = 4;
                layout_uv_yaw_cache = front_yaw;
                if let Err(e) =
                    slot.ensure_layout_uv(&app.compiled_dir, &layout_id, led_count as usize)
                {
                    warn!(
                        "device {device_id}: ledmap load failed for {}: {e:#}",
                        layout_id
                    );
                }
            }
            let layout_uv = slot.layout_uv_table();

            let raw_elapsed = loop_start.elapsed();
            slot.record_loop_raw_tick(raw_elapsed);
            let clip_elapsed = slot.clip_elapsed_for_loop(raw_elapsed);
            let t_ms = raw_elapsed.as_millis() as u32;
            let output_mode = slot.output_mode();
            if output_mode != OutputMode::Idle {
                idle_link_economy_sent = false;
            }
            match output_mode {
                OutputMode::Idle => {
                    slot.metrics.set_loop_source_frame(None);
                    rgb.fill(0);
                }
                OutputMode::Interactive => {
                    slot.metrics.set_loop_source_frame(None);
                    slot.fill_interactive_base(&mut rgb);
                }
                OutputMode::Loop => {
                    if let Some(clip) = slot.selected_clip() {
                        if let Some(ref uv) = layout_uv {
                            match clip.sample_into(clip_elapsed, uv, &mut rgb) {
                                Ok(()) => {
                                    slot.metrics.set_loop_source_frame(
                                        clip.source_frame_index_at(clip_elapsed),
                                    );
                                }
                                Err(e) => {
                                    slot.metrics.set_loop_source_frame(None);
                                    warn!("device {device_id}: clip sample failed: {e:#}");
                                    pattern::fill_loop_rgb(t_ms, &mut rgb, layout_uv.as_deref());
                                }
                            }
                        } else {
                            slot.metrics.set_loop_source_frame(None);
                            pattern::fill_loop_rgb(t_ms, &mut rgb, None);
                        }
                    } else {
                        slot.metrics.set_loop_source_frame(None);
                        pattern::fill_loop_rgb(t_ms, &mut rgb, layout_uv.as_deref());
                    }
                }
                OutputMode::Mate => {
                    slot.metrics.set_loop_source_frame(None);
                    if let Err(e) = slot.ensure_mate_samples(&app.compiled_dir, &layout_id) {
                        warn!("device {device_id}: mate samples: {e:#}");
                        rgb.fill(0);
                    } else {
                        slot.render_mate(&mut rgb);
                    }
                }
                OutputMode::Text => {
                    slot.metrics.set_loop_source_frame(None);
                    if let Some(ref uv) = layout_uv {
                        slot.render_text(
                            app.text_font.as_deref(),
                            &layout_id,
                            uv,
                            loop_start + raw_elapsed,
                            &mut rgb,
                        );
                    } else {
                        rgb.fill(0);
                    }
                }
            }

            if output_mode == OutputMode::Interactive {
                try_apply_interactive_overlay(&slot, &mut rgb);
            }

            if let Ok(mut w) = slot.preview_frame.try_write() {
                if w.len() == rgb.len() {
                    w.copy_from_slice(&rgb);
                    slot.preview_seq.fetch_add(1, Ordering::Release);
                }
            }

            apply_master_tone(&slot, &mut rgb);

            let send_epoch = slot.output_send_epoch();
            if send_epoch != last_send_epoch {
                last_send_epoch = send_epoch;
                last_sent_rgb = None;
                force_sends_after_epoch = 4;
                idle_link_economy_sent = false;
                send_link_mode(&sock, true).await;
            }

            let unchanged = last_sent_rgb.as_deref() == Some(rgb.as_slice());
            if !unchanged || force_sends_after_epoch > 0 {
                let mut full_send_ok = true;
                for pkt in wire::encode_frame(led_count, frame_id, &rgb) {
                    if let Err(e) = sock.send(&pkt).await {
                        warn!("device {device_id}: udp send failed: {e}");
                        full_send_ok = false;
                        break;
                    }
                }

                if full_send_ok {
                    consecutive_frame_failures = 0;
                    reconnect_backoff = Duration::from_millis(500);
                    slot.metrics.increment_frames_sent();
                    sent_window += 1;
                    match &mut last_sent_rgb {
                        Some(buf) if buf.len() == rgb.len() => buf.copy_from_slice(&rgb),
                        _ => last_sent_rgb = Some(rgb.clone()),
                    }
                    frame_id = frame_id.wrapping_add(1);
                    if force_sends_after_epoch > 0 {
                        force_sends_after_epoch = force_sends_after_epoch.saturating_sub(1);
                    }
                } else {
                    consecutive_frame_failures += 1;
                    if consecutive_frame_failures >= 60 {
                        warn!("device {device_id}: udp failures; reconnect");
                        break 'session;
                    }
                }
            } else if output_mode == OutputMode::Idle && !idle_link_economy_sent {
                send_link_mode(&sock, false).await;
                idle_link_economy_sent = true;
            }

            if window_start.elapsed() >= Duration::from_secs(1) {
                let fps = if sent_window == 0 {
                    0.0
                } else {
                    sent_window as f64 / window_start.elapsed().as_secs_f64()
                };
                slot.metrics.set_fps_out(fps);
                sent_window = 0;
                window_start = Instant::now();
                if let Some(esp_fc) = slot.state.read().await.esp_frames_complete {
                    let baseline = esp_fc.wrapping_add(1);
                    if frame_id_before(frame_id, baseline) {
                        frame_id = baseline;
                    }
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
                    let from_ip = from.ip().to_string();
                    if let Some(slot) = app.find_device_by_status_ip(&from_ip) {
                        let expected = slot.expected_layout_hash.read().ok().and_then(|g| *g);
                        let mismatch = match (expected, st.layout_hash) {
                            (Some(exp), Some(esp_h)) if exp != esp_h => {
                                warn!(
                                    device = %slot.id(),
                                    esp_layout_hash = format!("0x{esp_h:08x}"),
                                    expected_layout_hash = format!("0x{exp:08x}"),
                                    "STATUS layout hash mismatch (flash firmware for this layout)"
                                );
                                true
                            }
                            (Some(exp), None) => {
                                warn!(
                                    device = %slot.id(),
                                    expected_layout_hash = format!("0x{exp:08x}"),
                                    "STATUS has no layout hash; cannot verify firmware layout"
                                );
                                false
                            }
                            (Some(_), Some(_)) => false,
                            (None, Some(esp_h)) => {
                                debug!(
                                    device = %slot.id(),
                                    esp_layout_hash = format!("0x{esp_h:08x}"),
                                    "runtime meta has no layoutHash; skipping mismatch check"
                                );
                                false
                            }
                            _ => false,
                        };
                        slot.apply_status(from.to_string(), &st, mismatch).await;
                    } else {
                        debug!(from = %from, "STATUS from unregistered ESP");
                    }
                }
            }
            Err(e) => {
                warn!("status recv: {e}");
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        }
    }
}

fn try_apply_interactive_overlay(slot: &DeviceSlot, rgb: &mut [u8]) {
    let uv_lock = slot.layout_uv.read().ok();
    let pulse_lock = slot.interactive_pulses.read().ok();
    let Some(uv) = uv_lock.as_ref().and_then(|g| g.as_ref()) else {
        return;
    };
    let Some(pulses) = pulse_lock.as_ref() else {
        return;
    };
    if uv.len() * 3 != rgb.len() {
        return;
    }
    let now = Instant::now();
    let mut acc = vec![0f32; rgb.len()];
    for pulse in pulses.iter() {
        if now >= pulse.started + pulse.duration {
            continue;
        }
        match pulse.effect {
            InteractiveEffectKind::SphereGaussian => {
                apply_interactive_sphere_gaussian(&mut acc, uv, pulse, now);
            }
            InteractiveEffectKind::ExpandingRingDiagonal => {
                apply_interactive_expanding_ring_diagonal(&mut acc, uv, pulse, now);
            }
        }
    }
    blend_interactive_accum(rgb, &acc);
}

fn blend_interactive_accum(rgb: &mut [u8], acc: &[f32]) {
    debug_assert_eq!(rgb.len(), acc.len());
    let mut any = false;
    for v in acc.iter() {
        if *v > 1e-8 {
            any = true;
            break;
        }
    }
    if !any {
        return;
    }
    for i in (0..rgb.len()).step_by(3) {
        let br_lin = srgb_byte_to_linear(rgb[i]);
        let bg_lin = srgb_byte_to_linear(rgb[i + 1]);
        let bb_lin = srgb_byte_to_linear(rgb[i + 2]);
        let mut r_lin = br_lin + acc[i];
        let mut g_lin = bg_lin + acc[i + 1];
        let mut b_lin = bb_lin + acc[i + 2];
        let m = r_lin.max(g_lin).max(b_lin);
        if m > 1.0 {
            let s = 1.0 / m;
            r_lin *= s;
            g_lin *= s;
            b_lin *= s;
        }
        rgb[i] = linear_to_srgb_u8(r_lin);
        rgb[i + 1] = linear_to_srgb_u8(g_lin);
        rgb[i + 2] = linear_to_srgb_u8(b_lin);
    }
}

/// sRGB エンコード 0–255 → 線形 0–1（加算混色用）
#[inline]
pub(crate) fn srgb_byte_to_linear(c: u8) -> f32 {
    let s = c as f32 / 255.0;
    if s <= 0.04045 {
        s / 12.92
    } else {
        ((s + 0.055) / 1.055).powf(2.4)
    }
}

#[inline]
pub(crate) fn linear_to_srgb_u8(l: f32) -> u8 {
    let l = l.clamp(0.0, 1.0);
    let s = if l <= 0.0031308 {
        12.92 * l
    } else {
        1.055 * l.powf(1.0 / 2.4) - 0.055
    };
    (s * 255.0).round().clamp(0.0, 255.0) as u8
}

fn apply_master_tone(slot: &DeviceSlot, rgb: &mut [u8]) {
    let brightness = slot.master_brightness();
    let gamma = slot.master_gamma().max(0.001);
    for chunk in rgb.chunks_exact_mut(3) {
        for c in chunk.iter_mut() {
            let x = (*c as f32 / 255.0) * brightness;
            let y = x.max(0.0).powf(1.0 / gamma);
            *c = (y * 255.0).round().clamp(0.0, 255.0) as u8;
        }
    }
}

fn add_tinted_to_accum(acc: &mut [f32], led_i: usize, wave: f32, pr: u8, pg: u8, pb: u8) {
    if wave <= 1e-5 {
        return;
    }
    let o = led_i * 3;
    acc[o] += wave * srgb_byte_to_linear(pr);
    acc[o + 1] += wave * srgb_byte_to_linear(pg);
    acc[o + 2] += wave * srgb_byte_to_linear(pb);
}

pub fn apply_interactive_sphere_gaussian(
    acc: &mut [f32],
    uv: &[(f32, f32)],
    pulse: &InteractivePulse,
    now: Instant,
) {
    let t = (now - pulse.started).as_secs_f32() / pulse.duration.as_secs_f32().max(1e-6);
    let decay = (1.0 - t).clamp(0.0, 1.0);
    let amp = pulse.amplitude.clamp(0.0, 4.0) * decay;
    if amp <= 0.0 {
        return;
    }
    let inv_2s2 = 1.0 / (2.0 * pulse.sigma_rad * pulse.sigma_rad);

    let center_dir = unit_dir_from_equirect_uv_y_up(pulse.center_u, pulse.center_v);

    for (i, &(u, v)) in uv.iter().enumerate() {
        let dir = unit_dir_from_equirect_uv_y_up(u, v);
        let theta = angle_rad_between_unit(center_dir, dir);
        let dist2 = theta * theta;
        let wave = (-dist2 * inv_2s2).exp() * amp;
        add_tinted_to_accum(acc, i, wave, pulse.color_r, pulse.color_g, pulse.color_b);
    }
}

/// 拡大リップルの時間・空間ダイナミクス（パルス生成時の寿命算出と毎フレーム描画で共有）。
#[derive(Debug, Clone, Copy)]
pub struct RingDynamics {
    /// 波面の伝搬速度（rad/s）。球面上は等方。
    pub c: f32,
    /// 残光トレイルの時定数（s）。大きいほどゆっくり消える。
    pub tau: f32,
    /// 波面（バンド）の空間幅（rad）。
    pub edge_w: f32,
    /// パルス寿命（s）。波面が反対側へ到達 + トレイルが十分減衰するまで。
    pub lifetime: f32,
}

/// `ring_speed` と `ring_thickness_rad` からリング用の物理パラメータを導出する。
pub fn ring_dynamics(ring_speed: f32, ring_thickness_rad: f32) -> RingDynamics {
    let speed = ring_speed.clamp(0.12, 12.0);
    // 既定 speed=1 で π を渡り切るのに ~1.2s。
    let c = 2.6 * speed;
    let edge_w = if ring_thickness_rad > 1e-5 {
        ring_thickness_rad.clamp(0.025, 0.38)
    } else {
        // 既定は狭いリング（~3°）。広すぎると球全体が埋まって見える。
        0.052
    };
    let tau = (0.38 + edge_w * 1.0).clamp(0.12, 2.5);
    let pi = std::f32::consts::PI;
    let travel_full = pi / c.max(1e-3);
    let lifetime = (travel_full + tau * 5.0).clamp(0.25, 15.0);
    RingDynamics {
        c,
        tau,
        edge_w,
        lifetime,
    }
}

pub fn apply_interactive_expanding_ring_diagonal(
    acc: &mut [f32],
    uv: &[(f32, f32)],
    pulse: &InteractivePulse,
    now: Instant,
) {
    #[inline]
    fn smooth01(t: f32) -> f32 {
        let t = t.clamp(0.0, 1.0);
        t * t * (3.0 - 2.0 * t)
    }

    let elapsed = (now - pulse.started).as_secs_f32();
    let amp_base = pulse.amplitude.clamp(0.0, 4.0);
    if amp_base <= 0.0 {
        return;
    }
    let d = ring_dynamics(pulse.ring_speed, pulse.ring_thickness_rad);

    let center_dir = unit_dir_from_equirect_uv_y_up(pulse.center_u, pulse.center_v);

    // 波面（バンド）が空間幅 edge_w を渡る時間。
    let edge_t = (d.edge_w / d.c).max(1e-3);
    // クレストをわずかに太め（時間軸）にしてフレーム間で途切れにくくする
    let crest_t = edge_t * 1.22;
    const WAKE_FEATHER_S: f32 = 0.0045;

    for (i, &(u, v)) in uv.iter().enumerate() {
        let uu = u.rem_euclid(1.0);
        let vv = v.clamp(0.0, 1.0);
        let dir = unit_dir_from_equirect_uv_y_up(uu, vv);
        let theta = angle_rad_between_unit(center_dir, dir);

        // 到達時刻は大円角距離のみ（等方）。UV 対角で速度を変えると輪がちぎれて見える。
        let arrival = theta / d.c;
        let local = elapsed - arrival;

        // 波前未到達のなめらか化（幅 edge_w とは無関係の短いフェザー）
        let wake = smooth01((local + 2.0 * WAKE_FEATHER_S) / (2.0 * WAKE_FEATHER_S).max(1e-6));

        // 波面のクレスト（ガウス）＋ 直後の尾。
        let crest = (-((local / crest_t).powi(2))).exp();
        let trail = if local > 0.0 {
            let behind_rad = (d.c * local).max(0.0);
            let trail_angular = (d.edge_w * 3.0).max(0.045);
            let trail_geom = (-((behind_rad / trail_angular).powi(2))).exp();
            (-local / d.tau).exp() * trail_geom
        } else {
            0.0
        };
        let profile = crest.max(trail);

        let wave = profile * amp_base * wake;
        if wave <= 1e-4 {
            continue;
        }
        add_tinted_to_accum(acc, i, wave, pulse.color_r, pulse.color_g, pulse.color_b);
    }
}

/// 黒背景向け: interactive overlay と同じトーンマップで線形加算累積を sRGB へ。
pub fn finalize_linear_add_accum_black_base(acc: &[f32]) -> Vec<u8> {
    let mut rgb = vec![0u8; acc.len()];
    for i in (0..acc.len()).step_by(3) {
        let mut r_lin = acc[i];
        let mut g_lin = acc[i + 1];
        let mut b_lin = acc[i + 2];
        let m = r_lin.max(g_lin).max(b_lin);
        if m > 1.0 {
            let s = 1.0 / m;
            r_lin *= s;
            g_lin *= s;
            b_lin *= s;
        }
        rgb[i] = linear_to_srgb_u8(r_lin);
        rgb[i + 1] = linear_to_srgb_u8(g_lin);
        rgb[i + 2] = linear_to_srgb_u8(b_lin);
    }
    rgb
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{InteractiveEffectKind, InteractivePulse};
    use std::time::Duration;

    fn ring_pulse(speed: f32) -> InteractivePulse {
        InteractivePulse {
            center_u: 0.5,
            center_v: 0.5,
            amplitude: 1.0,
            sigma_rad: 0.14,
            effect: InteractiveEffectKind::ExpandingRingDiagonal,
            started: Instant::now(),
            duration: Duration::from_secs(10),
            color_r: 255,
            color_g: 0,
            color_b: 0,
            ring_speed: speed,
            ring_thickness_rad: 0.0,
        }
    }

    #[test]
    fn ring_wavefront_dims_gradually_not_instantly() {
        // 中心は輪が通過後に暗くなる。狭い時間窓ではクレストが滑らかに減衰する。
        let pulse = ring_pulse(1.0);
        let uv = vec![(0.5f32, 0.5f32)];
        let sample = |secs: f32| -> f32 {
            let mut acc = vec![0f32; 3];
            apply_interactive_expanding_ring_diagonal(
                &mut acc,
                &uv,
                &pulse,
                pulse.started + Duration::from_secs_f32(secs),
            );
            acc[0]
        };
        let a = sample(0.0);
        let b = sample(0.012);
        let c = sample(0.028);
        assert!(a > 0.0, "center lit at t=0");
        assert!(a > b && b > c, "smooth decay while crest passes center");
        assert!(c > 0.0, "still a thin tail, not instant off");
    }

    #[test]
    fn overlapping_red_and_green_blend_to_yellow() {
        // 同一 LED に赤と緑の尾が重なると acc に両成分が乗る（加算混色 → 黄）。
        let uv = vec![(0.5f32, 0.5f32)];
        let mut red = ring_pulse(1.0);
        red.color_r = 255;
        red.color_g = 0;
        red.color_b = 0;
        let mut green = ring_pulse(1.0);
        green.color_r = 0;
        green.color_g = 255;
        green.color_b = 0;

        let mut acc = vec![0f32; 3];
        let now = red.started + Duration::from_secs_f32(0.018);
        apply_interactive_expanding_ring_diagonal(&mut acc, &uv, &red, now);
        apply_interactive_expanding_ring_diagonal(&mut acc, &uv, &green, now);

        let mut rgb = vec![0u8; 3];
        blend_interactive_accum(&mut rgb, &acc);
        assert!(rgb[0] > 40, "red present");
        assert!(rgb[1] > 40, "green present");
        assert!(rgb[2] < 30, "little blue => yellow-ish");
    }
}
