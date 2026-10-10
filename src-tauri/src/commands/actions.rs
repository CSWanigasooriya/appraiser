use base64::{engine::general_purpose::STANDARD, Engine};

use super::blocking;
use crate::adb::{self, AdbError, DeviceInfo};

#[tauri::command]
pub async fn device_info(serial: String) -> Result<DeviceInfo, AdbError> {
    blocking(move || adb::device_info(&serial)).await
}

#[tauri::command]
pub async fn reboot_device(serial: String, mode: adb::RebootMode) -> Result<(), AdbError> {
    blocking(move || adb::reboot(&serial, mode)).await
}

/// Returns the screenshot as a base64 PNG for the frontend to display.
#[tauri::command]
pub async fn screenshot(serial: String) -> Result<String, AdbError> {
    let png = blocking(move || adb::screenshot(&serial)).await?;
    Ok(STANDARD.encode(png))
}

#[tauri::command]
pub async fn run_shell(serial: String, command: String) -> Result<String, AdbError> {
    blocking(move || adb::shell(&serial, &command)).await
}
