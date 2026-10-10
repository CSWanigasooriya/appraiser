//! Android 11+ "Pair device with QR code".
//!
//! The computer shows a QR encoding `WIFI:T:ADB;S:<name>;P:<password>;;`. After
//! the phone scans it, it advertises an mDNS `_adb-tls-pairing._tcp` service
//! named `<name>`; we pair there, then connect to its separate debugging port.

use std::{
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant},
};

use qrcode::{render::svg, QrCode};
use rand::{distributions::Alphanumeric, Rng};
use serde::Serialize;

use super::{connect_quick, pair, runner, AdbError};

const TIMEOUT: Duration = Duration::from_secs(120);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// Incremented on every start/cancel so a stale wait loop knows to stop.
static SESSION: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize)]
pub struct QrSession {
    pub svg: String,
    pub name: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct QrPairingResult {
    pub connected: bool,
    pub message: String,
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

/// Blocks until the phone scans the QR and is paired and connected, the session is
/// cancelled, or the timeout elapses.
pub fn finish(name: &str, password: &str) -> Result<QrPairingResult, AdbError> {
    let session = SESSION.load(Ordering::SeqCst);
    let deadline = Instant::now() + TIMEOUT;

    while Instant::now() < deadline {
        if SESSION.load(Ordering::SeqCst) != session {
            return Err(AdbError::Failed("Cancelled".into()));
        }
        let services = runner::run(&["mdns", "services"])?;
        if let Some(addr) = find_pairing_addr(&services, name) {
            pair(&addr, password)?;
            return connect_paired_device(&addr, session);
        }
        thread::sleep(Duration::from_secs(1));
    }
    Err(AdbError::Failed(
        "Timed out waiting for the phone to scan the code. Make sure both devices are on the same Wi-Fi network.".into(),
    ))
}

fn connect_paired_device(pairing_addr: &str, session: u64) -> Result<QrPairingResult, AdbError> {
    let deadline = Instant::now() + CONNECT_TIMEOUT;
    while Instant::now() < deadline {
        if SESSION.load(Ordering::SeqCst) != session {
            return Err(AdbError::Failed("Cancelled".into()));
        }
        // Pairing and debugging use different ports. In particular, don't rely
        // on adb's mDNS auto-connect after pairing: Windows can miss that step.
        if let Ok(services) = runner::run_timeout(&["mdns", "services"], Duration::from_secs(4)) {
            let connected = connect_discovered_device(&services, pairing_addr, |addr| {
                if SESSION.load(Ordering::SeqCst) != session || Instant::now() >= deadline {
                    return Err(AdbError::Failed("Cancelled or timed out".into()));
                }
                connect_quick(addr)
            });
            if SESSION.load(Ordering::SeqCst) != session {
                return Err(AdbError::Failed("Cancelled".into()));
            }
            if connected {
                return Ok(QrPairingResult { connected: true, message: "Paired and connected.".into() });
            }
        }
        thread::sleep(Duration::from_secs(1));
    }
    if SESSION.load(Ordering::SeqCst) != session {
        return Err(AdbError::Failed("Cancelled".into()));
    }
    Ok(QrPairingResult {
        connected: false,
        message: "Paired, but couldn't connect automatically. Enter the IP address and port from the phone's main Wireless debugging screen.".into(),
    })
}

/// Try every debugging endpoint on the paired phone, since mDNS can retain a
/// stale port alongside the current one. Never connect to other discovered phones.
fn connect_discovered_device(
    output: &str,
    pairing_addr: &str,
    mut connect: impl FnMut(&str) -> Result<String, AdbError>,
) -> bool {
    let Some((host, _)) = pairing_addr.rsplit_once(':') else { return false };
    output.lines().filter_map(parse_service).any(|(_, service, addr)| {
        service == "_adb-tls-connect._tcp"
            && addr.rsplit_once(':').is_some_and(|(h, _)| h == host)
            && connect(addr).is_ok()
    })
}

/// Read from the right: Windows service names can contain a suffix like ` (2)`.
fn parse_service(line: &str) -> Option<(&str, &str, &str)> {
    let line = line.trim();
    let addr_start = line.rfind(char::is_whitespace)?;
    let addr = &line[addr_start + 1..];
    let head = line[..addr_start].trim_end();
    let service_start = head.rfind(char::is_whitespace)?;
    Some((head[..service_start].trim_end(), &head[service_start + 1..], addr))
}

/// Finds the `ip:port` of our pairing service in `adb mdns services` output:
/// `<name>\t_adb-tls-pairing._tcp\t<ip:port>`.
fn find_pairing_addr(output: &str, name: &str) -> Option<String> {
    output.lines().find_map(|l| {
        let (n, service, addr) = parse_service(l)?;
        (n == name && service == "_adb-tls-pairing._tcp").then(|| addr.to_string())
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

    #[test]
    fn connects_after_pairing_despite_a_stale_windows_service() {
        let services = "List of discovered mdns services\n\
other-phone\t_adb-tls-connect._tcp\t192.168.1.10:40000\n\
adbgui-test\t_adb-tls-pairing._tcp\t192.168.1.9:37123\n\
adb-phone\t_adb-tls-connect._tcp\t192.168.1.9:46097\n\
adb-phone (2)\t_adb-tls-connect._tcp\t192.168.1.9:41839\n";
        let mut attempts = Vec::new();
        let connected = connect_discovered_device(services, "192.168.1.9:37123", |addr| {
            attempts.push(addr.to_string());
            if addr == "192.168.1.9:41839" {
                Ok("connected to 192.168.1.9:41839".into())
            } else {
                Err(AdbError::Failed("Connection refused".into()))
            }
        });
        assert!(connected);
        assert_eq!(attempts, ["192.168.1.9:46097", "192.168.1.9:41839"]);
    }

    #[test]
    fn pairing_success_does_not_imply_connection_success() {
        let services = "adbgui-test _adb-tls-pairing._tcp 192.168.1.9:37123\n\
adb-phone _adb-tls-connect._tcp 192.168.1.9:40000\n";
        assert!(!connect_discovered_device(services, "192.168.1.9:37123", |_| {
            Err(AdbError::Failed("Connection refused".into()))
        }));
        assert!(!connect_discovered_device("", "192.168.1.9:37123", |_| {
            panic!("No endpoint was discovered")
        }));
    }
}
