//! Saving screenshots and recordings to the computer.

use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD, Engine};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

use super::blocking;
use crate::adb::{self, AdbError};

const FOLDER: &str = "Appraiser";

fn folder(app: &AppHandle, recording: bool) -> Result<PathBuf, AdbError> {
    let paths = app.path();
    let base = if recording { paths.video_dir() } else { paths.picture_dir() }
        .or_else(|_| paths.download_dir())
        .map_err(|e| AdbError::Failed(e.to_string()))?;
    Ok(base.join(FOLDER))
}

/// Takes a screenshot over adb, saves it to Pictures/Appraiser and returns the
/// path together with the image (base64 PNG) so the UI can show it.
#[tauri::command]
pub async fn save_screenshot(app: AppHandle, serial: String, name: String) -> Result<(String, String), AdbError> {
    let dir = folder(&app, false)?;
    blocking(move || {
        let png = adb::screenshot(&serial)?;
        let path = adb::save_unique(&dir, &name, &png)?;
        Ok((path.to_string_lossy().into_owned(), STANDARD.encode(png)))
    })
    .await
}

/// Saves the raw request body (a PNG or a recording from the mirror) under the
/// `x-name` header. `x-kind` is `screenshot` or `recording`, which picks the folder.
#[tauri::command]
pub async fn save_media(app: AppHandle, request: Request<'_>) -> Result<String, AdbError> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(AdbError::Failed("No data to save".into()));
    };
    let header = |key: &str| request.headers().get(key).and_then(|v| v.to_str().ok()).unwrap_or_default().to_string();
    let dir = folder(&app, header("x-kind") == "recording")?;
    let (name, bytes) = (header("x-name"), bytes.clone());
    let path = blocking(move || adb::save_unique(&dir, &name, &bytes)).await?;
    Ok(path.to_string_lossy().into_owned())
}
