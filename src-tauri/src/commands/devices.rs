use std::path::PathBuf;
use std::sync::Mutex;
use std::{thread, time::Duration};

use tauri::{AppHandle, Emitter, Manager};

use super::blocking;
use crate::adb::{self, AdbError, Device, SavedDevices};

/// How often saved wireless devices that dropped off the network are retried.
const RECONNECT_EVERY: Duration = Duration::from_secs(12);

/// The wireless devices to bring back automatically, kept in the app's config folder.
pub struct KnownDevices {
    path: PathBuf,
    saved: Mutex<SavedDevices>,
}

impl KnownDevices {
    fn load(path: PathBuf) -> Self {
        let saved = adb::saved::load(&path);
        Self { path, saved: Mutex::new(saved) }
    }

    fn update(&self, change: impl FnOnce(&mut SavedDevices) -> bool) {
        let mut saved = self.saved.lock().unwrap();
        if change(&mut saved) {
            let _ = adb::saved::save(&self.path, &saved);
        }
    }

    pub fn forget(&self, addr: &str) {
        self.update(|s| adb::forget(s, addr));
    }

    fn snapshot(&self) -> SavedDevices {
        self.saved.lock().unwrap().clone()
    }
}

#[tauri::command]
pub async fn list_devices() -> Result<Vec<Device>, AdbError> {
    blocking(adb::list_devices).await
}

#[tauri::command]
pub fn saved_devices(known: tauri::State<'_, KnownDevices>) -> SavedDevices {
    known.snapshot()
}

#[tauri::command]
pub fn forget_device(known: tauri::State<'_, KnownDevices>, addr: String) {
    known.forget(&addr);
}

#[tauri::command]
pub fn set_auto_reconnect(known: tauri::State<'_, KnownDevices>, on: bool) {
    known.update(|s| {
        let changed = s.auto_reconnect != on;
        s.auto_reconnect = on;
        changed
    });
}

/// Polls adb and emits `devices-changed` whenever the device list changes.
/// Also remembers wireless devices and reconnects ones that went missing.
pub fn start_device_watcher(app: AppHandle) {
    let dir = app.path().app_config_dir().unwrap_or_else(|_| std::env::temp_dir());
    app.manage(KnownDevices::load(dir.join("wireless.json")));

    let reconnecting = app.clone();
    thread::spawn(move || {
        let known = reconnecting.state::<KnownDevices>();
        loop {
            thread::sleep(RECONNECT_EVERY);
            let saved = known.snapshot();
            if !saved.auto_reconnect || saved.devices.is_empty() {
                continue;
            }
            let Ok(devices) = adb::list_devices() else { continue };
            for addr in adb::missing(&saved, &devices) {
                let _ = adb::connect_quick(&addr);
            }
        }
    });

    thread::spawn(move || {
        let known = app.state::<KnownDevices>();
        let mut last: Option<Result<Vec<Device>, String>> = None;
        loop {
            let current = adb::list_devices().map_err(|e| e.to_string());
            if last.as_ref() != Some(&current) {
                if let Ok(devices) = &current {
                    known.update(|s| adb::remember(s, devices));
                }
                let _ = app.emit("devices-changed", &current);
                last = Some(current);
            }
            thread::sleep(Duration::from_secs(2));
        }
    });
}
