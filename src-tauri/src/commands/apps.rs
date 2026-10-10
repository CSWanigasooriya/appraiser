use std::collections::HashMap;

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
pub async fn app_icon(serial: String, package: String) -> Result<Option<String>, AdbError> {
    blocking(move || adb::app_icon(&serial, &package)).await
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
