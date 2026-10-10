//! Developer-facing system settings: touch and layout overlays, animation
//! speed, stay-awake, dark mode, font size, screen density and resolution.

use serde::Serialize;

use super::runner;
use super::AdbError;

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct DevSettings {
    pub show_touches: bool,
    pub pointer_location: bool,
    pub layout_bounds: bool,
    pub stay_awake: bool,
    pub dont_keep_activities: bool,
    /// `yes`, `no` or `auto`.
    pub dark_mode: Option<String>,
    pub animation_scale: f32,
    pub font_scale: f32,
    pub density: Option<u32>,
    pub default_density: Option<u32>,
    /// `WIDTHxHEIGHT`
    pub size: Option<String>,
    pub default_size: Option<String>,
}

const READ_SCRIPT: &str = "\
echo show_touches=$(settings get system show_touches); \
echo pointer_location=$(settings get system pointer_location); \
echo layout=$(getprop debug.layout); \
echo stay_awake=$(settings get global stay_on_while_plugged_in); \
echo dont_keep=$(settings get global always_finish_activities); \
echo anim=$(settings get global window_animation_scale); \
echo font=$(settings get system font_scale); \
cmd uimode night; wm density; wm size";

pub fn read(serial: &str) -> Result<DevSettings, AdbError> {
    Ok(parse(&runner::shell(serial, READ_SCRIPT)?))
}

fn truthy(v: &str) -> bool {
    matches!(v.trim(), "1" | "true")
}

fn parse(out: &str) -> DevSettings {
    let mut s = DevSettings { animation_scale: 1.0, font_scale: 1.0, ..Default::default() };
    for line in out.lines().map(str::trim) {
        if let Some((key, value)) = line.split_once('=') {
            match key {
                "show_touches" => s.show_touches = truthy(value),
                "pointer_location" => s.pointer_location = truthy(value),
                "layout" => s.layout_bounds = truthy(value),
                // Any "stay on while plugged in" bit (AC, USB, wireless) counts as on.
                "stay_awake" => s.stay_awake = value.trim().parse::<u32>().is_ok_and(|n| n != 0),
                "dont_keep" => s.dont_keep_activities = truthy(value),
                "anim" => s.animation_scale = value.trim().parse().unwrap_or(1.0),
                "font" => s.font_scale = value.trim().parse().unwrap_or(1.0),
                _ => {}
            }
        } else if let Some(v) = line.strip_prefix("Night mode:") {
            s.dark_mode = Some(v.trim().to_string());
        } else if let Some(v) = line.strip_prefix("Physical density:") {
            s.default_density = v.trim().parse().ok();
            s.density = s.density.or(s.default_density);
        } else if let Some(v) = line.strip_prefix("Override density:") {
            s.density = v.trim().parse().ok();
        } else if let Some(v) = line.strip_prefix("Physical size:") {
            s.default_size = Some(v.trim().to_string());
            s.size = s.size.take().or_else(|| s.default_size.clone());
        } else if let Some(v) = line.strip_prefix("Override size:") {
            s.size = Some(v.trim().to_string());
        }
    }
    s
}

fn fail<T>(msg: impl Into<String>) -> Result<T, AdbError> {
    Err(AdbError::Failed(msg.into()))
}

fn flag(value: &str) -> Result<&'static str, AdbError> {
    match value {
        "1" | "true" => Ok("1"),
        "0" | "false" => Ok("0"),
        other => fail(format!("Expected on or off, got {other:?}")),
    }
}

fn scale(value: &str) -> Result<f32, AdbError> {
    match value.parse::<f32>() {
        Ok(v) if (0.0..=10.0).contains(&v) => Ok(v),
        _ => fail(format!("Invalid scale: {value:?}")),
    }
}

/// The shell script that applies one setting.
fn script(key: &str, value: &str) -> Result<String, AdbError> {
    Ok(match key {
        "show_touches" => format!("settings put system show_touches {}", flag(value)?),
        "pointer_location" => format!("settings put system pointer_location {}", flag(value)?),
        "stay_awake" => format!("settings put global stay_on_while_plugged_in {}", if flag(value)? == "1" { 7 } else { 0 }),
        "dont_keep_activities" => format!("settings put global always_finish_activities {}", flag(value)?),
        // The property alone only applies to apps started afterwards; the service call redraws running ones.
        "layout_bounds" => format!(
            "setprop debug.layout {}; service call activity 1599295570 >/dev/null",
            if flag(value)? == "1" { "true" } else { "false" }
        ),
        "animation_scale" => {
            let v = scale(value)?;
            format!(
                "settings put global window_animation_scale {v}; settings put global transition_animation_scale {v}; \
                 settings put global animator_duration_scale {v}"
            )
        }
        "font_scale" => format!("settings put system font_scale {}", scale(value)?),
        "dark_mode" => match value {
            "yes" | "no" | "auto" => format!("cmd uimode night {value}"),
            other => return fail(format!("Unknown dark mode: {other:?}")),
        },
        "density" if value == "reset" => "wm density reset".into(),
        "density" => match value.parse::<u32>() {
            Ok(d) if (72..=1200).contains(&d) => format!("wm density {d}"),
            _ => return fail(format!("Invalid density: {value:?}")),
        },
        "size" if value == "reset" => "wm size reset".into(),
        "size" => {
            let ok = value.split_once('x').is_some_and(|(w, h)| {
                [w, h].iter().all(|n| n.parse::<u32>().is_ok_and(|n| (100..=10_000).contains(&n)))
            });
            if !ok {
                return fail(format!("Invalid size (use WIDTHxHEIGHT): {value:?}"));
            }
            format!("wm size {value}")
        }
        other => return fail(format!("Unknown setting: {other}")),
    })
}

pub fn set(serial: &str, key: &str, value: &str) -> Result<(), AdbError> {
    let out = runner::shell(serial, &script(key, value)?)?;
    let text = out.trim();
    if text.contains("Error") || text.contains("Exception") || text.contains("Bad ") {
        return fail(text.to_string());
    }
    Ok(())
}

/// Puts every setting above back to Android's default.
pub fn reset(serial: &str) -> Result<(), AdbError> {
    for (key, value) in [
        ("show_touches", "0"),
        ("pointer_location", "0"),
        ("layout_bounds", "0"),
        ("stay_awake", "0"),
        ("dont_keep_activities", "0"),
        ("animation_scale", "1"),
        ("font_scale", "1"),
        ("dark_mode", "auto"),
        ("density", "reset"),
        ("size", "reset"),
    ] {
        set(serial, key, value)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_settings_output() {
        let out = "show_touches=1\npointer_location=0\nlayout=\nstay_awake=7\ndont_keep=null\nanim=0.5\nfont=1.15\n\
                   Night mode: auto\nPhysical density: 420\nOverride density: 480\nPhysical size: 1080x2400\n";
        let s = parse(out);
        assert!(s.show_touches && !s.pointer_location && !s.layout_bounds && s.stay_awake && !s.dont_keep_activities);
        assert_eq!(s.animation_scale, 0.5);
        assert_eq!(s.font_scale, 1.15);
        assert_eq!(s.dark_mode.as_deref(), Some("auto"));
        assert_eq!((s.density, s.default_density), (Some(480), Some(420)));
        assert_eq!((s.size.as_deref(), s.default_size.as_deref()), (Some("1080x2400"), Some("1080x2400")));
    }

    #[test]
    fn builds_scripts_and_rejects_bad_values() {
        assert_eq!(script("show_touches", "1").unwrap(), "settings put system show_touches 1");
        assert_eq!(script("stay_awake", "0").unwrap(), "settings put global stay_on_while_plugged_in 0");
        assert_eq!(script("size", "1080x1920").unwrap(), "wm size 1080x1920");
        assert!(script("show_touches", "yes please").is_err());
        assert!(script("density", "1; reboot").is_err());
        assert!(script("size", "1080x; reboot").is_err());
        assert!(script("animation_scale", "abc").is_err());
        assert!(script("bogus", "1").is_err());
    }
}
