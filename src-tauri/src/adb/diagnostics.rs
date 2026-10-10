//! Battery simulation and one-click collection of bug reports, crash
//! reports and logs.

use std::path::{Path, PathBuf};

use serde::Serialize;

use super::runner;
use super::AdbError;

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct Battery {
    pub level: Option<u8>,
    /// Android `BatteryManager` status: 2 charging, 3 discharging, 4 not charging, 5 full.
    pub status: Option<u8>,
    pub ac: bool,
    pub usb: bool,
    pub wireless: bool,
    /// Degrees Celsius.
    pub temperature: Option<f32>,
    pub voltage_mv: Option<u32>,
}

pub fn battery(serial: &str) -> Result<Battery, AdbError> {
    Ok(parse_battery(&runner::shell(serial, "dumpsys battery")?))
}

pub(super) fn parse_battery(out: &str) -> Battery {
    let mut b = Battery::default();
    for line in out.lines() {
        let Some((key, value)) = line.trim().split_once(':') else { continue };
        let value = value.trim();
        match key {
            "level" => b.level = value.parse().ok(),
            "status" => b.status = value.parse().ok(),
            "AC powered" => b.ac = value == "true",
            "USB powered" => b.usb = value == "true",
            "Wireless powered" => b.wireless = value == "true",
            "temperature" => b.temperature = value.parse::<f32>().ok().map(|t| t / 10.0),
            "voltage" => b.voltage_mv = value.parse().ok(),
            _ => {}
        }
    }
    b
}

fn fail<T>(msg: impl Into<String>) -> Result<T, AdbError> {
    Err(AdbError::Failed(msg.into()))
}

/// Overrides one reading Android reports: `level` (0-100), `status` (1-5),
/// `plugged` (`ac`, `usb` or `none`) or `temp` (degrees Celsius).
pub fn set_battery(serial: &str, key: &str, value: &str) -> Result<(), AdbError> {
    let script = match key {
        "level" => match value.parse::<u8>() {
            Ok(n) if n <= 100 => format!("dumpsys battery set level {n}"),
            _ => return fail("Battery level must be 0-100"),
        },
        "status" => match value.parse::<u8>() {
            Ok(n) if (1..=5).contains(&n) => format!("dumpsys battery set status {n}"),
            _ => return fail("Unknown battery status"),
        },
        "plugged" => match value {
            "ac" => "dumpsys battery set usb 0; dumpsys battery set ac 1".to_string(),
            "usb" => "dumpsys battery set ac 0; dumpsys battery set usb 1".to_string(),
            "none" => "dumpsys battery unplug".to_string(),
            other => return fail(format!("Unknown power source: {other:?}")),
        },
        "temp" => match value.parse::<f32>() {
            Ok(t) if (-50.0..=150.0).contains(&t) => format!("dumpsys battery set temp {}", (t * 10.0).round() as i32),
            _ => return fail("Invalid temperature"),
        },
        other => return fail(format!("Unknown battery setting: {other}")),
    };
    runner::shell(serial, &script).map(|_| ())
}

/// Stops the simulation; Android reports the real battery again.
pub fn reset_battery(serial: &str) -> Result<(), AdbError> {
    runner::shell(serial, "dumpsys battery reset").map(|_| ())
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Capture {
    pub dir: String,
    pub files: Vec<String>,
    /// Things that couldn't be collected, and why.
    pub skipped: Vec<String>,
}

/// Crash and ANR reports Android keeps in its "dropbox".
const DROPBOX_TAGS: [&str; 6] =
    ["data_app_crash", "data_app_anr", "data_app_native_crash", "system_app_crash", "system_app_anr", "system_server_crash"];

fn folder_name(serial: &str, label: &str) -> String {
    let clean = |s: &str| s.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).collect::<String>();
    format!("{}-{}", clean(serial), clean(label))
}

/// Gathers a bug report, crash and ANR reports and the recent log into a new
/// folder under `dest_dir`. Pieces the phone refuses to hand over are skipped,
/// not fatal. The full bug report takes a minute or two.
pub fn capture(serial: &str, dest_dir: &Path, label: &str) -> Result<Capture, AdbError> {
    let dir: PathBuf = dest_dir.join(folder_name(serial, label));
    std::fs::create_dir_all(&dir)?;
    let mut files = Vec::new();
    let mut skipped = Vec::new();

    let log = runner::run_bytes(&["-s", serial, "exec-out", "logcat", "-b", "all", "-d", "-v", "threadtime"]);
    match log {
        Ok(bytes) if !bytes.is_empty() => {
            std::fs::write(dir.join("logcat.txt"), bytes)?;
            files.push("logcat.txt".to_string());
        }
        Ok(_) => skipped.push("The log was empty".to_string()),
        Err(e) => skipped.push(format!("Log: {e}")),
    }

    let mut crashes = String::new();
    for tag in DROPBOX_TAGS {
        let out = runner::shell(serial, &format!("dumpsys dropbox --print {tag}")).unwrap_or_default();
        if !out.trim().is_empty() {
            crashes.push_str(&format!("===== {tag} =====\n{out}\n"));
        }
    }
    if crashes.is_empty() {
        skipped.push("No crash or ANR reports on the phone".to_string());
    } else {
        std::fs::write(dir.join("crashes-and-anrs.txt"), crashes)?;
        files.push("crashes-and-anrs.txt".to_string());
    }

    // Raw ANR trace files are system-only on most phones; try, and say so if not.
    let trace_dir = dir.join("anr");
    match runner::run(&["-s", serial, "pull", "/data/anr", &trace_dir.to_string_lossy()]) {
        Ok(_) => files.push("anr".to_string()),
        Err(_) => skipped.push("ANR trace files aren't readable on this phone (the ANR reports above still are)".to_string()),
    }

    match runner::run(&["-s", serial, "bugreport", &dir.join("bugreport.zip").to_string_lossy()]) {
        Ok(_) => files.push("bugreport.zip".to_string()),
        Err(e) => skipped.push(format!("Bug report: {e}")),
    }

    Ok(Capture { dir: dir.to_string_lossy().into_owned(), files, skipped })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_dumpsys_battery() {
        let out = "Current Battery Service state:\n  AC powered: false\n  USB powered: true\n  Wireless powered: false\n  status: 2\n  health: 2\n  level: 83\n  voltage: 4123\n  temperature: 291\n";
        let b = parse_battery(out);
        assert_eq!(b.level, Some(83));
        assert_eq!(b.status, Some(2));
        assert!(b.usb && !b.ac && !b.wireless);
        assert_eq!(b.temperature, Some(29.1));
        assert_eq!(b.voltage_mv, Some(4123));
    }

    #[test]
    fn validates_battery_settings() {
        assert!(set_battery("s", "level", "101").is_err());
        assert!(set_battery("s", "status", "9").is_err());
        assert!(set_battery("s", "plugged", "mains").is_err());
        assert!(set_battery("s", "temp", "hot").is_err());
        assert!(set_battery("s", "bogus", "1").is_err());
    }

    #[test]
    fn folder_names_are_filesystem_safe() {
        assert_eq!(folder_name("192.168.1.5:5555", "2024-01-02 10:11"), "192_168_1_5_5555-2024-01-02_10_11");
    }
}
