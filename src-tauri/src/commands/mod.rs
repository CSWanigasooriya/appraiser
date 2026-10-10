//! Thin Tauri command layer: adapts the core `adb` module to the frontend.
pub mod actions;
pub mod apps;
pub mod devices;
pub mod files;
pub mod logcat;
pub mod media;
pub mod mirror;
pub mod tools;
pub mod wireless;

use tauri::async_runtime;

use crate::adb::AdbError;

/// adb calls are blocking subprocesses; keep them off the async runtime threads.
pub(crate) async fn blocking<T, F>(f: F) -> Result<T, AdbError>
where
    F: FnOnce() -> Result<T, AdbError> + Send + 'static,
    T: Send + 'static,
{
    async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AdbError::Failed(e.to_string()))?
}
