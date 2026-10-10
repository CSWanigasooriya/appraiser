//! Launches scrcpy's server on the phone. Android's own `screenrecord` is
//! unreliable on recent versions (it hangs on Android 16), while scrcpy's
//! server drives MediaCodec directly and works everywhere. We only reuse the
//! phone-side jar; the client (framing, decoding, UI) is our own.

use std::process::Child;

use super::{runner, AdbError};

/// The server is compiled from `vendor/scrcpy` by `build.rs`, which also
/// reports its version here: the server refuses to talk to a client that
/// passes any other version.
pub const VERSION: &str = env!("SCRCPY_VERSION");
const JAR: &[u8] = include_bytes!(env!("SCRCPY_SERVER_JAR"));
const REMOTE_DIR: &str = "/data/local/tmp";
const REMOTE_PREFIX: &str = "appraiser-scrcpy-server-";

const MAX_SIZE: &str = "1280";
const BIT_RATE: &str = "8000000";

/// Where the bundled jar lives on the phone. The name carries a hash of the
/// jar's bytes, so a rebuilt server is never mistaken for the old one.
fn remote_jar() -> String {
    use std::hash::{DefaultHasher, Hash, Hasher};
    let mut h = DefaultHasher::new();
    JAR.hash(&mut h);
    format!("{REMOTE_DIR}/{REMOTE_PREFIX}{VERSION}-{:016x}.jar", h.finish())
}

/// Pushes the server jar unless the phone already has this exact build, and
/// removes jars left behind by other builds.
pub fn ensure_server(serial: &str) -> Result<(), AdbError> {
    let remote = remote_jar();
    let present = runner::run(&["-s", serial, "shell", "stat", "-c", "%s", &remote])
        .is_ok_and(|s| s.trim().parse::<usize>().ok() == Some(JAR.len()));
    if present {
        return Ok(());
    }
    let _ = runner::run(&["-s", serial, "shell", "rm", "-f", &format!("{REMOTE_DIR}/{REMOTE_PREFIX}*.jar")]);
    let local = std::env::temp_dir().join(format!("appraiser-scrcpy-server-{}.jar", std::process::id()));
    std::fs::write(&local, JAR)?;
    let pushed = runner::run(&["-s", serial, "push", &local.to_string_lossy(), &remote]);
    let _ = std::fs::remove_file(&local);
    pushed.map(|_| ())
}

/// Random per-session id so concurrent sessions don't share a socket name.
pub fn new_scid() -> String {
    format!("{:08x}", rand::random::<u32>() & 0x7fff_ffff)
}

/// Forwards a free local TCP port to the server's socket; returns the port.
pub fn forward(serial: &str, scid: &str) -> Result<u16, AdbError> {
    let target = format!("localabstract:scrcpy_{scid}");
    let out = runner::run(&["-s", serial, "forward", "tcp:0", &target])?;
    out.trim()
        .parse()
        .map_err(|_| AdbError::Failed(format!("Unexpected adb forward output: {out:?}")))
}

pub fn remove_forward(serial: &str, port: u16) {
    let _ = runner::run(&["-s", serial, "forward", "--remove", &format!("tcp:{port}")]);
}

/// Starts the server with video (H.264), raw PCM audio (48 kHz, 16-bit,
/// stereo) and a control channel, each on its own forwarded connection.
pub fn spawn_server(serial: &str, scid: &str) -> Result<Child, AdbError> {
    let classpath = format!("CLASSPATH={}", remote_jar());
    let scid_arg = format!("scid={scid}");
    let max_size = format!("max_size={MAX_SIZE}");
    let bit_rate = format!("video_bit_rate={BIT_RATE}");
    runner::spawn_stream(&[
        "-s", serial, "shell", &classpath, "app_process", "/", "com.genymobile.scrcpy.Server", VERSION,
        &scid_arg, "tunnel_forward=true", "audio=true", "audio_codec=raw", "control=true", "cleanup=false",
        "clipboard_autosync=false", "log_level=warn", &max_size, &bit_rate,
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scid_is_8_hex_digits_below_2_pow_31() {
        let id = new_scid();
        assert_eq!(id.len(), 8);
        assert!(u32::from_str_radix(&id, 16).unwrap() < 1 << 31);
    }

    #[test]
    fn remote_jar_name_is_stable_and_safe_for_a_shell() {
        let name = remote_jar();
        assert_eq!(name, remote_jar());
        assert!(name.starts_with(&format!("/data/local/tmp/appraiser-scrcpy-server-{VERSION}-")));
        assert!(name.chars().all(|c| c.is_ascii_alphanumeric() || "/-._".contains(c)));
    }

    #[test]
    fn bundled_jar_is_a_zip() {
        assert_eq!(&JAR[..2], b"PK");
    }
}
