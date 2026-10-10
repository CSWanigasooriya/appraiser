//! Replaying recorded taps, swipes, key presses and shell commands.

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use serde::Deserialize;

use super::runner::{self, sh_quote};
use super::AdbError;

/// Positions are fractions (0-1) of the screen, so a macro recorded on one phone replays on another.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Step {
    Tap { x: f32, y: f32 },
    Swipe { x1: f32, y1: f32, x2: f32, y2: f32, duration_ms: u32 },
    Key { keycode: i32 },
    Text { text: String },
    Wait { ms: u32 },
    Shell { command: String },
}

const MAX_STEPS: usize = 5000;
const MAX_WAIT_MS: u32 = 60_000;
const MAX_SWIPE_MS: u32 = 10_000;

fn fail<T>(msg: impl Into<String>) -> Result<T, AdbError> {
    Err(AdbError::Failed(msg.into()))
}

/// The screen size as `wm size` reports it, portrait-oriented (width <= height).
pub fn display_size(serial: &str) -> Result<(u32, u32), AdbError> {
    let out = runner::shell(serial, "wm size")?;
    parse_size(&out).ok_or_else(|| AdbError::Failed("Couldn't read the screen size".into()))
}

fn parse_size(out: &str) -> Option<(u32, u32)> {
    // "Override size" wins over "Physical size" when both are printed.
    let line = out.lines().rfind(|l| l.contains("size:"))?;
    let (w, h) = line.split_once(':')?.1.trim().split_once('x')?;
    let (w, h): (u32, u32) = (w.trim().parse().ok()?, h.trim().parse().ok()?);
    Some((w.min(h), w.max(h)))
}

/// Shell text for one step that goes through `input`, or `None` for steps handled separately.
fn input_command(step: &Step, w: u32, h: u32) -> Option<String> {
    let px = |f: f32, extent: u32| ((f.clamp(0.0, 1.0) * extent as f32).round() as u32).min(extent.saturating_sub(1));
    Some(match step {
        Step::Tap { x, y } => format!("input tap {} {}", px(*x, w), px(*y, h)),
        Step::Swipe { x1, y1, x2, y2, duration_ms } => format!(
            "input swipe {} {} {} {} {}",
            px(*x1, w),
            px(*y1, h),
            px(*x2, w),
            px(*y2, h),
            (*duration_ms).clamp(1, MAX_SWIPE_MS)
        ),
        Step::Key { keycode } => format!("input keyevent {keycode}"),
        // `input text` takes %s for a space.
        Step::Text { text } => format!("input text {}", sh_quote(&text.replace(' ', "%s"))),
        Step::Wait { .. } | Step::Shell { .. } => return None,
    })
}

/// Plays the steps in order. `landscape` says the macro was recorded with the
/// phone turned sideways. Stops early (and returns `Ok`) when `cancel` is set.
pub fn run(serial: &str, steps: &[Step], landscape: bool, cancel: &AtomicBool) -> Result<(), AdbError> {
    if steps.len() > MAX_STEPS {
        return fail("This macro has too many steps");
    }
    let (short, long) = display_size(serial)?;
    let (w, h) = if landscape { (long, short) } else { (short, long) };

    let mut pending: Vec<String> = Vec::new();
    let flush = |pending: &mut Vec<String>| -> Result<(), AdbError> {
        if !pending.is_empty() {
            runner::shell(serial, &pending.join("; "))?;
            pending.clear();
        }
        Ok(())
    };

    for step in steps {
        if cancel.load(Ordering::SeqCst) {
            return Ok(());
        }
        match step {
            Step::Wait { ms } => {
                flush(&mut pending)?;
                let mut left = (*ms).min(MAX_WAIT_MS);
                while left > 0 && !cancel.load(Ordering::SeqCst) {
                    let slice = left.min(50);
                    thread::sleep(Duration::from_millis(slice.into()));
                    left -= slice;
                }
            }
            Step::Shell { command } => {
                flush(&mut pending)?;
                runner::shell(serial, command)?;
            }
            other => pending.extend(input_command(other, w, h)),
        }
    }
    if cancel.load(Ordering::SeqCst) {
        return Ok(());
    }
    flush(&mut pending)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_wm_size() {
        assert_eq!(parse_size("Physical size: 1080x2400\n"), Some((1080, 2400)));
        assert_eq!(parse_size("Physical size: 1080x2400\nOverride size: 720x1600\n"), Some((720, 1600)));
        assert_eq!(parse_size("Physical size: 2400x1080\n"), Some((1080, 2400)));
        assert_eq!(parse_size("nope"), None);
    }

    #[test]
    fn maps_fractions_to_pixels() {
        assert_eq!(input_command(&Step::Tap { x: 0.5, y: 0.25 }, 1000, 2000).unwrap(), "input tap 500 500");
        assert_eq!(input_command(&Step::Tap { x: 1.0, y: 1.0 }, 1000, 2000).unwrap(), "input tap 999 1999");
        assert_eq!(
            input_command(&Step::Swipe { x1: 0.0, y1: 0.5, x2: 1.0, y2: 0.5, duration_ms: 300 }, 100, 200).unwrap(),
            "input swipe 0 100 99 100 300"
        );
    }

    #[test]
    fn text_is_quoted_with_spaces_escaped() {
        assert_eq!(input_command(&Step::Text { text: "a b; reboot".into() }, 1, 1).unwrap(), "input text 'a%sb;%sreboot'");
    }

    #[test]
    fn waits_and_shell_are_not_input_commands() {
        assert!(input_command(&Step::Wait { ms: 5 }, 1, 1).is_none());
        assert!(input_command(&Step::Shell { command: "ls".into() }, 1, 1).is_none());
    }
}
