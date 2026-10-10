//! App launcher icons. Pulling a whole APK is far too slow over Wi-Fi (a
//! 16 MB APK took a minute), so the device's own `unzip` streams out only the
//! manifest, the resource table and the one icon file. Results are cached on
//! disk, keyed by the APK path, which changes whenever the app updates.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::{Cursor, Write};
use std::path::Path;

use apk_info::Apk;
use base64::{engine::general_purpose::STANDARD, Engine};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

use super::{runner, AdbError};

/// Launcher icon as a `data:` URL, or `None` when none can be found
/// (vector-only icons, obfuscated resources). Slow on a cache miss, so call
/// it from the background.
pub fn app_icon(
    serial: &str,
    package: &str,
    apk_path: &str,
    cache_dir: Option<&Path>,
) -> Result<Option<String>, AdbError> {
    // Reaches a device shell below, so only allow plain path characters.
    if !is_safe(apk_path) {
        return Err(AdbError::Failed(format!("Unsafe APK path: {apk_path:?}")));
    }

    let cache_file = cache_dir.map(|d| {
        let mut h = DefaultHasher::new();
        (package, apk_path).hash(&mut h);
        d.join(format!("{:016x}", h.finish()))
    });
    if let Some(hit) = cache_file.as_deref().and_then(read_cache) {
        return Ok(hit);
    }

    let icon = fetch_icon(serial, apk_path)?.map(|(bytes, mime)| to_data_url(&bytes, mime));
    if let Some(file) = &cache_file {
        write_cache(file, icon.as_deref());
    }
    Ok(icon)
}

fn is_safe(s: &str) -> bool {
    !s.is_empty()
        && s.chars().all(|c| c.is_ascii_alphanumeric() || "/._~=+-".contains(c))
}

/// `Some(None)` is a cached "no icon", so misses aren't retried every time.
fn read_cache(file: &Path) -> Option<Option<String>> {
    let text = std::fs::read_to_string(file).ok()?;
    Some((!text.is_empty()).then_some(text))
}

/// Icons are a few KB each; this only guards against years of app updates
/// and many phones piling up stale entries.
const MAX_CACHE_BYTES: u64 = 20_000_000;

fn write_cache(file: &Path, icon: Option<&str>) {
    let Some(dir) = file.parent() else { return };
    let _ = std::fs::create_dir_all(dir);
    let _ = std::fs::write(file, icon.unwrap_or(""));
    prune_cache(dir, MAX_CACHE_BYTES);
}

/// Deletes the oldest entries until the directory fits within `limit` bytes.
fn prune_cache(dir: &Path, limit: u64) {
    let Ok(read) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = read
        .flatten()
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            Some((m.modified().ok()?, m.len(), e.path()))
        })
        .collect();
    let mut total: u64 = entries.iter().map(|e| e.1).sum();
    if total <= limit {
        return;
    }
    entries.sort();
    for (_, len, path) in entries {
        if total <= limit {
            break;
        }
        if std::fs::remove_file(path).is_ok() {
            total -= len;
        }
    }
}

fn to_data_url(bytes: &[u8], mime: &str) -> String {
    format!("data:{mime};base64,{}", STANDARD.encode(bytes))
}

/// Streams one file out of the APK via the device's `unzip`.
fn unzip_entry(serial: &str, apk_path: &str, entry: &str) -> Result<Vec<u8>, AdbError> {
    runner::run_bytes(&["-s", serial, "exec-out", "unzip", "-p", apk_path, entry])
}

/// Resource tables above this are too slow to stream over Wi-Fi.
const MAX_TABLE_BYTES: u64 = 3_000_000;

/// Conventional launcher icon names, best first. Matching these from the file
/// listing alone avoids streaming the (often huge) resource table.
const COMMON_NAMES: [&str; 6] = ["ic_launcher", "app_icon", "ic_app_icon", "ic_launcher_new", "icon", "ic_logo"];

fn fetch_icon(serial: &str, apk_path: &str) -> Result<Option<(Vec<u8>, &'static str)>, AdbError> {
    let listing = runner::run(&["-s", serial, "shell", "unzip", "-l", apk_path])?;
    let files = parse_listing(&listing);

    let entry = match guess_launcher_bitmap(&files) {
        Some(n) => n,
        None => match resolve_from_manifest(serial, apk_path, &files)? {
            Some(n) => n,
            None => return Ok(None),
        },
    };
    if !is_safe(&entry) {
        return Ok(None);
    }

    let bytes = unzip_entry(serial, apk_path, &entry)?;
    let mime = if entry.ends_with(".webp") { "image/webp" } else { "image/png" };
    Ok((!bytes.is_empty()).then_some((bytes, mime)))
}

/// Exact but slower: read `android:icon` from the manifest and resource table.
fn resolve_from_manifest(
    serial: &str,
    apk_path: &str,
    files: &[(u64, String)],
) -> Result<Option<String>, AdbError> {
    let table_size = files.iter().find(|(_, n)| n == "resources.arsc").map_or(0, |(s, _)| *s);
    if table_size > MAX_TABLE_BYTES {
        return Ok(None);
    }
    let manifest = unzip_entry(serial, apk_path, "AndroidManifest.xml")?;
    let table = unzip_entry(serial, apk_path, "resources.arsc").unwrap_or_default();
    let Some(icon) = icon_resource(&manifest, &table) else {
        return Ok(None);
    };
    if is_bitmap(&icon) {
        return Ok(Some(icon));
    }
    // Adaptive icons resolve to XML; look for a legacy bitmap of the same name.
    Ok(legacy_bitmap(&icon, files.iter().map(|(_, n)| n.as_str())))
}

/// Parses `unzip -l` output into (size, name) pairs.
fn parse_listing(listing: &str) -> Vec<(u64, String)> {
    listing
        .lines()
        .filter_map(|l| {
            let mut f = l.split_whitespace();
            let size = f.next()?.parse().ok()?;
            let name = f.last()?;
            Some((size, name.to_string()))
        })
        .collect()
}

fn guess_launcher_bitmap(files: &[(u64, String)]) -> Option<String> {
    let names = || files.iter().map(|(_, n)| n.as_str());
    COMMON_NAMES
        .iter()
        .find_map(|stem| legacy_bitmap(&format!("{stem}.png"), names()))
}

/// Resolves `android:icon` to a path inside the APK, by parsing a minimal
/// zip holding just the manifest and resource table.
fn icon_resource(manifest: &[u8], table: &[u8]) -> Option<String> {
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    zip.start_file("AndroidManifest.xml", opts).ok()?;
    zip.write_all(manifest).ok()?;
    if !table.is_empty() {
        zip.start_file("resources.arsc", opts).ok()?;
        zip.write_all(table).ok()?;
    }
    let bytes = zip.finish().ok()?.into_inner();

    // apk-info only opens files, so go through a temp file.
    let tmp = std::env::temp_dir().join(format!("appraiser-icon-{}-{:x}.zip", std::process::id(), {
        let mut h = DefaultHasher::new();
        std::thread::current().id().hash(&mut h);
        manifest.len().hash(&mut h);
        h.finish()
    }));
    std::fs::write(&tmp, bytes).ok()?;
    let icon = Apk::new(&tmp).ok().and_then(|apk| apk.get_application_icon());
    let _ = std::fs::remove_file(&tmp);
    icon
}

fn is_bitmap(name: &str) -> bool {
    name.ends_with(".png") || name.ends_with(".webp")
}

/// Best bitmap under `res/` sharing the icon's file name (highest density).
fn legacy_bitmap<'a>(icon: &str, names: impl Iterator<Item = &'a str>) -> Option<String> {
    let stem = Path::new(icon).file_stem()?.to_str()?;
    names
        .filter(|n| {
            n.starts_with("res/")
                && is_bitmap(n)
                && Path::new(n).file_stem().and_then(|s| s.to_str()) == Some(stem)
        })
        .max_by_key(|n| density_rank(n))
        .map(str::to_string)
}

fn density_rank(path: &str) -> u8 {
    ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]
        .iter()
        .rposition(|d| path.contains(&format!("-{d}")))
        .map_or(0, |i| i as u8 + 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranks_higher_densities_first() {
        assert!(density_rank("res/mipmap-xxxhdpi-v4/ic.png") > density_rank("res/mipmap-xxhdpi-v4/ic.png"));
        assert!(density_rank("res/mipmap-xhdpi/ic.png") > density_rank("res/mipmap-hdpi/ic.png"));
    }

    #[test]
    fn picks_densest_legacy_bitmap() {
        let names = ["res/mipmap-hdpi-v4/ic_launcher.png", "res/mipmap-xxhdpi-v4/ic_launcher.png", "res/mipmap-xxxhdpi-v4/other.png"];
        let got = legacy_bitmap("res/mipmap-anydpi-v26/ic_launcher.xml", names.into_iter());
        assert_eq!(got.as_deref(), Some("res/mipmap-xxhdpi-v4/ic_launcher.png"));
    }

    #[test]
    fn guesses_icon_from_listing_and_parses_it() {
        let listing = "  Length   Date  Time  Name\n  ------  ---- ---- ----\n   1200 01-01 00:00 res/mipmap-xxhdpi-v4/ic_launcher.png\n   300 01-01 00:00 res/drawable/other.png\n  2589036 01-01 00:00 resources.arsc\n";
        let files = parse_listing(listing);
        assert_eq!(files.len(), 3);
        assert_eq!(guess_launcher_bitmap(&files).as_deref(), Some("res/mipmap-xxhdpi-v4/ic_launcher.png"));
    }

    #[test]
    fn prune_drops_oldest_until_under_limit() {
        let dir = std::env::temp_dir().join(format!("appraiser-prune-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for i in 0..4 {
            std::fs::write(dir.join(format!("f{i}")), [0u8; 10]).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        prune_cache(&dir, 25);
        let left = std::fs::read_dir(&dir).unwrap().count();
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(left, 2);
    }

    #[test]
    fn rejects_shell_metacharacters() {
        assert!(is_safe("/data/app/~~a==/com.x-b==/base.apk"));
        assert!(!is_safe("/data/app/x; reboot"));
        assert!(!is_safe(""));
    }

    /// Needs a connected device: `APPRAISER_SERIAL=<serial> cargo test -- --ignored icon_live`
    #[test]
    #[ignore]
    fn icon_live() {
        let serial = std::env::var("APPRAISER_SERIAL").unwrap();
        let out = runner::run(&["-s", &serial, "shell", "pm", "list", "packages", "-f", "-3"]).unwrap();
        for line in out.lines().take(6) {
            let (path, pkg) = line.trim().strip_prefix("package:").unwrap().rsplit_once('=').unwrap();
            let t = std::time::Instant::now();
            let icon = app_icon(&serial, pkg, path, None).unwrap();
            println!("{pkg}: {} bytes in {:?}", icon.map_or(0, |i| i.len()), t.elapsed());
        }
    }
}
