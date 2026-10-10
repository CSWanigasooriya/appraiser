//! Core adb layer. Knows nothing about Tauri or the UI, so it can be unit
//! tested and reused (e.g. by a future CLI).

mod apps;
mod device;
mod error;
mod icons;
mod info;
mod qr;
mod runner;
mod wireless;

pub use apps::{
    app_versions,
    clear_data as clear_app_data, force_stop, install as install_apk, list_apps,
    uninstall as uninstall_app, App,
};
pub use device::Device;
pub use icons::app_icon;
pub use error::AdbError;
pub use info::DeviceInfo;
pub use qr::{cancel as cancel_qr_pairing, finish as finish_qr_pairing, start as start_qr_pairing, QrSession};
pub use wireless::{connect, disconnect, enable_wireless, pair};

/// Lists all devices currently known to the adb server.
pub fn list_devices() -> Result<Vec<Device>, AdbError> {
    let output = runner::run(&["devices", "-l"])?;
    Ok(device::parse_devices(&output))
}

pub fn device_info(serial: &str) -> Result<DeviceInfo, AdbError> {
    let props = runner::run(&["-s", serial, "shell", "getprop"])?;
    // Battery is best-effort; some devices restrict dumpsys.
    let battery = runner::run(&["-s", serial, "shell", "dumpsys", "battery"]).unwrap_or_default();
    Ok(info::parse_info(&props, &battery))
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
