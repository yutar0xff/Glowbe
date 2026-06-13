mod api;
mod config;
mod output;
mod pattern;
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

    let config_path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "config.toml".into());
    let config = config::load(Path::new(&config_path)).context("load config")?;

    let repo_root = find_repo_root()?;
    let meta_path = repo_root.join(format!(
        "assets/compiled/{}.meta.json",
        config.device.layout_id
    ));
    let meta: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&meta_path).context("read meta")?)?;
    let led_count = meta["ledCount"].as_u64().context("ledCount")? as u16;

    let state: SharedState = new_shared(
        config.device.layout_id.clone(),
        led_count,
        config.modes.default.clone(),
    );

    let bind: SocketAddr = config.server.bind.parse().context("server.bind")?;
    let app = api::router(state.clone());
    let listener = TcpListener::bind(bind).await.context("bind http")?;
    info!("http {bind}");

    let cfg = config.clone();
    let output_handle = tokio::spawn(async move {
        if let Err(e) = output::run(cfg, state, meta_path).await {
            tracing::error!("output loop ended: {e:#}");
        }
    });

    axum::serve(listener, app)
        .await
        .context("http serve")?;
    output_handle.abort();
    Ok(())
}

fn find_repo_root() -> Result<PathBuf> {
    let mut dir = std::env::current_dir().context("cwd")?;
    loop {
        if dir.join("assets/compiled").is_dir() {
            return Ok(dir);
        }
        if !dir.pop() {
            anyhow::bail!("could not find repo root (assets/compiled)");
        }
    }
}
