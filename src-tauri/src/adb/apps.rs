use std::collections::HashMap;
use std::path::Path;

use serde::Serialize;

use super::{runner, AdbError};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct App {
    pub package: String,
    pub version_name: Option<String>,
    pub system: bool,
    /// Device path of the base APK. Changes whenever the app updates, so it
    /// doubles as a cache key for anything derived from the APK (icons).
    pub apk_path: Option<String>,
}

/// Lists installed packages. `include_system` also lists system/OEM apps,
/// which can number in the hundreds.
pub fn list_apps(serial: &str, include_system: bool) -> Result<Vec<App>, AdbError> {
    let flag = if include_system { "-u" } else { "-3" };
    let out = runner::run(&["-s", serial, "shell", "pm", "list", "packages", "-f", flag])?;
    let packages = parse_package_list(&out);

    let mut apps: Vec<App> = packages
        .into_iter()
        .map(|(package, apk_path)| App { package, version_name: None, system: include_system, apk_path })
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

/// Parses `package:<apk path>=<package>` lines (`pm list packages -f`).
fn parse_package_list(output: &str) -> Vec<(String, Option<String>)> {
    output
        .lines()
        .filter_map(|l| l.trim().strip_prefix("package:"))
        .map(|rest| match rest.rsplit_once('=') {
            Some((path, package)) => (package.to_string(), Some(path.to_string())),
            None => (rest.to_string(), None),
        })
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
        let out = "package:/data/app/~~x==/com.android.chrome-y==/base.apk=com.android.chrome\npackage:com.example.app\n";
        assert_eq!(
            parse_package_list(out),
            vec![
                ("com.android.chrome".to_string(), Some("/data/app/~~x==/com.android.chrome-y==/base.apk".to_string())),
                ("com.example.app".to_string(), None),
            ]
        );
    }

    #[test]
    fn parses_version_names_from_dumpsys() {
        let dump = "Packages:\n  Package [com.a] (abc):\n    versionName=1.2.3\n    versionCode=7\n  Package [com.b] (def):\n    versionCode=1\n    versionName=9\n";
        let v = parse_version_names(dump);
        assert_eq!(v.get("com.a").map(String::as_str), Some("1.2.3"));
        assert_eq!(v.get("com.b").map(String::as_str), Some("9"));
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
