//! Port forwarding, proxy and radio switches.

use serde::Serialize;

use super::runner;
use super::AdbError;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Forward {
    /// `adb reverse` (phone reaches this computer) instead of `adb forward`.
    pub reverse: bool,
    /// The first address given to adb: this computer's for a forward, the phone's for a reverse.
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
pub struct NetworkState {
    pub wifi: Option<bool>,
    pub mobile_data: Option<bool>,
    pub airplane: Option<bool>,
    /// `host:port`, if a global proxy is set.
    pub proxy: Option<String>,
}

fn fail<T>(msg: impl Into<String>) -> Result<T, AdbError> {
    Err(AdbError::Failed(msg.into()))
}

pub fn forwards(serial: &str) -> Result<Vec<Forward>, AdbError> {
    let mut all = Vec::new();
    // `forward --list` covers every device, so keep only this one's lines.
    let out = runner::run(&["-s", serial, "forward", "--list"])?;
    for line in out.lines() {
        let t: Vec<&str> = line.split_whitespace().collect();
        if let [s, from, to] = t[..] {
            if s == serial {
                all.push(Forward { reverse: false, from: from.into(), to: to.into() });
            }
        }
    }
    let out = runner::run(&["-s", serial, "reverse", "--list"]).unwrap_or_default();
    for line in out.lines() {
        let t: Vec<&str> = line.split_whitespace().collect();
        if let [_, from, to] = t[..] {
            all.push(Forward { reverse: true, from: from.into(), to: to.into() });
        }
    }
    Ok(all)
}

/// `tcp:8080` and friends. Anything else could smuggle in extra adb arguments.
fn socket(spec: &str) -> Result<&str, AdbError> {
    const KINDS: [&str; 6] = ["tcp:", "localabstract:", "localreserved:", "localfilesystem:", "local:", "jdwp:"];
    let spec = spec.trim();
    let ok = KINDS.iter().any(|k| spec.strip_prefix(k).is_some_and(|rest| !rest.is_empty()))
        && !spec.chars().any(|c| c.is_whitespace() || c.is_control());
    if !ok {
        return fail(format!("Not a valid address: {spec:?} (use e.g. tcp:8080)"));
    }
    Ok(spec)
}

pub fn add_forward(serial: &str, reverse: bool, from: &str, to: &str) -> Result<(), AdbError> {
    let (from, to) = (socket(from)?, socket(to)?);
    let verb = if reverse { "reverse" } else { "forward" };
    runner::run(&["-s", serial, verb, from, to]).map(|_| ())
}

pub fn remove_forward(serial: &str, reverse: bool, from: &str) -> Result<(), AdbError> {
    let from = socket(from)?;
    let verb = if reverse { "reverse" } else { "forward" };
    runner::run(&["-s", serial, verb, "--remove", from]).map(|_| ())
}

pub fn state(serial: &str) -> Result<NetworkState, AdbError> {
    let out = runner::shell(
        serial,
        "echo wifi=$(settings get global wifi_on); echo data=$(settings get global mobile_data); \
         echo airplane=$(settings get global airplane_mode_on); echo proxy=$(settings get global http_proxy)",
    )?;
    Ok(parse_state(&out))
}

fn parse_state(out: &str) -> NetworkState {
    let mut s = NetworkState::default();
    let on = |v: &str| match v.trim() {
        "null" | "" => None,
        v => Some(v != "0"),
    };
    for line in out.lines() {
        let Some((key, value)) = line.trim().split_once('=') else { continue };
        match key {
            "wifi" => s.wifi = on(value),
            "data" => s.mobile_data = on(value),
            "airplane" => s.airplane = on(value),
            // ":0" is how Android spells "no proxy".
            "proxy" => s.proxy = Some(value.trim().to_string()).filter(|p| !matches!(p.as_str(), "" | "null" | ":0")),
            _ => {}
        }
    }
    s
}

fn check(out: String) -> Result<(), AdbError> {
    let text = out.trim();
    if text.contains("Error") || text.contains("Exception") || text.contains("Unknown") {
        return fail(text.to_string());
    }
    Ok(())
}

pub fn set_wifi(serial: &str, on: bool) -> Result<(), AdbError> {
    check(runner::shell(serial, &format!("svc wifi {}", if on { "enable" } else { "disable" }))?)
}

pub fn set_mobile_data(serial: &str, on: bool) -> Result<(), AdbError> {
    check(runner::shell(serial, &format!("svc data {}", if on { "enable" } else { "disable" }))?)
}

pub fn set_airplane(serial: &str, on: bool) -> Result<(), AdbError> {
    let out = runner::shell(serial, &format!("cmd connectivity airplane-mode {}", if on { "enable" } else { "disable" }))?;
    if check(out).is_ok() {
        return Ok(());
    }
    // Android 10 and older have no such command: flip the setting and announce it.
    let n = u8::from(on);
    check(runner::shell(
        serial,
        &format!(
            "settings put global airplane_mode_on {n}; \
             am broadcast -a android.intent.action.AIRPLANE_MODE --ez state {on}"
        ),
    )?)
}

/// Sets the global HTTP proxy to `host:port`, or clears it when `proxy` is `None`.
pub fn set_proxy(serial: &str, proxy: Option<&str>) -> Result<(), AdbError> {
    let value = match proxy {
        None => ":0",
        Some(p) => {
            let ok = p.rsplit_once(':').is_some_and(|(host, port)| {
                !host.is_empty()
                    && host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
                    && port.parse::<u16>().is_ok_and(|n| n > 0)
            });
            if !ok {
                return fail(format!("Use host:port, e.g. 192.168.1.10:8888 (got {p:?})"));
            }
            p
        }
    };
    check(runner::shell(serial, &format!("settings put global http_proxy {value}"))?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_known_socket_kinds() {
        assert!(socket("tcp:8080").is_ok());
        assert!(socket("localabstract:chrome_devtools_remote").is_ok());
        assert!(socket("tcp:").is_err());
        assert!(socket("tcp:80 --remove-all").is_err());
        assert!(socket("--list").is_err());
    }

    #[test]
    fn parses_network_state() {
        let s = parse_state("wifi=1\ndata=null\nairplane=0\nproxy=:0\n");
        assert_eq!(s, NetworkState { wifi: Some(true), mobile_data: None, airplane: Some(false), proxy: None });
        let s = parse_state("proxy=10.0.0.2:8888\n");
        assert_eq!(s.proxy.as_deref(), Some("10.0.0.2:8888"));
    }

    #[test]
    fn proxy_must_be_host_and_port() {
        assert!(set_proxy("s", Some("host name:80")).is_err());
        assert!(set_proxy("s", Some("a.b:0")).is_err());
        assert!(set_proxy("s", Some("nohost")).is_err());
        assert!(set_proxy("s", Some("a;reboot:80")).is_err());
    }
}
