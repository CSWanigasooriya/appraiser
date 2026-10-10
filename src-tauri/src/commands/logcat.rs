use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use super::blocking;
use crate::adb::{self, AdbError, LogEvent, LogStream};

/// Running log streams, one per device.
#[derive(Default)]
pub struct LogcatSessions(Mutex<HashMap<String, LogStream>>);

/// What the frontend receives on the log channel.
#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LogMessage {
    Lines { lines: Vec<String> },
    Ended { reason: String },
}

#[tauri::command]
pub fn start_logcat(
    sessions: State<'_, LogcatSessions>,
    serial: String,
    on_event: Channel<LogMessage>,
) -> Result<(), AdbError> {
    let stream = adb::start_logcat(&serial, move |event| {
        let message = match event {
            LogEvent::Lines(lines) => LogMessage::Lines { lines },
            LogEvent::Ended(reason) => LogMessage::Ended { reason },
        };
        on_event.send(message).is_ok()
    })?;
    // Replacing an entry drops (and so stops) the previous stream.
    sessions.0.lock().unwrap().insert(serial, stream);
    Ok(())
}

#[tauri::command]
pub fn stop_logcat(sessions: State<'_, LogcatSessions>, serial: String) {
    sessions.0.lock().unwrap().remove(&serial);
}

#[tauri::command]
pub async fn clear_logcat(serial: String) -> Result<(), AdbError> {
    blocking(move || adb::clear_logcat(&serial)).await
}
