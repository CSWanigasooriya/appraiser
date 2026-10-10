//! Input events for the scrcpy control socket. The wire format is internal
//! to scrcpy and tied to the bundled server version (see `scrcpy::VERSION`).

use std::io::Read;

use serde::Deserialize;

/// Android `MotionEvent` / `KeyEvent` action codes.
const ACTION_DOWN: u8 = 0;
const ACTION_UP: u8 = 1;

/// Pointer id scrcpy uses for the mouse.
const POINTER_MOUSE: i64 = -1;
const BUTTON_PRIMARY: i32 = 1;

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Input {
    /// `action`: 0 down, 1 up, 2 move. `(x, y)` is in video pixels and
    /// `(width, height)` is the video size the coordinates refer to.
    Touch { action: u8, x: i32, y: i32, width: u16, height: u16 },
    /// Wheel scroll in notches (positive `v` scrolls content up).
    Scroll { x: i32, y: i32, width: u16, height: u16, h: f32, v: f32 },
    /// A press-and-release of an Android keycode (`KEYCODE_*`).
    Key { keycode: i32 },
    Text { text: String },
    /// Puts text on the phone's clipboard; `paste` also pastes it into the focused field.
    Clipboard { text: String, paste: bool },
    /// Asks the phone to send back its clipboard (arrives as a device message).
    GetClipboard,
}

const TYPE_KEYCODE: u8 = 0;
const TYPE_TEXT: u8 = 1;
const TYPE_TOUCH: u8 = 2;
const TYPE_SCROLL: u8 = 3;
const TYPE_GET_CLIPBOARD: u8 = 8;
const TYPE_SET_CLIPBOARD: u8 = 9;

/// The server drops text longer than this.
const MAX_TEXT_BYTES: usize = 300;
/// Clipboard messages top out at 256 KiB, minus the 14 bytes of framing.
const MAX_CLIPBOARD_BYTES: usize = (1 << 18) - 14;

/// Serializes an input into one or more control messages, back to back.
pub fn encode(input: &Input) -> Vec<u8> {
    match input {
        Input::Touch { action, x, y, width, height } => {
            let (pressure, action_button, buttons) = match *action {
                ACTION_UP => (0u16, BUTTON_PRIMARY, 0),
                ACTION_DOWN => (0xffff, BUTTON_PRIMARY, BUTTON_PRIMARY),
                _ => (0xffff, 0, BUTTON_PRIMARY),
            };
            let mut m = vec![TYPE_TOUCH, *action];
            m.extend(POINTER_MOUSE.to_be_bytes());
            position(&mut m, *x, *y, *width, *height);
            m.extend(pressure.to_be_bytes());
            m.extend(action_button.to_be_bytes());
            m.extend(buttons.to_be_bytes());
            m
        }
        Input::Scroll { x, y, width, height, h, v } => {
            let mut m = vec![TYPE_SCROLL];
            position(&mut m, *x, *y, *width, *height);
            m.extend(fixed(*h).to_be_bytes());
            m.extend(fixed(*v).to_be_bytes());
            m.extend(0i32.to_be_bytes());
            m
        }
        Input::Key { keycode } => [ACTION_DOWN, ACTION_UP]
            .into_iter()
            .flat_map(|action| {
                let mut m = vec![TYPE_KEYCODE, action];
                m.extend(keycode.to_be_bytes());
                m.extend(0i32.to_be_bytes()); // repeat
                m.extend(0i32.to_be_bytes()); // meta state
                m
            })
            .collect(),
        Input::Text { text } => {
            let bytes = truncate_utf8(text, MAX_TEXT_BYTES);
            let mut m = vec![TYPE_TEXT];
            m.extend((bytes.len() as u32).to_be_bytes());
            m.extend(bytes);
            m
        }
        Input::Clipboard { text, paste } => {
            let bytes = truncate_utf8(text, MAX_CLIPBOARD_BYTES);
            let mut m = vec![TYPE_SET_CLIPBOARD];
            m.extend(0u64.to_be_bytes()); // sequence 0: no acknowledgement wanted
            m.push(*paste as u8);
            m.extend((bytes.len() as u32).to_be_bytes());
            m.extend(bytes);
            m
        }
        Input::GetClipboard => vec![TYPE_GET_CLIPBOARD, 0], // 0: don't press copy first
    }
}

/// Reads the phone's messages on the control socket. Returns the clipboard
/// text of one, `Ok(None)` for kinds we ignore, or `Err` at end of stream.
pub fn read_device_message(r: &mut impl std::io::Read) -> std::io::Result<Option<String>> {
    let mut kind = [0u8; 1];
    r.read_exact(&mut kind)?;
    let skip = |r: &mut dyn std::io::Read, n: usize| std::io::copy(&mut r.take(n as u64), &mut std::io::sink()).map(|_| ());
    match kind[0] {
        0 => {
            let mut len = [0u8; 4];
            r.read_exact(&mut len)?;
            let len = u32::from_be_bytes(len) as usize;
            if len > MAX_CLIPBOARD_BYTES + 14 {
                return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "clipboard too large"));
            }
            let mut text = vec![0u8; len];
            r.read_exact(&mut text)?;
            Ok(Some(String::from_utf8_lossy(&text).into_owned()))
        }
        1 => skip(r, 8).map(|_| None),
        2 => {
            let mut head = [0u8; 4]; // id, then the data size
            r.read_exact(&mut head)?;
            skip(r, u16::from_be_bytes([head[2], head[3]]) as usize).map(|_| None)
        }
        _ => Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "unknown device message")),
    }
}

fn position(m: &mut Vec<u8>, x: i32, y: i32, width: u16, height: u16) {
    m.extend(x.to_be_bytes());
    m.extend(y.to_be_bytes());
    m.extend(width.to_be_bytes());
    m.extend(height.to_be_bytes());
}

/// Scroll amounts travel as i16 fixed point over the range [-16, 16].
fn fixed(v: f32) -> i16 {
    ((v / 16.0).clamp(-1.0, 1.0) * 32767.0) as i16
}

fn truncate_utf8(s: &str, max: usize) -> &[u8] {
    let mut end = s.len().min(max);
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s.as_bytes()[..end]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_touch_down() {
        let m = encode(&Input::Touch { action: 0, x: 100, y: 200, width: 576, height: 1280 });
        let mut want = vec![2, 0];
        want.extend([0xff; 8]); // pointer id -1
        want.extend(100i32.to_be_bytes());
        want.extend(200i32.to_be_bytes());
        want.extend(576u16.to_be_bytes());
        want.extend(1280u16.to_be_bytes());
        want.extend([0xff, 0xff]); // pressure 1.0
        want.extend(1i32.to_be_bytes());
        want.extend(1i32.to_be_bytes());
        assert_eq!(m, want);
        assert_eq!(m.len(), 32);
    }

    #[test]
    fn touch_up_has_zero_pressure_and_no_buttons() {
        let m = encode(&Input::Touch { action: 1, x: 0, y: 0, width: 1, height: 1 });
        assert_eq!(&m[22..24], &[0, 0]); // pressure
        assert_eq!(&m[24..28], &1i32.to_be_bytes()); // action button
        assert_eq!(&m[28..32], &[0, 0, 0, 0]); // buttons still held
    }

    #[test]
    fn key_is_down_then_up() {
        let m = encode(&Input::Key { keycode: 4 });
        assert_eq!(m.len(), 28);
        assert_eq!(&m[..2], &[0, 0]);
        assert_eq!(&m[14..16], &[0, 1]);
        assert_eq!(&m[2..6], &4i32.to_be_bytes());
    }

    #[test]
    fn text_is_length_prefixed_and_truncated_on_char_boundary() {
        let m = encode(&Input::Text { text: "héllo".into() });
        assert_eq!(&m[..5], &[1, 0, 0, 0, 6]);
        assert_eq!(&m[5..], "héllo".as_bytes());
        let long = "é".repeat(400);
        let m = encode(&Input::Text { text: long });
        assert_eq!(m.len(), 5 + 300);
    }

    #[test]
    fn clipboard_messages() {
        let m = encode(&Input::Clipboard { text: "hi".into(), paste: true });
        let mut want = vec![9];
        want.extend([0u8; 8]);
        want.push(1);
        want.extend(2u32.to_be_bytes());
        want.extend(b"hi");
        assert_eq!(m, want);
        assert_eq!(encode(&Input::GetClipboard), vec![8, 0]);
    }

    #[test]
    fn reads_device_messages() {
        let mut data = vec![0];
        data.extend(3u32.to_be_bytes());
        data.extend(b"abc");
        data.push(1);
        data.extend([0u8; 8]);
        data.extend([2, 0, 0, 1, 0xff]);
        data.push(9);
        let mut r = std::io::Cursor::new(data);
        assert_eq!(read_device_message(&mut r).unwrap(), Some("abc".to_string()));
        assert_eq!(read_device_message(&mut r).unwrap(), None);
        assert_eq!(read_device_message(&mut r).unwrap(), None);
        assert!(read_device_message(&mut r).is_err());
    }

    #[test]
    fn scroll_clamps_to_fixed_point_range() {
        assert_eq!(fixed(0.0), 0);
        assert_eq!(fixed(100.0), 32767);
        assert_eq!(fixed(-100.0), -32767);
        assert_eq!(fixed(8.0), 16383);
    }
}
