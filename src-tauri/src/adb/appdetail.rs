//! Everything about one installed app beyond the list view: permissions,
//! storage, install source, launching, enabling/disabling and extracting its APK.

use std::path::{Path, PathBuf};

use serde::Serialize;

use super::files::unique_path;
use super::{runner, AdbError};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Permission {
    pub name: String,
    pub granted: bool,
    /// Runtime ("dangerous") permissions can be granted and revoked; the rest are fixed at install.
    pub runtime: bool,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
pub struct AppDetail {
    pub package: String,
    pub version_name: Option<String>,
    pub version_code: Option<String>,
    pub min_sdk: Option<String>,
    pub target_sdk: Option<String>,
    /// Package that installed it (e.g. `com.android.vending`); `None` for sideloads via adb.
    pub installer: Option<String>,
    pub first_install: Option<String>,
    pub last_update: Option<String>,
    pub enabled: bool,
    pub system: bool,
    pub permissions: Vec<Permission>,
    pub apk_paths: Vec<String>,
    /// Activities that declare an intent filter, as `package/.Class` components.
    pub activities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
pub struct AppStorage {
    pub app_bytes: Option<u64>,
    pub data_bytes: Option<u64>,
    pub cache_bytes: Option<u64>,
}

fn fail<T>(msg: impl Into<String>) -> Result<T, AdbError> {
    Err(AdbError::Failed(msg.into()))
}

pub(super) fn validate_package(package: &str) -> Result<&str, AdbError> {
    let ok = !package.is_empty()
        && package.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_');
    ok.then_some(package).ok_or_else(|| AdbError::Failed(format!("Invalid package name: {package:?}")))
}

fn validate_permission(name: &str) -> Result<&str, AdbError> {
    let ok = !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_');
    ok.then_some(name).ok_or_else(|| AdbError::Failed(format!("Invalid permission name: {name:?}")))
}

/// `pm` often exits 0 and reports failure in its output.
fn expect_ok(output: String) -> Result<(), AdbError> {
    let text = output.trim();
    let bad = text.contains("Failure") || text.contains("Exception") || text.starts_with("Error");
    if bad {
        return fail(text.to_string());
    }
    Ok(())
}

pub fn detail(serial: &str, package: &str) -> Result<AppDetail, AdbError> {
    let package = validate_package(package)?;
    let dump = runner::run(&["-s", serial, "shell", "dumpsys", "package", package])?;
    let mut detail = parse_detail(&dump, package);
    if !dump.contains(&format!("Package [{package}]")) {
        return fail(format!("{package} is not installed"));
    }
    let paths = runner::run(&["-s", serial, "shell", "pm", "path", package]).unwrap_or_default();
    detail.apk_paths = paths.lines().filter_map(|l| l.trim().strip_prefix("package:")).map(str::to_string).collect();
    Ok(detail)
}

fn parse_detail(dump: &str, package: &str) -> AppDetail {
    let mut d = AppDetail { package: package.to_string(), enabled: true, ..Default::default() };
    let header = format!("Package [{package}]");

    #[derive(PartialEq, Clone, Copy)]
    enum Section {
        None,
        Requested,
        Install,
        Runtime,
    }
    let mut in_package = false;
    let mut section = (Section::None, 0usize);
    let mut requested: Vec<String> = Vec::new();
    let mut install: Vec<(String, bool)> = Vec::new();
    let mut runtime: Vec<(String, bool)> = Vec::new();
    let mut resolver = "";

    for line in dump.lines() {
        let trimmed = line.trim();
        let indent = line.len() - line.trim_start().len();

        // The activity tables sit above the "Packages:" section.
        if trimmed.ends_with("Resolver Table:") {
            resolver = trimmed;
            continue;
        }
        if resolver.starts_with("Activity") && !in_package {
            let mut it = trimmed.split_whitespace();
            if let (Some(_), Some(component), Some("filter")) = (it.next(), it.next(), it.next()) {
                if component.starts_with(&format!("{package}/")) && !d.activities.iter().any(|a| a == component) {
                    d.activities.push(component.to_string());
                }
            }
        }

        if trimmed.starts_with(&header) {
            in_package = true;
            continue;
        }
        if !in_package {
            continue;
        }
        // The next package (or a sibling section) ends this one.
        if indent <= 2 && !trimmed.is_empty() {
            break;
        }

        // Leaving a permission list when the indentation drops back.
        if section.0 != Section::None && indent <= section.1 {
            section = (Section::None, 0);
        }
        match trimmed {
            "requested permissions:" => {
                section = (Section::Requested, indent);
                continue;
            }
            "install permissions:" => {
                section = (Section::Install, indent);
                continue;
            }
            "runtime permissions:" => {
                section = (Section::Runtime, indent);
                continue;
            }
            _ => {}
        }
        match section.0 {
            Section::Requested => {
                if let Some(name) = trimmed.split(':').next().filter(|n| !n.is_empty()) {
                    requested.push(name.to_string());
                }
                continue;
            }
            Section::Install | Section::Runtime => {
                if let Some((name, rest)) = trimmed.split_once(':') {
                    let granted = rest.contains("granted=true");
                    let list = if section.0 == Section::Install { &mut install } else { &mut runtime };
                    list.push((name.to_string(), granted));
                }
                continue;
            }
            Section::None => {}
        }

        for token in trimmed.split_whitespace() {
            let Some((key, value)) = token.split_once('=') else { continue };
            match key {
                "versionCode" => d.version_code = Some(value.to_string()),
                "minSdk" => d.min_sdk = Some(value.to_string()),
                "targetSdk" => d.target_sdk = Some(value.to_string()),
                _ => {}
            }
        }
        if let Some(v) = trimmed.strip_prefix("versionName=") {
            d.version_name.get_or_insert_with(|| v.to_string());
        } else if let Some(v) = trimmed.strip_prefix("firstInstallTime=") {
            d.first_install = Some(v.to_string());
        } else if let Some(v) = trimmed.strip_prefix("lastUpdateTime=") {
            d.last_update = Some(v.to_string());
        } else if let Some(v) = trimmed.strip_prefix("installerPackageName=") {
            if v != "null" {
                d.installer = Some(v.to_string());
            }
        } else if let Some(v) = trimmed.strip_prefix("installInitiatingPackageName=") {
            if v != "null" && d.installer.is_none() {
                d.installer = Some(v.to_string());
            }
        } else if trimmed.starts_with("flags=[") && trimmed.split([' ', ']']).any(|t| t == "SYSTEM") {
            d.system = true;
        } else if trimmed.starts_with("User 0:") {
            if let Some(v) = trimmed.split_whitespace().find_map(|t| t.strip_prefix("enabled=")) {
                d.enabled = matches!(v, "0" | "1");
            }
        }
    }

    let mut permissions: Vec<Permission> = Vec::new();
    let mut add = |name: &str| {
        if permissions.iter().any(|p| p.name == name) {
            return;
        }
        let permission = if let Some((_, granted)) = runtime.iter().find(|(n, _)| n == name) {
            Permission { name: name.into(), granted: *granted, runtime: true }
        } else if let Some((_, granted)) = install.iter().find(|(n, _)| n == name) {
            Permission { name: name.into(), granted: *granted, runtime: false }
        } else {
            Permission { name: name.into(), granted: false, runtime: false }
        };
        permissions.push(permission);
    };
    for name in &requested {
        add(name);
    }
    for (name, _) in runtime.iter().chain(install.iter()) {
        add(name);
    }
    permissions.sort_by(|a, b| (!a.runtime, &a.name).cmp(&(!b.runtime, &b.name)));
    d.permissions = permissions;
    d
}

/// Sizes in bytes, from `dumpsys diskstats`. Missing on phones that don't report them.
pub fn storage(serial: &str, package: &str) -> Result<AppStorage, AdbError> {
    let package = validate_package(package)?;
    let out = runner::run_combined(&["-s", serial, "shell", "dumpsys", "diskstats"])?;
    Ok(parse_storage(&out, package))
}

fn parse_storage(dump: &str, package: &str) -> AppStorage {
    fn list(dump: &str, label: &str) -> Option<serde_json::Value> {
        let line = dump.lines().find_map(|l| l.trim().strip_prefix(label))?;
        serde_json::from_str(line.trim()).ok()
    }
    let Some(names) = list(dump, "Package Names:") else { return AppStorage::default() };
    let Some(index) = names.as_array().and_then(|a| a.iter().position(|n| n.as_str() == Some(package))) else {
        return AppStorage::default();
    };
    let at = |label: &str| list(dump, label).and_then(|v| v.get(index).and_then(|n| n.as_u64()));
    AppStorage { app_bytes: at("App Sizes:"), data_bytes: at("App Data Sizes:"), cache_bytes: at("Cache Sizes:") }
}

/// Grants or revokes a runtime permission.
pub fn set_permission(serial: &str, package: &str, permission: &str, grant: bool) -> Result<(), AdbError> {
    let package = validate_package(package)?;
    let permission = validate_permission(permission)?;
    let verb = if grant { "grant" } else { "revoke" };
    expect_ok(runner::shell(serial, &format!("pm {verb} {package} {permission}"))?)
}

/// Opens the app's launcher activity.
pub fn launch(serial: &str, package: &str) -> Result<(), AdbError> {
    let package = validate_package(package)?;
    let out = runner::shell(serial, &format!("monkey -p {package} -c android.intent.category.LAUNCHER 1"))?;
    if out.contains("No activities found") || out.contains("monkey aborted") {
        return fail("This app has no launcher screen");
    }
    Ok(())
}

pub fn set_enabled(serial: &str, package: &str, enabled: bool) -> Result<(), AdbError> {
    let package = validate_package(package)?;
    let command = if enabled { "pm enable" } else { "pm disable-user --user 0" };
    expect_ok(runner::shell(serial, &format!("{command} {package}"))?)
}

/// Clears only the app's cache, keeping its data.
pub fn clear_cache(serial: &str, package: &str) -> Result<(), AdbError> {
    let package = validate_package(package)?;
    let out = runner::shell(serial, &format!("pm clear --cache-only {package}"))?;
    if out.contains("Success") {
        return Ok(());
    }
    fail(match out.trim() {
        "" => "This version of Android can't clear just the cache".to_string(),
        text => text.to_string(),
    })
}

/// Copies the app's APK (every split, if it has several) into `dest_dir`.
/// A single APK becomes `<package>.apk`; a split set goes into a `<package>` folder.
/// Returns what was written. Existing files are never overwritten.
pub fn extract_apk(serial: &str, package: &str, dest_dir: &Path) -> Result<PathBuf, AdbError> {
    let package = validate_package(package)?;
    let out = runner::run(&["-s", serial, "shell", "pm", "path", package])?;
    let remote: Vec<&str> = out.lines().filter_map(|l| l.trim().strip_prefix("package:")).collect();
    if remote.is_empty() {
        return fail(format!("{package} is not installed"));
    }
    std::fs::create_dir_all(dest_dir)?;
    if let [only] = remote[..] {
        let target = unique_path(dest_dir, &format!("{package}.apk"));
        runner::run(&["-s", serial, "pull", only, &target.to_string_lossy()])?;
        return Ok(target);
    }
    let folder = unique_path(dest_dir, package);
    std::fs::create_dir_all(&folder)?;
    for path in remote {
        runner::run(&["-s", serial, "pull", path, &folder.to_string_lossy()])?;
    }
    Ok(folder)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DUMP: &str = "\
Activity Resolver Table:
  Non-Data Actions:
      android.intent.action.MAIN:
        abc123 com.example.app/.MainActivity filter def456
        abc999 com.other/.Nope filter def999
Receiver Resolver Table:
  Non-Data Actions:
        r1 com.example.app/.BootReceiver filter r2
Packages:
  Package [com.example.app] (1a2b3c):
    userId=10123
    pkg=Package{x com.example.app}
    versionCode=42 minSdk=24 targetSdk=34
    versionName=1.2.3
    flags=[ HAS_CODE ALLOW_CLEAR_USER_DATA ]
    firstInstallTime=2024-01-02 03:04:05
    lastUpdateTime=2024-02-03 04:05:06
    installerPackageName=com.android.vending
    requested permissions:
      android.permission.INTERNET
      android.permission.CAMERA
      android.permission.ACCESS_FINE_LOCATION: restricted=true
    install permissions:
      android.permission.INTERNET: granted=true
    User 0: ceDataInode=1 installed=true hidden=false enabled=0 instant=false
      runtime permissions:
        android.permission.CAMERA: granted=true, flags=[ USER_SET ]
        android.permission.ACCESS_FINE_LOCATION: granted=false, flags=[ ]
  Package [com.next] (zz):
    versionName=9
";

    #[test]
    fn parses_package_fields() {
        let d = parse_detail(DUMP, "com.example.app");
        assert_eq!(d.version_name.as_deref(), Some("1.2.3"));
        assert_eq!(d.version_code.as_deref(), Some("42"));
        assert_eq!(d.target_sdk.as_deref(), Some("34"));
        assert_eq!(d.installer.as_deref(), Some("com.android.vending"));
        assert_eq!(d.first_install.as_deref(), Some("2024-01-02 03:04:05"));
        assert!(d.enabled);
        assert!(!d.system);
    }

    #[test]
    fn parses_permissions_runtime_first() {
        let d = parse_detail(DUMP, "com.example.app");
        let names: Vec<_> = d.permissions.iter().map(|p| (p.name.as_str(), p.granted, p.runtime)).collect();
        assert_eq!(
            names,
            vec![
                ("android.permission.ACCESS_FINE_LOCATION", false, true),
                ("android.permission.CAMERA", true, true),
                ("android.permission.INTERNET", true, false),
            ]
        );
    }

    #[test]
    fn collects_only_this_apps_activities() {
        let d = parse_detail(DUMP, "com.example.app");
        assert_eq!(d.activities, vec!["com.example.app/.MainActivity"]);
    }

    #[test]
    fn detects_disabled_and_system() {
        let dump = "  Package [a.b] (x):\n    flags=[ SYSTEM HAS_CODE ]\n    User 0: installed=true enabled=3 instant=false\n";
        let d = parse_detail(dump, "a.b");
        assert!(d.system);
        assert!(!d.enabled);
    }

    #[test]
    fn parses_diskstats() {
        let dump = "Latency: ...\nPackage Names: [\"a.b\",\"c.d\"]\nApp Sizes: [100,200]\nApp Data Sizes: [10,20]\nCache Sizes: [1,2]\n";
        assert_eq!(
            parse_storage(dump, "c.d"),
            AppStorage { app_bytes: Some(200), data_bytes: Some(20), cache_bytes: Some(2) }
        );
        assert_eq!(parse_storage(dump, "missing"), AppStorage::default());
    }

    #[test]
    fn rejects_unsafe_names() {
        assert!(validate_package("a.b; reboot").is_err());
        assert!(validate_permission("android.permission.CAMERA").is_ok());
        assert!(validate_permission("x y").is_err());
    }

    #[test]
    fn pm_failures_in_output_are_errors() {
        assert!(expect_ok("Success\n".into()).is_ok());
        assert!(expect_ok("Failure [not a changeable permission type]".into()).is_err());
        assert!(expect_ok("Exception occurred while executing 'grant':".into()).is_err());
    }
}
