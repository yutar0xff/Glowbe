mod api;
mod clip;
mod clip_placement;
mod config;
mod demos;
mod device_slot;
mod devices;
mod discover;
mod equirect;
mod layouts;
mod master_tone;
mod mate;
mod mate_api;
mod mate_state;
mod media;
mod metrics;
mod orientation;
mod output;
mod pattern;
mod source;
mod sphere;
mod state;
mod text_api;
mod text_state;
mod wire;

use std::net::SocketAddr;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use tokio::net::TcpListener;
use tracing::info;

use crate::devices::{devices_json_path, DeviceRegistry};
use crate::state::new_shared;

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
    if args.first().is_some_and(|arg| arg == "mate-import-stamp") {
        return mate_import_stamp_command(&args[1..]);
    }

    let config_path = args
        .first()
        .cloned()
        .unwrap_or_else(|| "config.toml".into());
    let config = config::load(Path::new(&config_path)).context("load config")?;

    let compiled_dir = compiled_dir(&config)?;
    let repo_root = find_repo_root()?;
    layouts::ensure_preset_compiled(&repo_root, &compiled_dir).context("preset layouts")?;
    let clips_dir = clips_dir(&config)?;
    std::fs::create_dir_all(&clips_dir)
        .with_context(|| format!("create clips dir {}", clips_dir.display()))?;
    let sources_dir = sources_dir(&config)?;
    std::fs::create_dir_all(&sources_dir)
        .with_context(|| format!("create sources dir {}", sources_dir.display()))?;
    let uploads_dir = uploads_dir(&config)?;
    std::fs::create_dir_all(&uploads_dir)
        .with_context(|| format!("create uploads dir {}", uploads_dir.display()))?;
    let mate_assets_dir = mate_assets_dir()?;
    std::fs::create_dir_all(&mate_assets_dir)
        .with_context(|| format!("create mate assets dir {}", mate_assets_dir.display()))?;
    let devices_path = devices_json_path(&config).context("devices path")?;
    let registry = DeviceRegistry::load_or_seed(devices_path, &compiled_dir).context("devices")?;

    let text_font = load_text_font(&config);

    let app = new_shared(
        registry,
        &config.modes.default,
        repo_root,
        compiled_dir.clone(),
        clips_dir,
        sources_dir,
        uploads_dir,
        mate_assets_dir,
        text_font,
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

    // Console (cmd / PowerShell / Terminal) から起動するとログが端末に出る。
    // 窓を閉じる・Ctrl+C・systemd stop (SIGTERM) でプロセスを止める。
    // GUI サブシステムにはしない → Ubuntu Server など headless でもそのまま起動できる。
    axum::serve(listener, router)
        .with_graceful_shutdown(wait_for_shutdown())
        .await
        .context("http serve")?;
    output_handle.abort();
    Ok(())
}

/// 対話端末の終了・Ctrl+C、および headless (systemd) の SIGTERM で戻る。
async fn wait_for_shutdown() {
    let ctrl_c = async {
        if let Err(e) = tokio::signal::ctrl_c().await {
            tracing::error!("failed to listen for Ctrl+C: {e}");
            return;
        }
        info!("received Ctrl+C, shutting down");
    };

    #[cfg(unix)]
    let other = async {
        use tokio::signal::unix::{signal, SignalKind};

        let mut sigterm = match signal(SignalKind::terminate()) {
            Ok(s) => s,
            Err(e) => {
                tracing::error!("failed to listen for SIGTERM: {e}");
                std::future::pending::<()>().await;
                return;
            }
        };
        let mut sighup = match signal(SignalKind::hangup()) {
            Ok(s) => s,
            Err(e) => {
                tracing::error!("failed to listen for SIGHUP: {e}");
                std::future::pending::<()>().await;
                return;
            }
        };

        tokio::select! {
            _ = sigterm.recv() => info!("received SIGTERM, shutting down"),
            // 端末クローズ（macOS / Linux デスクトップ）でも届くことが多い
            _ = sighup.recv() => info!("received SIGHUP, shutting down"),
        }
    };

    #[cfg(windows)]
    let other = async {
        // コンソールウィンドウの × で届く CTRL_CLOSE_EVENT
        let mut close = match tokio::signal::windows::ctrl_close() {
            Ok(s) => s,
            Err(e) => {
                tracing::error!("failed to listen for console close: {e}");
                std::future::pending::<()>().await;
                return;
            }
        };
        let mut break_signal = match tokio::signal::windows::ctrl_break() {
            Ok(s) => s,
            Err(e) => {
                tracing::error!("failed to listen for Ctrl+Break: {e}");
                std::future::pending::<()>().await;
                return;
            }
        };

        tokio::select! {
            _ = close.recv() => info!("console closed, shutting down"),
            _ = break_signal.recv() => info!("received Ctrl+Break, shutting down"),
        }
    };

    #[cfg(not(any(unix, windows)))]
    let other = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = other => {},
    }
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

fn clips_dir(config: &config::Config) -> Result<PathBuf> {
    if let Some(ref p) = config.assets.clips_dir {
        let pb = PathBuf::from(p);
        if pb.is_absolute() {
            return Ok(pb);
        }
        return Ok(std::env::current_dir().context("cwd")?.join(pb));
    }
    find_repo_root().map(|r| r.join("assets/clips"))
}

fn sources_dir(config: &config::Config) -> Result<PathBuf> {
    if let Some(ref p) = config.assets.sources_dir {
        let pb = PathBuf::from(p);
        if pb.is_absolute() {
            return Ok(pb);
        }
        return Ok(std::env::current_dir().context("cwd")?.join(pb));
    }
    find_repo_root().map(|r| r.join("assets/sources"))
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

fn mate_assets_dir() -> Result<PathBuf> {
    find_repo_root().map(|r| r.join("assets/mate"))
}

fn text_font_path(config: &config::Config) -> Result<PathBuf> {
    if let Some(ref p) = config.assets.text_font_path {
        let pb = PathBuf::from(p);
        if pb.is_absolute() {
            return Ok(pb);
        }
        return Ok(std::env::current_dir().context("cwd")?.join(pb));
    }
    find_repo_root().map(|r| r.join("assets/text/NotoSansJP.ttf"))
}

/// text モード用フォントを読み込む。失敗しても `None` を返し、text モードは背景色のみ描画。
fn load_text_font(config: &config::Config) -> Option<std::sync::Arc<fontdue::Font>> {
    let path = match text_font_path(config) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!("text font path unresolved: {e:#}; text mode renders background only");
            return None;
        }
    };
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!(
                "text font not loaded ({}): {e}; text mode renders background only",
                path.display()
            );
            return None;
        }
    };
    match fontdue::Font::from_bytes(bytes.as_slice(), fontdue::FontSettings::default()) {
        Ok(font) => {
            info!("text font loaded: {}", path.display());
            Some(std::sync::Arc::new(font))
        }
        Err(e) => {
            tracing::warn!(
                "text font parse failed ({}): {e}; text mode renders background only",
                path.display()
            );
            None
        }
    }
}

fn mate_import_stamp_command(args: &[String]) -> Result<()> {
    let src = args
        .first()
        .context("usage: glowbe-runtime mate-import-stamp <src.png> <name> [--out path]")?;
    let name = args
        .get(1)
        .context("usage: glowbe-runtime mate-import-stamp <src.png> <name> [--out path]")?;

    let mut out: Option<PathBuf> = None;
    let mut i = 2;
    while i < args.len() {
        match args[i].as_str() {
            "--out" => {
                out = Some(PathBuf::from(
                    args.get(i + 1).context("--out requires path")?,
                ));
                i += 2;
            }
            other => anyhow::bail!("unknown flag: {other}"),
        }
    }

    let asset = mate::import_stamp_from_png(Path::new(src), name)?;
    let out_path = out.unwrap_or_else(|| {
        find_repo_root()
            .map(|r| {
                r.join("assets/mate/stamps")
                    .join(format!("{name}.stamp.json"))
            })
            .unwrap_or_else(|_| PathBuf::from(format!("{name}.stamp.json")))
    });
    mate::write_stamp_json(&out_path, &asset)?;
    println!("wrote {}", out_path.display());
    Ok(())
}

fn convert_image_command(args: &[String]) -> Result<()> {
    let image_path = args
        .first()
        .context("usage: glowbe-runtime convert-image <image> <clip-id> [config.toml]")?;
    let clip_id = args
        .get(1)
        .context("usage: glowbe-runtime convert-image <image> <clip-id> [config.toml]")?;
    let config_path = args.get(2).map(String::as_str).unwrap_or("config.toml");
    let config = config::load(Path::new(config_path)).context("load config")?;
    let clips_dir = clips_dir(&config)?;
    std::fs::create_dir_all(&clips_dir)
        .with_context(|| format!("create clips dir {}", clips_dir.display()))?;
    let out_dir =
        media::convert_equirect_image_to_clip(Path::new(image_path), clip_id, &clips_dir, 1)?;
    println!("wrote clip {}", out_dir.display());
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
