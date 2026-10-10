//! Core adb layer. Knows nothing about Tauri or the UI, so it can be unit
//! tested and reused (e.g. by a future CLI).

mod appdetail;
mod apps;
mod automation;
mod control;
mod devsettings;
mod diagnostics;
mod device;
mod error;
mod files;
mod h264;
mod icons;
mod mirror;
mod info;
mod inspector;
mod intents;
mod known;
mod logcat;
mod network;
mod perf;
mod qr;
pub mod runner;
mod scrcpy;
mod wireless;

pub use appdetail::{
    clear_cache as clear_app_cache, detail as app_detail, extract_apk, launch as launch_app,
    set_enabled as set_app_enabled, set_permission, storage as app_storage, AppDetail, AppStorage,
};
pub use automation::{run as run_macro, Step as MacroStep};
pub use devsettings::{read as dev_settings, reset as reset_dev_settings, set as set_dev_setting, DevSettings};
pub use diagnostics::{
    battery, capture as capture_diagnostics, reset_battery, set_battery, Battery, Capture,
};
pub use inspector::dump_ui;
pub use intents::{fire as fire_intent, Intent};
pub use known::{forget, missing, remember, Saved as SavedDevices};
pub use network::{
    add_forward, forwards, remove_forward, set_airplane, set_mobile_data, set_proxy, set_wifi,
    state as network_state, Forward, NetworkState,
};
pub use perf::{sample as perf_sample, PerfSample};
pub use apps::{
    app_versions,
    clear_data as clear_app_data, force_stop, install as install_apk, list_apps,
    uninstall as uninstall_app, App,
};
pub use device::Device;
pub use control::Input;
pub use files::{
    save_unique, delete as delete_files, download as download_files, list as list_files, make_dir as make_folder,
    read as read_file, rename as rename_file, upload as upload_files, Entry as FileEntry,
};
pub use h264::Packet;
pub use icons::app_icon;
pub use logcat::{clear as clear_logcat, start as start_logcat, Event as LogEvent, LogStream};
pub use mirror::{start as start_mirror, Event as MirrorEvent, Mirror};
pub use error::AdbError;
pub use info::DeviceInfo;
pub use qr::{cancel as cancel_qr_pairing, finish as finish_qr_pairing, start as start_qr_pairing, QrPairingResult, QrSession};
pub use wireless::{connect, connect_quick, disconnect, enable_wireless, pair};

/// Lists all devices currently known to the adb server.
pub fn list_devices() -> Result<Vec<Device>, AdbError> {
    let output = runner::run(&["devices", "-l"])?;
    Ok(device::parse_devices(&output))
}

pub fn device_info(serial: &str) -> Result<DeviceInfo, AdbError> {
    let dump = runner::run_combined(&["-s", serial, "shell", info::SCRIPT])?;
    Ok(info::parse_info(&dump))
}

#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RebootMode {
    System,
    Recovery,
    Bootloader,
}

pub fn reboot(serial: &str, mode: RebootMode) -> Result<(), AdbError> {
    let target = match mode {
        RebootMode::System => None,
        RebootMode::Recovery => Some("recovery"),
        RebootMode::Bootloader => Some("bootloader"),
    };
    let mut args = vec!["-s", serial, "reboot"];
    args.extend(target);
    runner::run(&args).map(|_| ())
}

/// Takes a screenshot and returns the PNG bytes.
pub fn screenshot(serial: &str) -> Result<Vec<u8>, AdbError> {
    runner::run_bytes(&["-s", serial, "exec-out", "screencap", "-p"])
}

/// Runs a shell command on the device and returns its combined output.
pub fn shell(serial: &str, command: &str) -> Result<String, AdbError> {
    runner::run_combined(&["-s", serial, "shell", command])
}

/// Loads or saves the remembered wireless devices (see `known`).
pub mod saved {
    pub use super::known::{load, save};
}
