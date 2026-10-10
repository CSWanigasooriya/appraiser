use std::collections::HashMap;
use std::sync::Mutex;

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use crate::adb::{self, AdbError, Input, Mirror, MirrorEvent, Packet};

/// Running mirror sessions, one per device.
#[derive(Default)]
pub struct MirrorSessions(Mutex<HashMap<String, Mirror>>);

/// Wire format for the frontend, first byte is the kind:
/// `0` config: `[codec len u8][codec utf8][avcC]`, `1` frame: `[key u8][AVCC data]`,
/// `2` error: utf8 message, `3` audio: 48 kHz s16le stereo PCM, `4` notice: utf8 message.
fn encode(event: MirrorEvent) -> Vec<u8> {
    match event {
        MirrorEvent::Packet(Packet::Config { codec, avcc }) => {
            let mut out = vec![0, codec.len() as u8];
            out.extend_from_slice(codec.as_bytes());
            out.extend_from_slice(&avcc);
            out
        }
        MirrorEvent::Packet(Packet::Frame { key, data }) => {
            let mut out = Vec::with_capacity(data.len() + 2);
            out.extend([1, key as u8]);
            out.extend_from_slice(&data);
            out
        }
        MirrorEvent::Audio(pcm) => [&[3u8][..], &pcm].concat(),
        MirrorEvent::Notice(msg) => [&[4u8][..], msg.as_bytes()].concat(),
        MirrorEvent::Error(msg) => {
            let mut out = vec![2];
            out.extend_from_slice(msg.as_bytes());
            out
        }
    }
}

#[tauri::command]
pub fn start_mirror(
    sessions: State<'_, MirrorSessions>,
    serial: String,
    on_frame: Channel<InvokeResponseBody>,
) -> Result<(), AdbError> {
    let mirror = adb::start_mirror(&serial, move |event| {
        on_frame.send(InvokeResponseBody::Raw(encode(event))).is_ok()
    });
    // Replacing an entry drops (and so stops) the previous session.
    sessions.0.lock().unwrap().insert(serial, mirror);
    Ok(())
}

#[tauri::command]
pub fn stop_mirror(sessions: State<'_, MirrorSessions>, serial: String) {
    sessions.0.lock().unwrap().remove(&serial);
}

/// Forwards a touch/scroll/key/text event to the phone being mirrored.
#[tauri::command]
pub async fn mirror_input(sessions: State<'_, MirrorSessions>, serial: String, input: Input) -> Result<(), AdbError> {
    let sessions = sessions.0.lock().unwrap();
    let mirror = sessions.get(&serial).ok_or_else(|| AdbError::Failed("Mirroring is not running".into()))?;
    mirror.send_input(&input)
}
