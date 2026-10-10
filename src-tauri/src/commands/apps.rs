use std::collections::HashMap;

use tauri::Manager;

use super::blocking;
use crate::adb::{self, AdbError, App};

#[tauri::command]
pub async fn list_apps(serial: String, include_system: bool) -> Result<Vec<App>, AdbError> {
    blocking(move || adb::list_apps(&serial, include_system)).await
}

#[tauri::command]
pub async fn app_versions(serial: String) -> Result<HashMap<String, String>, AdbError> {
    blocking(move || adb::app_versions(&serial)).await
}

#[tauri::command]
pub async fn app_icon(
    app: tauri::AppHandle,
    serial: String,
    package: String,
    apk_path: String,
) -> Result<Option<String>, AdbError> {
    let cache_dir = app.path().app_cache_dir().ok().map(|d| d.join("icons"));
    blocking(move || adb::app_icon(&serial, &package, &apk_path, cache_dir.as_deref())).await
}

/// Installs one APK, or several for a split-APK set (a base + config splits).
#[tauri::command]
pub async fn install_apk(serial: String, paths: Vec<String>) -> Result<(), AdbError> {
    blocking(move || adb::install_apk(&serial, &paths)).await
}

#[tauri::command]
pub async fn uninstall_app(serial: String, package: String) -> Result<(), AdbError> {
    blocking(move || adb::uninstall_app(&serial, &package)).await
}

#[tauri::command]
pub async fn clear_app_data(serial: String, package: String) -> Result<(), AdbError> {
    blocking(move || adb::clear_app_data(&serial, &package)).await
}

#[tauri::command]
pub async fn force_stop_app(serial: String, package: String) -> Result<(), AdbError> {
    blocking(move || adb::force_stop(&serial, &package)).await
}
