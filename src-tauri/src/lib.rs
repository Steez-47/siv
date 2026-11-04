mod images;
mod server;
mod updater;

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU16, Ordering};
use tauri::{Emitter, Manager};

static PORT: AtomicU16 = AtomicU16::new(0);

fn file_arg(args: &[String]) -> Option<String> {
    args.iter().skip(1).find(|a| !a.starts_with('-') && Path::new(a).is_file()).cloned()
}

#[tauri::command]
fn boot() -> Value {
    json!({
        "port": PORT.load(Ordering::Relaxed),
        "token": server::token(),
        "file": file_arg(&std::env::args().collect::<Vec<_>>()),
    })
}

#[tauri::command]
async fn list_folder(path: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || images::list_folder(&path)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn file_info(path: String) -> Result<Value, String> { images::file_info(&path) }

#[tauri::command]
async fn image_meta(path: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || images::meta(&path)).await.map_err(|e| e.to_string())
}

/// "photo.jpg" → "photo 2.jpg" → "photo 3.jpg" … until the name is free.
fn unique(p: PathBuf) -> PathBuf {
    if !p.exists() { return p; }
    let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = p.extension().map(|s| format!(".{}", s.to_string_lossy())).unwrap_or_default();
    let dir = p.parent().map(Path::to_path_buf).unwrap_or_default();
    (2..10000).map(|n| dir.join(format!("{stem} {n}{ext}"))).find(|c| !c.exists()).unwrap_or(p)
}

/// Write an exported image. Body: the encoded bytes. Headers: `x-path` (URI-encoded target),
/// `x-unique: 1` to pick a free name instead of overwriting. Returns the written path.
#[tauri::command]
async fn save_image(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else { return Err("Expected image bytes".into()) };
    let h = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(|s| percent_encoding::percent_decode_str(s).decode_utf8_lossy().into_owned());
    let path = h("x-path").filter(|p| !p.is_empty()).ok_or("Missing target path")?;
    let mut out = PathBuf::from(path);
    if h("x-unique").as_deref() == Some("1") { out = unique(out); }
    if let Some(d) = out.parent() { std::fs::create_dir_all(d).map_err(|e| e.to_string())?; }
    let tmp = out.with_extension(format!("{}.part", out.extension().map(|e| e.to_string_lossy().into_owned()).unwrap_or_default()));
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &out).map_err(|e| { let _ = std::fs::remove_file(&tmp); e.to_string() })?;
    Ok(out.to_string_lossy().into_owned())
}

/// Whether the installer registered SIV with Windows (Default apps / Open with).
#[tauri::command]
fn shell_registered() -> bool {
    #[cfg(windows)]
    {
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        return RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(r"Software\RegisteredApplications")
            .and_then(|k| k.get_value::<String, _>("SIV"))
            .is_ok();
    }
    #[allow(unreachable_code)]
    false
}

/// Open Windows Settings on SIV's Default apps page (falls back to the general page).
#[tauri::command]
fn open_default_apps() -> Result<(), String> {
    let url = if shell_registered() { "ms-settings:defaultapps?registeredAppUser=SIV" } else { "ms-settings:defaultapps" };
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn app_version(app: tauri::AppHandle) -> String { app.package_info().version.to_string() }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    PORT.store(server::start(), Ordering::Relaxed);
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            if let Some(f) = file_arg(&args) { let _ = app.emit("open-file", f); }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            boot, list_folder, file_info, image_meta, save_image, shell_registered, open_default_apps, app_version,
            updater::update_check, updater::update_install
        ])
        .run(tauri::generate_context!())
        .expect("error while running SIV");
}
