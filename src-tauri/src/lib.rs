mod adb;
mod commands;

use commands::{actions, apps, devices, mirror, wireless};

pub fn run() {
    tauri::Builder::default()
        .manage(mirror::MirrorSessions::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            devices::start_device_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            devices::list_devices,
            actions::device_info,
            actions::reboot_device,
            actions::screenshot,
            actions::run_shell,
            wireless::connect_device,
            wireless::pair_device,
            wireless::disconnect_device,
            wireless::enable_wireless,
            wireless::start_qr_pairing,
            wireless::finish_qr_pairing,
            wireless::cancel_qr_pairing,
            apps::list_apps,
            apps::app_versions,
            apps::app_icon,
            apps::install_apk,
            apps::uninstall_app,
            apps::clear_app_data,
            apps::force_stop_app,
            mirror::start_mirror,
            mirror::stop_mirror,
            mirror::mirror_input,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Appraiser");
}
