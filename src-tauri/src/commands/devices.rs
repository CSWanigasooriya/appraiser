use std::{thread, time::Duration};

use tauri::{AppHandle, Emitter};

use super::blocking;
use crate::adb::{self, AdbError, Device};

#[tauri::command]
pub async fn list_devices() -> Result<Vec<Device>, AdbError> {
    blocking(adb::list_devices).await
}

/// Polls adb and emits `devices-changed` whenever the device list changes.
pub fn start_device_watcher(app: AppHandle) {
    thread::spawn(move || {
        let mut last: Option<Result<Vec<Device>, String>> = None;
        loop {
            let current = adb::list_devices().map_err(|e| e.to_string());
            if last.as_ref() != Some(&current) {
                let _ = app.emit("devices-changed", &current);
                last = Some(current);
            }
            thread::sleep(Duration::from_secs(2));
        }
    });
}
