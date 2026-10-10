use std::collections::HashMap;
use std::path::Path;

use apk_info::Apk;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;

use super::{runner, AdbError};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct App {
    pub package: String,
    pub version_name: Option<String>,
    pub system: bool,
}

/// Lists installed packages. `include_system` also lists system/OEM apps,
/// which can number in the hundreds.
pub fn list_apps(serial: &str, include_system: bool) -> Result<Vec<App>, AdbError> {
    let flag = if include_system { "-u" } else { "-3" };
    let out = runner::run(&["-s", serial, "shell", "pm", "list", "packages", flag])?;
    let packages = parse_package_list(&out);

    let mut apps: Vec<App> = packages
        .into_iter()
        .map(|package| App { package, version_name: None, system: include_system })
        .collect();
    apps.sort_by(|a, b| a.package.cmp(&b.package));
    Ok(apps)
}

/// Version names for every installed package, from one bulk dumpsys call.
/// Slow on large devices, so it is separate from `list_apps` and meant to
/// be loaded in the background.
pub fn app_versions(serial: &str) -> Result<HashMap<String, String>, AdbError> {
    let dump = runner::run(&["-s", serial, "shell", "dumpsys", "package", "packages"])?;
    Ok(parse_version_names(&dump))
}

fn parse_package_list(output: &str) -> Vec<String> {
    output
        .lines()
        .filter_map(|l| l.trim().strip_prefix("package:"))
        .map(str::to_string)
        .collect()
}

/// Maps package name to versionName from a full `dumpsys package` dump.
fn parse_version_names(dumpsys: &str) -> HashMap<String, String> {
    let mut versions = HashMap::new();
    let mut current: Option<&str> = None;
    for line in dumpsys.lines().map(str::trim) {
        if let Some(rest) = line.strip_prefix("Package [") {
            current = rest.split(']').next();
        } else if let (Some(pkg), Some(v)) = (current, line.strip_prefix("versionName=")) {
            versions.entry(pkg.to_string()).or_insert_with(|| v.to_string());
        }
    }
    versions
}

/// Validates a package name so it can never be interpreted as a shell flag
/// or command separator by adb.
fn validate_package(package: &str) -> Result<&str, AdbError> {
    let ok = !package.is_empty()
        && package.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_');
    ok.then_some(package)
        .ok_or_else(|| AdbError::Failed(format!("Invalid package name: {package:?}")))
}

/// Launcher icon as a `data:` URL, or `None` when it can't be extracted
/// (adaptive/vector-only icons, obfuscated resources). Pulls the base APK
/// to a temp file, so it is slow and meant to run in the background.
pub fn app_icon(serial: &str, package: &str) -> Result<Option<String>, AdbError> {
    let package = validate_package(package)?;
    let listing = runner::run(&["-s", serial, "shell", "pm", "path", package])?;
    let paths: Vec<&str> = listing.lines().filter_map(|l| l.trim().strip_prefix("package:")).collect();
    let Some(remote) = paths.iter().find(|p| p.ends_with("base.apk")).or(paths.first()) else {
        return Ok(None);
    };

    let local = std::env::temp_dir().join(format!("appraiser-{}-{package}.apk", std::process::id()));
    let local_str = local.to_string_lossy().into_owned();
    let pulled = runner::run(&["-s", serial, "pull", remote, &local_str]);
    let icon = pulled.map(|_| extract_icon(&local));
    let _ = std::fs::remove_file(&local);
    Ok(icon?)
}

fn extract_icon(apk_path: &Path) -> Option<String> {
    let apk = Apk::new(apk_path).ok()?;
    let icon = apk.get_application_icon()?;
    let is_bitmap = |n: &str| n.ends_with(".png") || n.ends_with(".webp");

    let entry = if is_bitmap(&icon) {
        icon
    } else {
        // Adaptive icons resolve to XML; fall back to a legacy bitmap with
        // the same name, preferring the highest density.
        let stem = Path::new(&icon).file_stem()?.to_str()?.to_string();
        apk.namelist()
            .filter(|n| {
                n.starts_with("res/")
                    && is_bitmap(n)
                    && Path::new(n).file_stem().and_then(|s| s.to_str()) == Some(stem.as_str())
            })
            .max_by_key(|n| density_rank(n))?
            .to_string()
    };

    let (bytes, _) = apk.read(&entry).ok()?;
    let mime = if entry.ends_with(".webp") { "image/webp" } else { "image/png" };
    Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

fn density_rank(path: &str) -> u8 {
    ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]
        .iter()
        .rposition(|d| path.contains(&format!("-{d}")))
        .map_or(0, |i| i as u8 + 1)
}

/// Installs one APK, or a split APK set (a base plus config splits) from
/// several local paths.
pub fn install(serial: &str, apk_paths: &[String]) -> Result<(), AdbError> {
    if apk_paths.is_empty() {
        return Err(AdbError::Failed("No APK files given".into()));
    }
    for p in apk_paths {
        let ext = Path::new(p).extension().and_then(|e| e.to_str()).unwrap_or("");
        if !ext.eq_ignore_ascii_case("apk") {
            return Err(AdbError::Failed(format!("Not an APK file: {p}")));
        }
    }

    let subcommand = if apk_paths.len() > 1 { "install-multiple" } else { "install" };
    let mut args = vec!["-s", serial, subcommand, "-r"];
    args.extend(apk_paths.iter().map(String::as_str));
    runner::run(&args).map(|_| ())
}

pub fn uninstall(serial: &str, package: &str) -> Result<(), AdbError> {
    let package = validate_package(package)?;
    runner::run(&["-s", serial, "uninstall", package]).map(|_| ())
}

pub fn clear_data(serial: &str, package: &str) -> Result<(), AdbError> {
    let package = validate_package(package)?;
    runner::run(&["-s", serial, "shell", "pm", "clear", package]).map(|_| ())
}

pub fn force_stop(serial: &str, package: &str) -> Result<(), AdbError> {
    let package = validate_package(package)?;
    runner::run(&["-s", serial, "shell", "am", "force-stop", package]).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_package_list() {
        let out = "package:com.android.chrome\npackage:com.example.app\n";
        assert_eq!(parse_package_list(out), vec!["com.android.chrome", "com.example.app"]);
    }

    #[test]
    fn parses_version_names_from_dumpsys() {
        let dump = "Packages:\n  Package [com.a] (abc):\n    versionName=1.2.3\n    versionCode=7\n  Package [com.b] (def):\n    versionCode=1\n    versionName=9\n";
        let v = parse_version_names(dump);
        assert_eq!(v.get("com.a").map(String::as_str), Some("1.2.3"));
        assert_eq!(v.get("com.b").map(String::as_str), Some("9"));
    }

    #[test]
    fn ranks_higher_densities_first() {
        assert!(density_rank("res/mipmap-xxxhdpi-v4/ic.png") > density_rank("res/mipmap-xxhdpi-v4/ic.png"));
        assert!(density_rank("res/mipmap-xhdpi/ic.png") > density_rank("res/mipmap-hdpi/ic.png"));
    }

    #[test]
    fn rejects_unsafe_package_names() {
        assert!(validate_package("com.example.app").is_ok());
        assert!(validate_package("com.example; rm -rf /").is_err());
        assert!(validate_package("-s").is_err());
        assert!(validate_package("").is_err());
    }

    #[test]
    fn install_rejects_non_apk_paths() {
        assert!(install("serial", &["/tmp/not-an-apk.txt".into()]).is_err());
        assert!(install("serial", &[]).is_err());
    }
}
