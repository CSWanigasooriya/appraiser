use tauri::{AppHandle, Manager};

use super::{blocking, devices::KnownDevices};
use crate::adb::{self, AdbError};

#[tauri::command]
pub async fn connect_device(addr: String) -> Result<String, AdbError> {
    blocking(move || adb::connect(&addr)).await
}

#[tauri::command]
pub async fn pair_device(addr: String, code: String) -> Result<String, AdbError> {
    blocking(move || adb::pair(&addr, &code)).await
}

#[tauri::command]
pub async fn disconnect_device(app: AppHandle, addr: String) -> Result<(), AdbError> {
    // Disconnecting on purpose also means "stop reconnecting this one".
    app.state::<KnownDevices>().forget(&addr);
    blocking(move || adb::disconnect(&addr)).await
}

/// Switches a USB device to Wi-Fi debugging; returns the `ip:port`.
#[tauri::command]
pub async fn enable_wireless(serial: String) -> Result<String, AdbError> {
    blocking(move || adb::enable_wireless(&serial)).await
}

/// Step 1 of QR pairing: generates the QR code to show the user.
#[tauri::command]
pub async fn start_qr_pairing() -> Result<adb::QrSession, AdbError> {
    blocking(adb::start_qr_pairing).await
}

/// Step 2: waits for the scan, pairs, then connects to the phone's debugging port.
#[tauri::command]
pub async fn finish_qr_pairing(name: String, password: String) -> Result<adb::QrPairingResult, AdbError> {
    blocking(move || adb::finish_qr_pairing(&name, &password)).await
}

#[tauri::command]
pub fn cancel_qr_pairing() {
    adb::cancel_qr_pairing();
}
