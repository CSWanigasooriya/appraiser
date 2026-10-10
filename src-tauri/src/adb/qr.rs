//! Android 11+ "Pair device with QR code".
//!
//! The computer shows a QR encoding `WIFI:T:ADB;S:<name>;P:<password>;;`. After
//! the phone scans it, it advertises an mDNS `_adb-tls-pairing._tcp` service
//! named `<name>`; we find that address and run `adb pair <addr> <password>`.

use std::{
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant},
};

use qrcode::{render::svg, QrCode};
use rand::{distributions::Alphanumeric, Rng};
use serde::Serialize;

use super::{pair, runner, AdbError};

const TIMEOUT: Duration = Duration::from_secs(120);

/// Incremented on every start/cancel so a stale wait loop knows to stop.
static SESSION: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize)]
pub struct QrSession {
    pub svg: String,
    pub name: String,
    pub password: String,
}

fn random_token(len: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(len)
        .map(char::from)
        .collect()
}

pub fn start() -> Result<QrSession, AdbError> {
    SESSION.fetch_add(1, Ordering::SeqCst);
    let name = format!("adbgui-{}", random_token(6));
    let password = random_token(12);
    let payload = format!("WIFI:T:ADB;S:{name};P:{password};;");

    let code = QrCode::new(payload.as_bytes()).map_err(|e| AdbError::Failed(e.to_string()))?;
    let svg = code
        .render::<svg::Color>()
        .min_dimensions(256, 256)
        .dark_color(svg::Color("#000000"))
        .light_color(svg::Color("#ffffff"))
        .build();
    Ok(QrSession { svg, name, password })
}

pub fn cancel() {
    SESSION.fetch_add(1, Ordering::SeqCst);
}

/// Blocks until the phone scans the QR and is paired, the session is
/// cancelled, or the timeout elapses.
pub fn finish(name: &str, password: &str) -> Result<String, AdbError> {
    let session = SESSION.load(Ordering::SeqCst);
    let deadline = Instant::now() + TIMEOUT;

    while Instant::now() < deadline {
        if SESSION.load(Ordering::SeqCst) != session {
            return Err(AdbError::Failed("Cancelled".into()));
        }
        let services = runner::run(&["mdns", "services"])?;
        if let Some(addr) = find_pairing_addr(&services, name) {
            return pair(&addr, password);
        }
        thread::sleep(Duration::from_secs(1));
    }
    Err(AdbError::Failed(
        "Timed out waiting for the phone to scan the code. Make sure both devices are on the same Wi-Fi network.".into(),
    ))
}

/// Finds the `ip:port` of our pairing service in `adb mdns services` output:
/// `<name>\t_adb-tls-pairing._tcp\t<ip:port>`.
fn find_pairing_addr(output: &str, name: &str) -> Option<String> {
    output.lines().find_map(|l| {
        let mut parts = l.split_whitespace();
        let (n, service, addr) = (parts.next()?, parts.next()?, parts.next()?);
        (n == name && service.contains("_adb-tls-pairing")).then(|| addr.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_our_pairing_service() {
        let out = "List of discovered mdns services\n\
adb-ABC123\t_adb-tls-connect._tcp\t192.168.1.9:40000\n\
adbgui-x1y2z3\t_adb-tls-pairing._tcp\t192.168.1.9:37123\n";
        assert_eq!(find_pairing_addr(out, "adbgui-x1y2z3").as_deref(), Some("192.168.1.9:37123"));
        assert_eq!(find_pairing_addr(out, "other"), None);
    }

    #[test]
    fn qr_session_has_svg_and_matching_credentials() {
        let s = start().unwrap();
        assert!(s.svg.contains("<svg"));
        assert!(s.name.starts_with("adbgui-"));
        assert_eq!(s.password.len(), 12);
    }
}
