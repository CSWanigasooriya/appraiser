//! Developer tools: settings, network, battery, intents, diagnostics, the
//! performance monitor, the UI inspector and macro playback.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager, State};

use super::blocking;
use crate::adb::{self, AdbError};

#[tauri::command]
pub async fn dev_settings(serial: String) -> Result<adb::DevSettings, AdbError> {
    blocking(move || adb::dev_settings(&serial)).await
}

#[tauri::command]
pub async fn set_dev_setting(serial: String, key: String, value: String) -> Result<(), AdbError> {
    blocking(move || adb::set_dev_setting(&serial, &key, &value)).await
}

#[tauri::command]
pub async fn reset_dev_settings(serial: String) -> Result<(), AdbError> {
    blocking(move || adb::reset_dev_settings(&serial)).await
}

#[tauri::command]
pub async fn network_state(serial: String) -> Result<adb::NetworkState, AdbError> {
    blocking(move || adb::network_state(&serial)).await
}

#[tauri::command]
pub async fn set_wifi(serial: String, on: bool) -> Result<(), AdbError> {
    blocking(move || adb::set_wifi(&serial, on)).await
}

#[tauri::command]
pub async fn set_mobile_data(serial: String, on: bool) -> Result<(), AdbError> {
    blocking(move || adb::set_mobile_data(&serial, on)).await
}

#[tauri::command]
pub async fn set_airplane(serial: String, on: bool) -> Result<(), AdbError> {
    blocking(move || adb::set_airplane(&serial, on)).await
}

/// `None` clears the proxy.
#[tauri::command]
pub async fn set_proxy(serial: String, proxy: Option<String>) -> Result<(), AdbError> {
    blocking(move || adb::set_proxy(&serial, proxy.as_deref())).await
}

#[tauri::command]
pub async fn list_forwards(serial: String) -> Result<Vec<adb::Forward>, AdbError> {
    blocking(move || adb::forwards(&serial)).await
}

#[tauri::command]
pub async fn add_forward(serial: String, reverse: bool, from: String, to: String) -> Result<(), AdbError> {
    blocking(move || adb::add_forward(&serial, reverse, &from, &to)).await
}

#[tauri::command]
pub async fn remove_forward(serial: String, reverse: bool, from: String) -> Result<(), AdbError> {
    blocking(move || adb::remove_forward(&serial, reverse, &from)).await
}

#[tauri::command]
pub async fn battery_state(serial: String) -> Result<adb::Battery, AdbError> {
    blocking(move || adb::battery(&serial)).await
}

#[tauri::command]
pub async fn set_battery(serial: String, key: String, value: String) -> Result<(), AdbError> {
    blocking(move || adb::set_battery(&serial, &key, &value)).await
}

#[tauri::command]
pub async fn reset_battery(serial: String) -> Result<(), AdbError> {
    blocking(move || adb::reset_battery(&serial)).await
}

#[tauri::command]
pub async fn fire_intent(serial: String, intent: adb::Intent) -> Result<String, AdbError> {
    blocking(move || adb::fire_intent(&serial, &intent)).await
}

/// Collects a bug report, crash reports and logs into a new folder under Downloads/Appraiser.
#[tauri::command]
pub async fn capture_diagnostics(app: AppHandle, serial: String, label: String) -> Result<adb::Capture, AdbError> {
    let dest = app.path().download_dir().map_err(|e| AdbError::Failed(e.to_string()))?.join("Appraiser");
    blocking(move || adb::capture_diagnostics(&serial, &dest, &label)).await
}

#[tauri::command]
pub async fn perf_sample(serial: String, package: Option<String>) -> Result<adb::PerfSample, AdbError> {
    blocking(move || adb::perf_sample(&serial, package.as_deref())).await
}

#[tauri::command]
pub async fn dump_ui(serial: String) -> Result<String, AdbError> {
    blocking(move || adb::dump_ui(&serial)).await
}

/// Cancel flags of the macros being played, one per device.
#[derive(Default)]
pub struct MacroRuns(Mutex<HashMap<String, Arc<AtomicBool>>>);

/// Plays a macro; resolves when it finishes or is stopped.
#[tauri::command]
pub async fn run_macro(
    runs: State<'_, MacroRuns>,
    serial: String,
    steps: Vec<adb::MacroStep>,
    landscape: bool,
) -> Result<(), AdbError> {
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut running = runs.0.lock().unwrap();
        if running.contains_key(&serial) {
            return Err(AdbError::Failed("A macro is already running on this device".into()));
        }
        running.insert(serial.clone(), cancel.clone());
    }
    let key = serial.clone();
    let result = blocking(move || adb::run_macro(&serial, &steps, landscape, &cancel)).await;
    runs.0.lock().unwrap().remove(&key);
    result
}

#[tauri::command]
pub fn stop_macro(runs: State<'_, MacroRuns>, serial: String) {
    if let Some(cancel) = runs.0.lock().unwrap().get(&serial) {
        cancel.store(true, Ordering::SeqCst);
    }
}
