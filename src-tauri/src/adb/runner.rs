use std::io::ErrorKind;
use std::process::{Child, Command, Output, Stdio};

use super::AdbError;

/// Runs `adb <args>` and returns the raw process output. All adb invocations
/// go through here so binary lookup and Windows console-window hiding live in
/// one place.
fn exec(args: &[&str]) -> Result<Output, AdbError> {
    let mut cmd = Command::new("adb");
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
    let mut cmd = Command::new("adb");
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
