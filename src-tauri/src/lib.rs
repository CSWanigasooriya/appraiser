mod adb;
mod commands;

use tauri::Manager;

use commands::{actions, apps, devices, files, logcat, media, mirror, tools, wireless};

pub fn run() {
    tauri::Builder::default()
        .manage(mirror::MirrorSessions::default())
        .manage(logcat::LogcatSessions::default())
        .manage(tools::MacroRuns::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Ok(dir) = app.path().resource_dir() {
                adb::runner::use_bundled(&dir.join("platform-tools"));
            }
            devices::start_device_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            devices::list_devices,
            devices::saved_devices,
            devices::forget_device,
            devices::set_auto_reconnect,
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
            apps::app_detail,
            apps::app_storage,
            apps::set_app_permission,
            apps::launch_app,
            apps::set_app_enabled,
            apps::clear_app_cache,
            apps::extract_app_apk,
            media::save_screenshot,
            media::save_media,
            tools::dev_settings,
            tools::set_dev_setting,
            tools::reset_dev_settings,
            tools::network_state,
            tools::set_wifi,
            tools::set_mobile_data,
            tools::set_airplane,
            tools::set_proxy,
            tools::list_forwards,
            tools::add_forward,
            tools::remove_forward,
            tools::battery_state,
            tools::set_battery,
            tools::reset_battery,
            tools::fire_intent,
            tools::capture_diagnostics,
            tools::perf_sample,
            tools::dump_ui,
            tools::run_macro,
            tools::stop_macro,
            files::list_files,
            files::download_files,
            files::upload_files,
            files::delete_files,
            files::rename_file,
            files::make_folder,
            files::read_file,
            logcat::start_logcat,
            logcat::stop_logcat,
            logcat::clear_logcat,
            mirror::start_mirror,
            mirror::stop_mirror,
            mirror::mirror_input,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Appraiser");
}
