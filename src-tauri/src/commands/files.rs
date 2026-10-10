use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD, Engine};

use super::blocking;
use crate::adb::{self, AdbError, FileEntry};

/// Largest file we will send to the UI for a preview.
const PREVIEW_MAX_BYTES: u64 = 12 * 1024 * 1024;

#[tauri::command]
pub async fn list_files(serial: String, path: String) -> Result<Vec<FileEntry>, AdbError> {
    blocking(move || adb::list_files(&serial, &path)).await
}

/// Copies files from the phone into `dest_dir`; returns where each one landed.
#[tauri::command]
pub async fn download_files(serial: String, paths: Vec<String>, dest_dir: String) -> Result<Vec<String>, AdbError> {
    blocking(move || {
        let written = adb::download_files(&serial, &paths, &PathBuf::from(dest_dir))?;
        Ok(written.into_iter().map(|p| p.to_string_lossy().into_owned()).collect())
    })
    .await
}

#[tauri::command]
pub async fn upload_files(serial: String, paths: Vec<String>, remote_dir: String) -> Result<(), AdbError> {
    blocking(move || adb::upload_files(&serial, &paths, &remote_dir)).await
}

#[tauri::command]
pub async fn delete_files(serial: String, paths: Vec<String>) -> Result<(), AdbError> {
    blocking(move || adb::delete_files(&serial, &paths)).await
}

#[tauri::command]
pub async fn rename_file(serial: String, path: String, new_name: String) -> Result<(), AdbError> {
    blocking(move || adb::rename_file(&serial, &path, &new_name)).await
}

#[tauri::command]
pub async fn make_folder(serial: String, parent: String, name: String) -> Result<(), AdbError> {
    blocking(move || adb::make_folder(&serial, &parent, &name)).await
}

/// A file's contents as base64, for previewing images.
#[tauri::command]
pub async fn read_file(serial: String, path: String) -> Result<String, AdbError> {
    blocking(move || Ok(STANDARD.encode(adb::read_file(&serial, &path, PREVIEW_MAX_BYTES)?))).await
}
