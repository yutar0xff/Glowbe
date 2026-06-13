use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use tokio::net::UdpSocket;
use tracing::{debug, info, warn};

use crate::config::Config;
use crate::pattern;
use crate::state::SharedState;
use crate::wire;

pub async fn run(config: Config, state: SharedState, meta_path: PathBuf) -> Result<()> {
    let meta: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&meta_path).with_context(|| {
            format!("read layout meta {}", meta_path.display())
        })?)?;
    let led_count = meta["ledCount"].as_u64().context("ledCount in meta")? as u16;

    let esp_addr: SocketAddr = format!("{}:{}", config.device.esp_ip, config.output.udp_port)
        .parse()
        .context("esp_ip:udp_port")?;

    let sock = UdpSocket::bind("0.0.0.0:0").await.context("bind udp sender")?;
    sock.connect(esp_addr)
        .await
        .with_context(|| format!("connect udp to {esp_addr}"))?;

    let status_port = config.output.status_port;
    let status_task = tokio::spawn(status_listener(status_port, state.clone()));
    let _status_task = status_task;

    let frame_interval = Duration::from_secs_f64(1.0 / config.output.target_fps as f64);
    let mut rgb = vec![0u8; led_count as usize * 3];
    let mut frame_id = 0u32;
    let loop_start = Instant::now();
    let mut sent_window = 0u64;
    let mut window_start = Instant::now();
    let mut ticker = tokio::time::interval(frame_interval);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    info!(
        "output -> {} @ {} fps ({} LEDs)",
        esp_addr, config.output.target_fps, led_count
    );

    loop {
        ticker.tick().await;
        let t_ms = loop_start.elapsed().as_millis() as u32;
        pattern::fill_loop_rgb(led_count as usize, t_ms, &mut rgb);
        for pkt in wire::encode_frame(led_count, frame_id, &rgb) {
            sock.send(&pkt).await.context("udp send")?;
        }
        frame_id = frame_id.wrapping_add(1);
        sent_window += 1;

        {
            let mut s = state.write().await;
            s.frames_sent += 1;
            if window_start.elapsed() >= Duration::from_secs(1) {
                s.fps_out = sent_window as f64 / window_start.elapsed().as_secs_f64();
                sent_window = 0;
                window_start = Instant::now();
            }
        }

    }
}

async fn status_listener(port: u16, state: SharedState) {
    let bind_addr = format!("0.0.0.0:{port}");
    let sock = match UdpSocket::bind(&bind_addr).await {
        Ok(s) => s,
        Err(e) => {
            warn!("status bind {bind_addr} failed: {e}");
            return;
        }
    };
    info!("status listen {bind_addr}");

    let mut buf = [0u8; 64];
    loop {
        match sock.recv(&mut buf).await {
            Ok(n) => {
                if let Some(st) = wire::parse_status(&buf[..n]) {
                    debug!(
                        frames = st.frames_complete,
                        fps_rx = st.fps_rx(),
                        drops = st.drops,
                        rssi = st.rssi
                    );
                    let mut s = state.write().await;
                    s.fps_rx = Some(st.fps_rx());
                    s.esp_rssi = Some(st.rssi);
                    s.esp_drops = Some(st.drops);
                }
            }
            Err(e) => {
                warn!("status recv: {e}");
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        }
    }
}
