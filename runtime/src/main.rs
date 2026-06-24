mod api;
mod config;
mod device_slot;
mod devices;
mod discover;
mod master_tone;
mod mate;
mod media;
mod metrics;
mod output;
mod pattern;
mod sphere;
mod state;
mod wire;

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use tokio::net::TcpListener;
use tracing::info;

use crate::devices::{devices_json_path, DeviceRegistry};
use crate::state::{new_shared, InteractiveEffectKind, InteractivePulse};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "glowbe_runtime=info".into()),
        )
        .init();

    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|arg| arg == "convert-image") {
        return convert_image_command(&args[1..]);
    }
    if args
        .first()
        .is_some_and(|arg| arg == "gen-demo-expanding-rings")
    {
        return gen_demo_expanding_rings_command(&args[1..]);
    }

    let config_path = args
        .first()
        .cloned()
        .unwrap_or_else(|| "config.toml".into());
    let config = config::load(Path::new(&config_path)).context("load config")?;

    let compiled_dir = compiled_dir(&config)?;
    let sequences_dir = sequences_dir(&config)?;
    let uploads_dir = uploads_dir(&config)?;
    std::fs::create_dir_all(&uploads_dir)
        .with_context(|| format!("create uploads dir {}", uploads_dir.display()))?;
    let devices_path = devices_json_path(&config).context("devices path")?;
    let registry =
        DeviceRegistry::load_or_seed(devices_path, &config, &compiled_dir).context("devices")?;

    let app = new_shared(
        registry,
        &config.modes.default,
        compiled_dir.clone(),
        sequences_dir,
        uploads_dir,
    )
    .context("init shared state")?;

    let bind: SocketAddr = config.server.bind.parse().context("server.bind")?;
    let router = api::router(app.clone());
    let listener = TcpListener::bind(bind).await.context("bind http")?;
    info!("http {bind}");

    let cfg = config.clone();
    let app_out = app.clone();
    let output_handle = tokio::spawn(async move {
        if let Err(e) = output::run(cfg, app_out).await {
            tracing::error!("output loop ended: {e:#}");
        }
    });

    axum::serve(listener, router).await.context("http serve")?;
    output_handle.abort();
    Ok(())
}

fn compiled_dir(config: &config::Config) -> Result<PathBuf> {
    if let Some(ref p) = config.assets.compiled_dir {
        let pb = PathBuf::from(p);
        if pb.is_absolute() {
            return Ok(pb);
        }
        return Ok(std::env::current_dir().context("cwd")?.join(pb));
    }
    find_repo_root().map(|r| r.join("assets/compiled"))
}

fn sequences_dir(config: &config::Config) -> Result<PathBuf> {
    if let Some(ref p) = config.assets.sequences_dir {
        let pb = PathBuf::from(p);
        if pb.is_absolute() {
            return Ok(pb);
        }
        return Ok(std::env::current_dir().context("cwd")?.join(pb));
    }
    find_repo_root().map(|r| r.join("assets/sequences"))
}

fn uploads_dir(config: &config::Config) -> Result<PathBuf> {
    if let Some(ref p) = config.assets.uploads_dir {
        let pb = PathBuf::from(p);
        if pb.is_absolute() {
            return Ok(pb);
        }
        return Ok(std::env::current_dir().context("cwd")?.join(pb));
    }
    find_repo_root().map(|r| r.join("assets/uploads"))
}

fn convert_image_command(args: &[String]) -> Result<()> {
    let image_path = args
        .first()
        .context("usage: glowbe-runtime convert-image <image> <sequence-id> [config.toml]")?;
    let sequence_id = args
        .get(1)
        .context("usage: glowbe-runtime convert-image <image> <sequence-id> [config.toml]")?;
    let config_path = args.get(2).map(String::as_str).unwrap_or("config.toml");
    let config = config::load(Path::new(config_path)).context("load config")?;
    let compiled_dir = compiled_dir(&config)?;
    let sequences_dir = sequences_dir(&config)?;
    let out_dir = media::convert_equirect_image_to_sequence(
        Path::new(image_path),
        sequence_id,
        &config.device.layout_id,
        &compiled_dir,
        &sequences_dir,
        1,
    )?;
    println!("wrote sequence {}", out_dir.display());
    Ok(())
}

fn gen_demo_expanding_rings_command(args: &[String]) -> Result<()> {
    let sequence_id = args
        .first()
        .cloned()
        .unwrap_or_else(|| "demo-expanding-rings".to_string());
    let config_path = args.get(1).map(String::as_str).unwrap_or("config.toml");
    let config = config::load(Path::new(config_path)).context("load config")?;
    let compiled_dir = compiled_dir(&config)?;
    let sequences_dir = sequences_dir(&config)?;
    let layout_id = config.device.layout_id.as_str();

    let layout = media::load_layout_uv(&compiled_dir, layout_id)?;
    let mut uv = vec![(0.5f32, 0.5f32); layout.led_count];
    for p in &layout.leds {
        if p.i < uv.len() {
            uv[p.i] = (p.u, p.v);
        }
    }

    #[derive(Clone, Copy)]
    struct Xor(u64);
    impl Xor {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }
        fn u32(&mut self) -> u32 {
            self.next() as u32
        }
        fn f01(&mut self) -> f32 {
            (self.u32() as f64 / u32::MAX as f64) as f32
        }
        fn range(&mut self, lo: f32, hi: f32) -> f32 {
            lo + (hi - lo) * self.f01()
        }
    }

    let mut rng = Xor(0x0DEB_171D_ED00);
    let seq_base = Instant::now();
    let mut pulses: Vec<InteractivePulse> = Vec::new();
    for _ in 0..18 {
        let center_u = rng.range(0.1, 0.9);
        let center_v = rng.range(0.1, 0.9);
        let t0 = rng.range(0.0, 7.8);
        let ring_speed = rng.range(0.82, 1.48);
        let d = output::ring_dynamics(ring_speed, 0.0);
        let life_s = d.lifetime + 0.5;
        let started = seq_base + Duration::from_secs_f32(t0);
        pulses.push(InteractivePulse {
            center_u,
            center_v,
            amplitude: 1.0,
            sigma_rad: 0.14,
            effect: InteractiveEffectKind::ExpandingRingDiagonal,
            started,
            duration: Duration::from_secs_f32(life_s),
            color_r: (rng.u32() % 210 + 40) as u8,
            color_g: (rng.u32() % 210 + 40) as u8,
            color_b: (rng.u32() % 210 + 40) as u8,
            ring_speed,
            ring_thickness_rad: 0.0,
        });
    }

    let fps = 30u32;
    let sec = 12.5f32;
    let frame_count = (sec * fps as f32).ceil() as u32;
    let frames =
        output::encode_demo_expanding_ring_sequence_bytes(&uv, &pulses, seq_base, fps, frame_count);

    let out = sequences_dir.join(&sequence_id);
    if out.exists() {
        std::fs::remove_dir_all(&out).with_context(|| format!("remove {}", out.display()))?;
    }

    media::write_synthetic_demo_sequence(
        &sequences_dir,
        &sequence_id,
        layout_id,
        layout.led_count,
        fps,
        frame_count,
        &frames,
        Some("Ripple rings (demo)"),
    )?;
    println!(
        "wrote demo sequence '{}' under {}",
        sequence_id,
        sequences_dir.display()
    );
    Ok(())
}

fn find_repo_root() -> Result<PathBuf> {
    let mut dir = std::env::current_dir().context("cwd")?;
    loop {
        if dir.join("assets/compiled").is_dir() {
            return Ok(dir);
        }
        if !dir.pop() {
            anyhow::bail!("could not find repo root (assets/compiled); set [assets].compiled_dir in config.toml");
        }
    }
}
