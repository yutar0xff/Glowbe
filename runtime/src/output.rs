use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use tokio::net::UdpSocket;
use tracing::{debug, info, warn};

use crate::config::Config;
use crate::discover;
use crate::media;
use crate::pattern;
use crate::sphere::{angle_rad_between_unit, unit_dir_from_equirect_uv_y_up};
use crate::state::{
    InteractiveEffectKind, InteractivePulse, OutputMode, SharedState,
};
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

    let pattern_uv: Option<Vec<(f32, f32)>> = match media::load_layout_uv(&app.compiled_dir, &config.device.layout_id) {
        Ok(layout) if layout.led_count == led_count as usize => {
            let mut table = vec![(0.5f32, 0.5f32); led_count as usize];
            for p in layout.leds {
                if p.i < table.len() {
                    table[p.i] = (p.u, p.v);
                }
            }
            info!(
                "loop test pattern: UV-driven hues from ledmap ({} LEDs)",
                table.len()
            );
            Some(table)
        }
        Ok(layout) => {
            warn!(
                "ledmap led_count {} != runtime {}; loop test pattern uses chain fallback",
                layout.led_count, led_count
            );
            None
        }
        Err(e) => {
            warn!(
                "ledmap load failed for {} ({}); loop test pattern uses chain fallback: {e:#}",
                config.device.layout_id,
                app.compiled_dir.display()
            );
            None
        }
    };

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

        'session: loop {
            ticker.tick().await;
            app.metrics.mark_tick();
            app.clear_expired_interactive_pulses();

            let t_ms = loop_start.elapsed().as_millis() as u32;
            match app.output_mode() {
                OutputMode::Idle | OutputMode::Interactive => rgb.fill(0),
                OutputMode::Loop => {
                    if let Some(sequence) = app.selected_sequence() {
                        if let Err(e) = sequence.copy_frame_at(loop_start.elapsed(), &mut rgb) {
                            warn!("sequence frame copy failed; falling back to pattern: {e:#}");
                            pattern::fill_loop_rgb(t_ms, &mut rgb, pattern_uv.as_deref());
                        }
                    } else {
                        pattern::fill_loop_rgb(t_ms, &mut rgb, pattern_uv.as_deref());
                    }
                }
            }

            if app.output_mode() == OutputMode::Interactive {
                try_apply_interactive_overlay(&app, &mut rgb);
            }

            apply_master_tone(&app, &mut rgb);

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

fn try_apply_interactive_overlay(app: &SharedState, rgb: &mut [u8]) {
    let uv_lock = app.interactive_uv.read().ok();
    let pulse_lock = app.interactive_pulses.read().ok();
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
fn srgb_byte_to_linear(c: u8) -> f32 {
    let s = c as f32 / 255.0;
    if s <= 0.04045 {
        s / 12.92
    } else {
        ((s + 0.055) / 1.055).powf(2.4)
    }
}

#[inline]
fn linear_to_srgb_u8(l: f32) -> u8 {
    let l = l.clamp(0.0, 1.0);
    let s = if l <= 0.0031308 {
        12.92 * l
    } else {
        1.055 * l.powf(1.0 / 2.4) - 0.055
    };
    (s * 255.0).round().clamp(0.0, 255.0) as u8
}

fn apply_master_tone(app: &SharedState, rgb: &mut [u8]) {
    let brightness = app.master_brightness();
    let gamma = app.master_gamma().max(0.001);
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

fn apply_interactive_sphere_gaussian(
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
pub struct RippleDynamics {
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
pub fn ripple_dynamics(ring_speed: f32, ring_thickness_rad: f32) -> RippleDynamics {
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
    RippleDynamics {
        c,
        tau,
        edge_w,
        lifetime,
    }
}

fn apply_interactive_expanding_ring_diagonal(
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
    let d = ripple_dynamics(pulse.ring_speed, pulse.ring_thickness_rad);

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
    fn ripple_dims_gradually_not_instantly() {
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
