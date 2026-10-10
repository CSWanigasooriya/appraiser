use std::ffi::OsString;
use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, Instant};

use super::AdbError;

static BUNDLED_ADB: OnceLock<PathBuf> = OnceLock::new();

/// Points all adb calls at the adb shipped inside the app's resources, if
/// `platform_tools_dir` contains one. Otherwise `adb` is looked up on PATH
/// (the dev-mode case).
pub fn use_bundled(platform_tools_dir: &Path) {
    let exe = platform_tools_dir.join(if cfg!(windows) { "adb.exe" } else { "adb" });
    if exe.is_file() {
        let _ = BUNDLED_ADB.set(exe);
    }
}

fn program() -> OsString {
    BUNDLED_ADB
        .get()
        .map(|p| p.clone().into_os_string())
        .unwrap_or_else(|| "adb".into())
}

/// Runs `adb <args>` and returns the raw process output. All adb invocations
/// go through here so binary lookup and Windows console-window hiding live in
/// one place.
fn exec(args: &[&str]) -> Result<Output, AdbError> {
    let mut cmd = Command::new(program());
    cmd.args(args);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.output().map_err(|e| match e.kind() {
        ErrorKind::NotFound => AdbError::NotFound,
        _ => AdbError::Io(e),
    })
}

fn check(output: Output) -> Result<Vec<u8>, AdbError> {
    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(AdbError::Failed(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ))
    }
}

/// Returns stdout as text, or an error if adb exits non-zero.
pub fn run(args: &[&str]) -> Result<String, AdbError> {
    let bytes = check(exec(args)?)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Starts `adb <args>` with piped stdout/stderr for long-running streams.
pub fn spawn_stream(args: &[&str]) -> Result<Child, AdbError> {
    let mut cmd = Command::new(program());
    // stdin stays open (held by the Child): adb ends an exec-out stream on stdin EOF.
    cmd.args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }

    cmd.spawn().map_err(|e| match e.kind() {
        ErrorKind::NotFound => AdbError::NotFound,
        _ => AdbError::Io(e),
    })
}

/// Returns raw stdout bytes (e.g. screenshots).
pub fn run_bytes(args: &[&str]) -> Result<Vec<u8>, AdbError> {
    check(exec(args)?)
}

/// For user-entered shell commands: a non-zero exit is not an error, the
/// user wants to see whatever the command printed.
pub fn run_combined(args: &[&str]) -> Result<String, AdbError> {
    let out = exec(args)?;
    let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&out.stderr));
    Ok(text)
}

/// Like `run`, but gives up (and kills adb) after `limit`. For commands such
/// as `adb connect` that can hang for a long time on an unreachable host.
pub fn run_timeout(args: &[&str], limit: Duration) -> Result<String, AdbError> {
    let mut child = spawn_stream(args)?;
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let out = thread::spawn(move || read_all(stdout.as_mut()));
    let err = thread::spawn(move || read_all(stderr.as_mut()));

    let deadline = Instant::now() + limit;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break Some(status);
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        thread::sleep(Duration::from_millis(50));
    };
    let stdout = out.join().unwrap_or_default();
    let stderr = err.join().unwrap_or_default();
    match status {
        None => Err(AdbError::Failed("Timed out".into())),
        Some(s) if s.success() => Ok(String::from_utf8_lossy(&stdout).into_owned()),
        Some(_) => Err(AdbError::Failed(String::from_utf8_lossy(&stderr).trim().to_string())),
    }
}

fn read_all(pipe: Option<&mut impl Read>) -> Vec<u8> {
    let mut buf = Vec::new();
    if let Some(p) = pipe {
        let _ = p.read_to_end(&mut buf);
    }
    buf
}

/// Runs a script in the phone's shell and returns its combined output; a
/// non-zero exit is not an error (see `run_combined`).
pub fn shell(serial: &str, script: &str) -> Result<String, AdbError> {
    run_combined(&["-s", serial, "shell", script])
}

/// Quotes a string for the phone's shell, so any value is passed through literally.
pub fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}
