//! Browsing and transferring files on the phone, through adb.

use std::path::{Path, PathBuf};

use serde::Serialize;

use super::runner::{self, sh_quote};
use super::AdbError;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Dir,
    File,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    pub kind: Kind,
    pub size: u64,
    /// `YYYY-MM-DD HH:MM`, as the phone reports it.
    pub modified: String,
    /// e.g. `rw-rw----`.
    pub permissions: String,
}

fn fail<T>(msg: impl Into<String>) -> Result<T, AdbError> {
    Err(AdbError::Failed(msg.into()))
}

/// An absolute, normalized path on the phone. Rejects anything that could
/// change meaning in a shell command or climb out of the folder it names.
fn validate_path(path: &str) -> Result<&str, AdbError> {
    if !path.starts_with('/') {
        return fail(format!("Not an absolute path: {path}"));
    }
    if path.chars().any(|c| c == '\0' || c == '\n' || c == '\r') {
        return fail("Path contains an invalid character");
    }
    if path.split('/').any(|part| part == "..") {
        return fail("Paths can't contain '..'");
    }
    Ok(path)
}

/// A single file or folder name (no directory part).
fn validate_name(name: &str) -> Result<&str, AdbError> {
    let bad = name.is_empty()
        || name == "."
        || name == ".."
        || name.contains(['/', '\0', '\n', '\r']);
    if bad {
        return fail(format!("Invalid name: {name:?}"));
    }
    Ok(name)
}

fn components(path: &str) -> usize {
    path.split('/').filter(|p| !p.is_empty()).count()
}

/// Deleting or moving needs a path at least two levels deep (so never `/`,
/// `/sdcard` or `/data`).
fn validate_target(path: &str) -> Result<&str, AdbError> {
    let path = validate_path(path)?;
    if components(path) < 2 {
        return fail(format!("Refusing to change a top-level folder: {path}"));
    }
    Ok(path)
}

fn join(dir: &str, name: &str) -> String {
    format!("{}/{}", dir.trim_end_matches('/'), name)
}

/// Lists a folder: folders first, then files, each sorted by name.
pub fn list(serial: &str, path: &str) -> Result<Vec<Entry>, AdbError> {
    let path = validate_path(path)?;
    // The trailing slash makes `ls` look inside symlinked roots like /sdcard.
    let dir = format!("{}/", path.trim_end_matches('/'));
    let out = runner::run_combined(&["-s", serial, "shell", &format!("ls -lAL {}", sh_quote(&dir))])?;
    if out.lines().all(|l| l.trim().is_empty() || l.starts_with("total")) && !out.trim().is_empty() {
        return Ok(Vec::new()); // an empty folder prints just "total 0"
    }
    let mut entries = parse_ls(&out);
    if entries.is_empty() && !out.trim().is_empty() && !out.starts_with("total") {
        // Nothing parsed: it's an error message such as "Permission denied".
        return fail(out.trim().to_string());
    }
    entries.sort_by(|a, b| {
        (a.kind != Kind::Dir, a.name.to_lowercase()).cmp(&(b.kind != Kind::Dir, b.name.to_lowercase()))
    });
    Ok(entries)
}

/// Parses `ls -lA` output (toybox format: `perms links owner group size date time name`).
fn parse_ls(output: &str) -> Vec<Entry> {
    output.lines().filter_map(parse_ls_line).collect()
}

fn parse_ls_line(line: &str) -> Option<Entry> {
    let mut it = line.split_whitespace();
    let mode = it.next()?;
    let mut chars = mode.chars();
    let kind = match chars.next()? {
        'd' => Kind::Dir,
        '-' | 'l' => Kind::File,
        _ => return None, // devices, sockets, pipes, "total N"
    };
    let permissions: String = chars.take(9).collect();
    if permissions.len() != 9 {
        return None;
    }
    let _links = it.next()?;
    let _owner = it.next()?;
    let _group = it.next()?;
    let size: u64 = it.next()?.parse().ok()?;
    let date = it.next()?;
    let time = it.next()?;
    if date.len() != 10 || !time.contains(':') {
        return None;
    }
    // The name is everything after the time, spaces included.
    let after_time = line.find(time).map(|i| i + time.len())?;
    let name = line[after_time..].trim_start();
    let name = name.split(" -> ").next().unwrap_or(name);
    if name.is_empty() {
        return None;
    }
    Some(Entry { name: name.to_string(), kind, size, modified: format!("{date} {time}"), permissions })
}

/// Copies phone files/folders into `dest_dir` on this computer. An existing
/// name is never overwritten: the copy gets ` (1)`, ` (2)`... instead.
/// Returns the paths written.
pub fn download(serial: &str, remote: &[String], dest_dir: &Path) -> Result<Vec<PathBuf>, AdbError> {
    std::fs::create_dir_all(dest_dir)?;
    let mut written = Vec::new();
    for path in remote {
        let path = validate_path(path)?;
        let name = path.rsplit('/').find(|p| !p.is_empty()).ok_or_else(|| AdbError::Failed("Empty path".into()))?;
        let target = unique_path(dest_dir, name);
        runner::run(&["-s", serial, "pull", "-a", path, &target.to_string_lossy()])?;
        written.push(target);
    }
    Ok(written)
}

/// `dir/name`, or `dir/name (n)` (before the extension) if that already exists.
pub(super) fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rfind('.').filter(|&i| i > 0) {
        Some(i) => (&name[..i], &name[i..]),
        None => (name, ""),
    };
    (1..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .expect("an unbounded range always yields a free name")
}

/// Writes `bytes` to `dir/name` (creating `dir`), picking a free ` (n)` name if
/// it's taken. Returns where it landed.
pub fn save_unique(dir: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf, AdbError> {
    std::fs::create_dir_all(dir)?;
    let target = unique_path(dir, validate_name(name)?);
    std::fs::write(&target, bytes)?;
    Ok(target)
}

/// Copies files/folders from this computer into the phone folder `remote_dir`.
pub fn upload(serial: &str, local: &[String], remote_dir: &str) -> Result<(), AdbError> {
    let remote_dir = validate_path(remote_dir)?;
    for path in local {
        if !Path::new(path).exists() {
            return fail(format!("No such file: {path}"));
        }
        runner::run(&["-s", serial, "push", path, &format!("{}/", remote_dir.trim_end_matches('/'))])?;
    }
    Ok(())
}

pub fn delete(serial: &str, paths: &[String]) -> Result<(), AdbError> {
    for path in paths {
        let path = validate_target(path)?;
        runner::run(&["-s", serial, "shell", &format!("rm -rf {}", sh_quote(path))])?;
    }
    Ok(())
}

pub fn rename(serial: &str, path: &str, new_name: &str) -> Result<(), AdbError> {
    let path = validate_target(path)?;
    let new_name = validate_name(new_name)?;
    let parent = path.rsplit_once('/').map_or("", |(p, _)| p);
    let to = join(parent, new_name);
    runner::run(&["-s", serial, "shell", &format!("mv -n {} {}", sh_quote(path), sh_quote(&to))])?;
    Ok(())
}

pub fn make_dir(serial: &str, parent: &str, name: &str) -> Result<(), AdbError> {
    let parent = validate_path(parent)?;
    let name = validate_name(name)?;
    runner::run(&["-s", serial, "shell", &format!("mkdir {}", sh_quote(&join(parent, name)))])?;
    Ok(())
}

/// A file's bytes, for previews. Refuses files larger than `max` bytes.
pub fn read(serial: &str, path: &str, max: u64) -> Result<Vec<u8>, AdbError> {
    let path = validate_path(path)?;
    let size = runner::run(&["-s", serial, "shell", &format!("stat -L -c %s {}", sh_quote(path))])?;
    match size.trim().parse::<u64>() {
        Ok(n) if n > max => fail(format!("File is too large to preview ({n} bytes)")),
        Ok(_) => runner::run_bytes(&["-s", serial, "exec-out", &format!("cat {}", sh_quote(path))]),
        Err(_) => fail(size.trim().to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LS: &str = "total 1880\n\
-rw-r--r-- 1 root root 898454 2026-08-07 07:10 NOTICE.xml.gz\n\
drwxr-xr-x 2 root root    111 2026-08-07 07:10 aconfig\n\
drwxrws--- 24 media_rw media_rw 3452 2026-10-10 03:00 My Photos & Videos\n\
lrwxrwxrwx 1 root root 21 2024-01-01 00:00 sdcard -> /storage/self/primary\n\
crw-rw-rw- 1 root root 1, 3 2024-01-01 00:00 null\n";

    #[test]
    fn parses_toybox_listing() {
        let e = parse_ls(LS);
        assert_eq!(e.len(), 4);
        assert_eq!(e[0], Entry { name: "NOTICE.xml.gz".into(), kind: Kind::File, size: 898454, modified: "2026-08-07 07:10".into(), permissions: "rw-r--r--".into() });
        assert_eq!(e[1].kind, Kind::Dir);
        assert_eq!(e[2].name, "My Photos & Videos"); // spaces and symbols survive
        assert_eq!(e[3].name, "sdcard"); // the link target is dropped
    }

    #[test]
    fn name_that_looks_like_a_date_is_kept() {
        let e = parse_ls_line("-rw-r--r-- 1 u0_a1 u0_a1 5 2026-01-02 10:11 2026-01-02 10:11 backup").unwrap();
        assert_eq!(e.name, "2026-01-02 10:11 backup");
    }

    #[test]
    fn quotes_for_the_shell() {
        assert_eq!(sh_quote("a b"), "'a b'");
        assert_eq!(sh_quote("it's"), r"'it'\''s'");
        assert_eq!(sh_quote("$(reboot);ls"), "'$(reboot);ls'");
    }

    #[test]
    fn validates_paths_and_names() {
        assert!(validate_path("/sdcard/DCIM").is_ok());
        assert!(validate_path("sdcard").is_err());
        assert!(validate_path("/sdcard/../data").is_err());
        assert!(validate_path("/sdcard/a\nb").is_err());
        assert!(validate_name("photo.jpg").is_ok());
        assert!(validate_name("a/b").is_err());
        assert!(validate_name("..").is_err());
        assert!(validate_name("").is_err());
        assert!(validate_target("/sdcard/Download").is_ok());
        assert!(validate_target("/sdcard").is_err());
        assert!(validate_target("/").is_err());
    }

    #[test]
    fn joins_without_doubling_slashes() {
        assert_eq!(join("/sdcard/", "x"), "/sdcard/x");
        assert_eq!(join("/sdcard", "x"), "/sdcard/x");
    }

    #[test]
    fn picks_a_free_local_name() {
        let dir = std::env::temp_dir().join(format!("appraiser-files-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.txt"), "x").unwrap();
        std::fs::write(dir.join("a (1).txt"), "x").unwrap();
        std::fs::write(dir.join("noext"), "x").unwrap();
        assert_eq!(unique_path(&dir, "fresh.txt"), dir.join("fresh.txt"));
        assert_eq!(unique_path(&dir, "a.txt"), dir.join("a (2).txt"));
        assert_eq!(unique_path(&dir, "noext"), dir.join("noext (1)"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Needs a connected device: `APPRAISER_SERIAL=<serial> cargo test -- --ignored files_live --nocapture`
    /// Works only in the scratch folder /data/local/tmp.
    #[test]
    #[ignore]
    fn files_live() {
        let serial = std::env::var("APPRAISER_SERIAL").unwrap();
        let dir = "/data/local/tmp/appraiser-files-test";
        let _ = delete(&serial, &[dir.to_string()]);
        let tmp = std::env::temp_dir().join(format!("appraiser-live-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let local = tmp.join("hello world's file.txt");
        std::fs::write(&local, "hi there").unwrap();

        make_dir(&serial, "/data/local/tmp", "appraiser-files-test").unwrap();
        make_dir(&serial, dir, "sub folder").unwrap();
        upload(&serial, &[local.to_string_lossy().into_owned()], dir).unwrap();
        let listed = list(&serial, dir).unwrap();
        println!("listed: {listed:?}");
        assert_eq!(listed[0].name, "sub folder"); // folders first
        assert_eq!(listed[1].name, "hello world's file.txt");
        assert_eq!(listed[1].size, 8);

        rename(&serial, &format!("{dir}/hello world's file.txt"), "renamed.txt").unwrap();
        assert_eq!(read(&serial, &format!("{dir}/renamed.txt"), 100).unwrap(), b"hi there");
        assert!(read(&serial, &format!("{dir}/renamed.txt"), 3).is_err()); // too large for the cap

        let out = tmp.join("down");
        let got = download(&serial, &[format!("{dir}/renamed.txt")], &out).unwrap();
        let again = download(&serial, &[format!("{dir}/renamed.txt")], &out).unwrap();
        assert_eq!(std::fs::read_to_string(&got[0]).unwrap(), "hi there");
        assert!(again[0].to_string_lossy().contains("renamed (1).txt"));

        assert!(delete(&serial, &["/sdcard".to_string()]).is_err());
        delete(&serial, &[dir.to_string()]).unwrap();
        assert!(list(&serial, dir).is_err());
        println!("denied: {:?}", list(&serial, "/data/data").err().map(|e| e.to_string()));
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
