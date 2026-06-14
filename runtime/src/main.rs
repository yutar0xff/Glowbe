mod api;
mod config;
mod discover;
mod media;
mod metrics;
mod output;
mod pattern;
mod sphere;
mod state;
mod wire;

use std::net::SocketAddr;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use tokio::net::TcpListener;
use tracing::info;

use crate::state::{new_shared, SharedState};

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

    let config_path = args
        .first()
        .cloned()
        .unwrap_or_else(|| "config.toml".into());
    let config = config::load(Path::new(&config_path)).context("load config")?;

    let compiled_dir = compiled_dir(&config)?;
    let sequences_dir = sequences_dir(&config)?;
    let meta_path = compiled_dir.join(format!("{}.meta.json", config.device.layout_id));
    let meta_raw = std::fs::read_to_string(&meta_path)
        .with_context(|| format!("read {}", meta_path.display()))?;
    let meta: serde_json::Value = serde_json::from_str(&meta_raw).context("parse meta json")?;
    let led_count = meta["ledCount"].as_u64().context("ledCount")? as u16;
    let expected_layout_hash = meta
        .get("layoutHash")
        .and_then(|v| v.as_u64())
        .map(|x| x as u32);

    let app: SharedState = new_shared(
        config.device.layout_id.clone(),
        led_count,
        config.modes.default.clone(),
        expected_layout_hash,
        compiled_dir.clone(),
        sequences_dir,
    );

    let bind: SocketAddr = config.server.bind.parse().context("server.bind")?;
    let router = api::router(app.clone());
    let listener = TcpListener::bind(bind).await.context("bind http")?;
    info!("http {bind}");

    let cfg = config.clone();
    let app_out = app.clone();
    let output_handle = tokio::spawn(async move {
        if let Err(e) = output::run(cfg, app_out, meta_path).await {
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
    )?;
    println!("wrote sequence {}", out_dir.display());
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
