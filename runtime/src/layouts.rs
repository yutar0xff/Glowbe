use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LayoutSourceKind {
    Preset,
    User,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutCatalogEntry {
    pub layout_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub led_count: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
    pub source_kind: LayoutSourceKind,
    pub data_line_count: u8,
    pub gpios: Vec<u8>,
    pub layout_hash: u32,
    pub editable: bool,
    pub in_use_by_devices: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompileIpcResponse {
    ok: bool,
    layout_id: Option<String>,
    layout_hash: Option<u32>,
    led_count: Option<u16>,
    data_line_count: Option<u8>,
    gpios: Option<Vec<u8>>,
    leds_per_line: Option<Vec<u16>>,
    error: Option<String>,
}

pub struct CompileResult {
    pub layout_id: String,
    pub layout_hash: u32,
    pub led_count: u16,
    pub data_line_count: u8,
    pub gpios: Vec<u8>,
    pub leds_per_line: Vec<u16>,
}

pub fn preset_source_dir(repo_root: &Path) -> PathBuf {
    repo_root.join("config/layouts/presets")
}

pub fn user_source_dir(repo_root: &Path) -> PathBuf {
    repo_root.join("assets/layouts/user")
}

fn source_path(repo_root: &Path, id: &str, kind: LayoutSourceKind) -> PathBuf {
    let dir = match kind {
        LayoutSourceKind::Preset => preset_source_dir(repo_root),
        LayoutSourceKind::User => user_source_dir(repo_root),
    };
    dir.join(format!("{id}.layout.json"))
}

fn infer_source_kind_from_meta(meta: &Value, id: &str) -> LayoutSourceKind {
    if meta.get("variant").and_then(|v| v.as_str()) == Some("custom") {
        return LayoutSourceKind::User;
    }
    if id.starts_with("custom-") {
        return LayoutSourceKind::User;
    }
    LayoutSourceKind::Preset
}

pub fn find_layout_source(repo_root: &Path, id: &str) -> Result<(PathBuf, LayoutSourceKind)> {
    validate_layout_id(id)?;
    let preset = source_path(repo_root, id, LayoutSourceKind::Preset);
    if preset.is_file() {
        return Ok((preset, LayoutSourceKind::Preset));
    }
    let user = source_path(repo_root, id, LayoutSourceKind::User);
    if user.is_file() {
        return Ok((user, LayoutSourceKind::User));
    }
    if let Some(path) = scan_source_dir(&preset_source_dir(repo_root), id) {
        return Ok((path, LayoutSourceKind::Preset));
    }
    if let Some(path) = scan_source_dir(&user_source_dir(repo_root), id) {
        return Ok((path, LayoutSourceKind::User));
    }
    anyhow::bail!("layout source not found: {id}");
}

fn scan_source_dir(dir: &Path, id: &str) -> Option<PathBuf> {
    let rd = fs::read_dir(dir).ok()?;
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".layout.json") {
            continue;
        }
        let path = entry.path();
        let Ok(v) = read_layout_json(&path) else {
            continue;
        };
        if v.get("id").and_then(|x| x.as_str()) == Some(id) {
            return Some(path);
        }
    }
    None
}

pub fn validate_layout_id(id: &str) -> Result<()> {
    if id.is_empty() || id.contains('/') || id.contains('\\') {
        anyhow::bail!("layout id must be non-empty and path-safe");
    }
    Ok(())
}

fn read_layout_json(path: &Path) -> Result<Value> {
    let raw = fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
    let v: Value = serde_json::from_str(&raw).context("parse layout JSON")?;
    if v.get("format").and_then(|x| x.as_str()) != Some("glowbe-layout") {
        anyhow::bail!("expected glowbe-layout format");
    }
    if v.get("version").and_then(|x| x.as_u64()) != Some(1) {
        anyhow::bail!("expected glowbe-layout version 1");
    }
    Ok(v)
}

fn read_meta(compiled_dir: &Path, id: &str) -> Result<Value> {
    let path = compiled_dir.join(format!("{id}.meta.json"));
    let raw = fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
    serde_json::from_str(&raw).with_context(|| format!("parse {}", path.display()))
}

pub fn read_layout_hash(compiled_dir: &Path, id: &str) -> Option<u32> {
    read_meta(compiled_dir, id)
        .ok()
        .and_then(|meta| meta.get("layoutHash").and_then(|v| v.as_u64()).map(|x| x as u32))
}

pub fn read_led_count(compiled_dir: &Path, id: &str) -> Option<u16> {
    read_meta(compiled_dir, id)
        .ok()
        .and_then(|meta| meta.get("ledCount").and_then(|v| v.as_u64()).map(|x| x as u16))
}

pub fn compile_layout_via_node(repo_root: &Path, layout: &Value) -> Result<CompileResult> {
    let script = repo_root.join("tools/layout-build.mjs");
    if !script.is_file() {
        anyhow::bail!("layout build script missing: {}", script.display());
    }
    let payload = serde_json::json!({
        "layout": layout,
        "repoRoot": repo_root.to_string_lossy(),
    });
    let mut child = Command::new("npx")
        .args(["tsx", script.to_str().context("layout script path")?])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("spawn node layout-build.mjs")?;
    {
        let stdin = child.stdin.as_mut().context("layout-build stdin")?;
        stdin
            .write_all(payload.to_string().as_bytes())
            .context("write layout-build stdin")?;
    }
    let out = child
        .wait_with_output()
        .context("wait layout-build.mjs")?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        anyhow::bail!(
            "layout-build failed (status {}): {}",
            out.status,
            stderr.trim()
        );
    }
    let parsed: CompileIpcResponse =
        serde_json::from_slice(&out.stdout).context("parse layout-build stdout")?;
    if !parsed.ok {
        anyhow::bail!(
            "layout compile: {}",
            parsed.error.unwrap_or_else(|| "unknown error".into())
        );
    }
    Ok(CompileResult {
        layout_id: parsed.layout_id.context("missing layoutId")?,
        layout_hash: parsed.layout_hash.context("missing layoutHash")?,
        led_count: parsed.led_count.context("missing ledCount")?,
        data_line_count: parsed.data_line_count.context("missing dataLineCount")?,
        gpios: parsed.gpios.unwrap_or_default(),
        leds_per_line: parsed.leds_per_line.unwrap_or_default(),
    })
}

pub fn ensure_preset_compiled(repo_root: &Path, compiled_dir: &Path) -> Result<()> {
    let preset_dir = preset_source_dir(repo_root);
    if !preset_dir.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(&preset_dir).with_context(|| format!("read {}", preset_dir.display()))?
    {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(_stem) = name.strip_suffix(".layout.json") else {
            continue;
        };
        let layout = read_layout_json(&entry.path())?;
        let id = layout
            .get("id")
            .and_then(|v| v.as_str())
            .context("preset layout id")?;
        let meta_path = compiled_dir.join(format!("{id}.meta.json"));
        if meta_path.is_file() {
            continue;
        }
        compile_layout_via_node(repo_root, &layout)?;
        tracing::info!("compiled missing preset layout {id}");
    }
    Ok(())
}

pub fn list_layout_catalog(
    repo_root: &Path,
    compiled_dir: &Path,
    device_usage: &[(String, String)],
) -> Result<Vec<LayoutCatalogEntry>> {
    let mut ids: Vec<String> = Vec::new();

    for dir in [preset_source_dir(repo_root), user_source_dir(repo_root)] {
        if !dir.is_dir() {
            continue;
        }
        for entry in fs::read_dir(&dir).with_context(|| format!("read {}", dir.display()))? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".layout.json") {
                continue;
            }
            if let Ok(layout) = read_layout_json(&entry.path()) {
                if let Some(json_id) = layout.get("id").and_then(|v| v.as_str()) {
                    if !ids.contains(&json_id.to_string()) {
                        ids.push(json_id.to_string());
                    }
                    continue;
                }
            }
            if let Some(stem) = name.strip_suffix(".layout.json") {
                if !ids.contains(&stem.to_string()) {
                    ids.push(stem.to_string());
                }
            }
        }
    }

    // Include compiled-only entries (legacy) so catalog stays usable.
    if compiled_dir.is_dir() {
        for entry in fs::read_dir(compiled_dir)
            .with_context(|| format!("read {}", compiled_dir.display()))?
        {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();
            if let Some(id) = name.strip_suffix(".meta.json") {
                if !ids.contains(&id.to_string()) {
                    ids.push(id.to_string());
                }
            }
        }
    }

    ids.sort();
    ids.dedup();

    let mut out = Vec::new();
    for id in ids {
        let meta = match read_meta(compiled_dir, &id) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let source_kind = match find_layout_source(repo_root, &id) {
            Ok((_, kind)) => kind,
            Err(_) => infer_source_kind_from_meta(&meta, &id),
        };

        let display_name = meta["displayName"].as_str().map(String::from);
        let variant = meta["variant"].as_str().map(String::from);
        let led_count = meta["ledCount"].as_u64().unwrap_or(0).min(u64::from(u16::MAX)) as u16;
        let data_line_count = meta["dataLineCount"]
            .as_u64()
            .unwrap_or(0)
            .min(u64::from(u8::MAX)) as u8;
        let layout_hash = meta["layoutHash"].as_u64().unwrap_or(0) as u32;
        let gpios: Vec<u8> = meta["gpios"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_u64().map(|n| n.min(u64::from(u8::MAX)) as u8))
                    .collect()
            })
            .unwrap_or_default();

        let in_use_by_devices: Vec<String> = device_usage
            .iter()
            .filter(|(_, lid)| lid == &id)
            .map(|(did, _)| did.clone())
            .collect();

        out.push(LayoutCatalogEntry {
            layout_id: id.clone(),
            display_name,
            led_count,
            variant,
            source_kind,
            data_line_count,
            gpios,
            layout_hash,
            editable: source_kind == LayoutSourceKind::User,
            in_use_by_devices,
        });
    }
    Ok(out)
}

pub fn get_layout_source(repo_root: &Path, id: &str) -> Result<Value> {
    let (path, _) = find_layout_source(repo_root, id)?;
    read_layout_json(&path)
}

pub fn save_layout_source(
    repo_root: &Path,
    compiled_dir: &Path,
    layout: Value,
    kind: LayoutSourceKind,
) -> Result<CompileResult> {
    let id = layout
        .get("id")
        .and_then(|v| v.as_str())
        .context("layout.id required")?;
    validate_layout_id(id)?;

    if kind == LayoutSourceKind::Preset {
        anyhow::bail!("preset layouts are read-only via API");
    }

    let user_dir = user_source_dir(repo_root);
    fs::create_dir_all(&user_dir)
        .with_context(|| format!("mkdir {}", user_dir.display()))?;

    let dest = source_path(repo_root, id, LayoutSourceKind::User);
    let tmp = dest.with_extension("layout.json.tmp");
    let pretty = serde_json::to_vec_pretty(&layout).context("serialize layout")?;
    fs::write(&tmp, [pretty, b"\n".to_vec()].concat())
        .with_context(|| format!("write {}", tmp.display()))?;

    match compile_layout_via_node(repo_root, &layout) {
        Ok(result) => {
            fs::rename(&tmp, &dest).with_context(|| format!("commit {}", dest.display()))?;
            let _ = compiled_dir;
            Ok(result)
        }
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(e)
        }
    }
}

pub fn update_layout_source(
    repo_root: &Path,
    compiled_dir: &Path,
    id: &str,
    layout: Value,
) -> Result<CompileResult> {
    let (_, kind) = find_layout_source(repo_root, id)?;
    if kind == LayoutSourceKind::Preset {
        anyhow::bail!("preset layouts are read-only; duplicate to a custom profile first");
    }
    let layout_id = layout
        .get("id")
        .and_then(|v| v.as_str())
        .context("layout.id required")?;
    if layout_id != id {
        anyhow::bail!("layout id mismatch");
    }
    save_layout_source(repo_root, compiled_dir, layout, LayoutSourceKind::User)
}

pub fn create_layout(
    repo_root: &Path,
    compiled_dir: &Path,
    layout: Value,
) -> Result<CompileResult> {
    let id = layout
        .get("id")
        .and_then(|v| v.as_str())
        .context("layout.id required")?;
    validate_layout_id(id)?;
    if find_layout_source(repo_root, id).is_ok() {
        anyhow::bail!("layout already exists: {id}");
    }
    save_layout_source(repo_root, compiled_dir, layout, LayoutSourceKind::User)
}

pub fn delete_user_layout(
    repo_root: &Path,
    compiled_dir: &Path,
    id: &str,
    device_usage: &[(String, String)],
) -> Result<()> {
    validate_layout_id(id)?;
    let (_, kind) = find_layout_source(repo_root, id)?;
    if kind == LayoutSourceKind::Preset {
        anyhow::bail!("cannot delete preset layout");
    }
    if device_usage.iter().any(|(_, lid)| lid == id) {
        anyhow::bail!("layout in use by devices");
    }

    let src = source_path(repo_root, id, LayoutSourceKind::User);
    if src.is_file() {
        fs::remove_file(&src).with_context(|| format!("remove {}", src.display()))?;
    }
    for ext in [".meta.json", ".ledmap.json", ".bin"] {
        let p = compiled_dir.join(format!("{id}{ext}"));
        if p.is_file() {
            fs::remove_file(&p).ok();
        }
    }
    let fw = repo_root.join(format!("firmware/esp32/include/generated/{id}"));
    if fw.is_dir() {
        fs::remove_dir_all(&fw).ok();
    }
    Ok(())
}

pub fn import_studio_layout(
    repo_root: &Path,
    compiled_dir: &Path,
    studio_json: &Value,
    variant: &str,
) -> Result<(Value, CompileResult)> {
    let script = repo_root.join("tools/migrate-studio-layout.mjs");
    if !script.is_file() {
        anyhow::bail!("migrate script missing");
    }

    let tmp_in = std::env::temp_dir().join(format!("glowbe-import-{}.json", Uuid::new_v4()));
    let tmp_out = std::env::temp_dir().join(format!("glowbe-import-out-{}.json", Uuid::new_v4()));
    fs::write(&tmp_in, serde_json::to_vec_pretty(studio_json)?)?;
    let status = Command::new("node")
        .arg(&script)
        .arg(&tmp_in)
        .arg(&tmp_out)
        .arg(variant)
        .status()
        .context("spawn migrate-studio-layout.mjs")?;
    let _ = fs::remove_file(&tmp_in);
    if !status.success() {
        let _ = fs::remove_file(&tmp_out);
        anyhow::bail!("studio layout import failed");
    }
    let raw = fs::read_to_string(&tmp_out).context("read migrated layout")?;
    let _ = fs::remove_file(&tmp_out);
    let mut layout: Value = serde_json::from_str(&raw)?;

    // User import always gets a unique id unless caller set one.
    if layout.get("id").and_then(|v| v.as_str()).is_some_and(|id| {
        find_layout_source(repo_root, id).is_ok()
    }) {
        let new_id = format!("custom-{}", &Uuid::new_v4().simple().to_string()[..8]);
        if let Some(obj) = layout.as_object_mut() {
            obj.insert("id".into(), Value::String(new_id));
        }
    }

    let result = create_layout(repo_root, compiled_dir, layout.clone())?;
    Ok((layout, result))
}

pub fn duplicate_preset_to_user(
    repo_root: &Path,
    compiled_dir: &Path,
    preset_id: &str,
    new_id: Option<&str>,
    display_name: Option<&str>,
) -> Result<(Value, CompileResult)> {
    let (path, kind) = find_layout_source(repo_root, preset_id)?;
    if kind != LayoutSourceKind::Preset {
        anyhow::bail!("source must be a preset");
    }
    let mut layout = read_layout_json(&path)?;
    let id = new_id
        .map(String::from)
        .unwrap_or_else(|| format!("custom-{}", &Uuid::new_v4().simple().to_string()[..8]));
    validate_layout_id(&id)?;
    if let Some(obj) = layout.as_object_mut() {
        obj.insert("id".into(), Value::String(id.clone()));
        if let Some(name) = display_name {
            obj.insert("displayName".into(), Value::String(name.to_string()));
        }
        obj.insert("variant".into(), Value::String("custom".into()));
    }
    let result = create_layout(repo_root, compiled_dir, layout.clone())?;
    Ok((layout, result))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_layout_id_rejects_slashes() {
        assert!(validate_layout_id("ok-id").is_ok());
        assert!(validate_layout_id("bad/id").is_err());
    }
}
