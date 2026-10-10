use std::{thread, time::Duration};

use super::{runner, AdbError};

const DEFAULT_PORT: u16 = 5555;

/// Rejects anything that isn't a plain `host:port`-ish token, so user input
/// can never be interpreted by adb as a flag.
fn validate_addr(addr: &str) -> Result<&str, AdbError> {
    let addr = addr.trim();
    let ok = !addr.is_empty()
        && !addr.starts_with('-')
        && addr.chars().all(|c| c.is_ascii_alphanumeric() || ".:-_".contains(c));
    if ok {
        Ok(addr)
    } else {
        Err(AdbError::Failed(format!("Invalid address: {addr:?}")))
    }
}

/// adb reports most connection failures on stdout with exit code 0, so the
/// output text is the only reliable success signal.
fn expect_output(output: String, success_prefixes: &[&str]) -> Result<String, AdbError> {
    let text = output.trim().to_string();
    if success_prefixes.iter().any(|p| text.starts_with(p)) {
        Ok(text)
    } else {
        Err(AdbError::Failed(text))
    }
}

pub fn connect(addr: &str) -> Result<String, AdbError> {
    let addr = validate_addr(addr)?;
    let out = runner::run(&["connect", addr])?;
    expect_output(out, &["connected to", "already connected to"])
}

/// Like `connect`, but gives up after a few seconds: a phone that is off the
/// network would otherwise keep adb waiting.
pub fn connect_quick(addr: &str) -> Result<String, AdbError> {
    let addr = validate_addr(addr)?;
    let out = runner::run_timeout(&["connect", addr], Duration::from_secs(4))?;
    expect_output(out, &["connected to", "already connected to"])
}

pub fn pair(addr: &str, code: &str) -> Result<String, AdbError> {
    let addr = validate_addr(addr)?;
    let code = code.trim();
    if code.is_empty() || !code.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(AdbError::Failed("Pairing code must be letters/digits only".into()));
    }
    let out = runner::run(&["pair", addr, code])?;
    expect_output(out, &["Successfully paired"])
}

pub fn disconnect(addr: &str) -> Result<(), AdbError> {
    let addr = validate_addr(addr)?;
    runner::run(&["disconnect", addr]).map(|_| ())
}

/// Switches a USB-connected device to TCP/IP mode and connects to it over
/// Wi-Fi. Returns the `ip:port` it connected to.
pub fn enable_wireless(serial: &str) -> Result<String, AdbError> {
    let ip_out = runner::run(&["-s", serial, "shell", "ip", "-f", "inet", "addr", "show", "wlan0"])?;
    let ip = parse_wlan_ip(&ip_out).ok_or_else(|| {
        AdbError::Failed("Couldn't find the device's Wi-Fi address. Is it connected to Wi-Fi?".into())
    })?;

    runner::run(&["-s", serial, "tcpip", &DEFAULT_PORT.to_string()])?;

    // adbd restarts in TCP mode; give it a moment and retry.
    let addr = format!("{ip}:{DEFAULT_PORT}");
    let mut last_err = None;
    for _ in 0..5 {
        thread::sleep(Duration::from_secs(1));
        match connect(&addr) {
            Ok(_) => return Ok(addr),
            Err(e) => last_err = Some(e),
        }
    }
    Err(last_err.unwrap_or_else(|| AdbError::Failed("Could not connect".into())))
}

fn parse_wlan_ip(output: &str) -> Option<String> {
    output.lines().find_map(|l| {
        let rest = l.trim().strip_prefix("inet ")?;
        Some(rest.split('/').next()?.split_whitespace().next()?.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_wlan_ip() {
        let out = "22: wlan0: <BROADCAST,MULTICAST,UP> mtu 1500\n    inet 192.168.1.42/24 brd 192.168.1.255 scope global wlan0\n";
        assert_eq!(parse_wlan_ip(out).as_deref(), Some("192.168.1.42"));
        assert_eq!(parse_wlan_ip("no address"), None);
    }

    #[test]
    fn rejects_flag_like_and_spaced_addresses() {
        assert!(validate_addr("-s").is_err());
        assert!(validate_addr("1.2.3.4:5555 extra").is_err());
        assert!(validate_addr("192.168.1.5:5555").is_ok());
    }

    #[test]
    fn connect_output_check() {
        assert!(expect_output("connected to 1.2.3.4:5555\n".into(), &["connected to"]).is_ok());
        assert!(expect_output("failed to connect to 1.2.3.4:5555".into(), &["connected to"]).is_err());
    }
}
