//! Wireless devices the app remembers, so it can reconnect them when they
//! come back on the network.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::device::{Device, DeviceState};

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SavedDevice {
    /// `ip:port`
    pub addr: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Saved {
    #[serde(default = "yes")]
    pub auto_reconnect: bool,
    #[serde(default)]
    pub devices: Vec<SavedDevice>,
}

impl Default for Saved {
    fn default() -> Self {
        Self { auto_reconnect: true, devices: Vec::new() }
    }
}

/// More than this and the oldest are forgotten, so reconnect rounds stay short.
const MAX_SAVED: usize = 10;

pub fn load(path: &Path) -> Saved {
    std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub fn save(path: &Path, saved: &Saved) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(path, serde_json::to_string_pretty(saved)?)
}

/// `192.168.1.5:5555`, as opposed to an mDNS name that adb finds by itself.
pub fn is_tcp_addr(serial: &str) -> bool {
    serial.rsplit_once(':').is_some_and(|(host, port)| {
        !host.is_empty() && host.chars().all(|c| c.is_ascii_digit() || c == '.') && port.parse::<u16>().is_ok()
    })
}

/// Adds the connected wireless devices that aren't saved yet. True if anything changed.
pub fn remember(saved: &mut Saved, devices: &[Device]) -> bool {
    let mut changed = false;
    for d in devices.iter().filter(|d| d.state == DeviceState::Online && is_tcp_addr(&d.serial)) {
        match saved.devices.iter_mut().find(|s| s.addr == d.serial) {
            Some(existing) => {
                if existing.name.is_none() && d.model.is_some() {
                    existing.name = d.model.clone();
                    changed = true;
                }
            }
            None => {
                saved.devices.push(SavedDevice { addr: d.serial.clone(), name: d.model.clone() });
                changed = true;
            }
        }
    }
    if saved.devices.len() > MAX_SAVED {
        let extra = saved.devices.len() - MAX_SAVED;
        saved.devices.drain(..extra);
        changed = true;
    }
    changed
}

pub fn forget(saved: &mut Saved, addr: &str) -> bool {
    let before = saved.devices.len();
    saved.devices.retain(|d| d.addr != addr);
    saved.devices.len() != before
}

/// Saved addresses that adb doesn't list at all right now.
pub fn missing(saved: &Saved, devices: &[Device]) -> Vec<String> {
    saved.devices.iter().filter(|s| !devices.iter().any(|d| d.serial == s.addr)).map(|s| s.addr.clone()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dev(serial: &str, state: DeviceState) -> Device {
        Device { serial: serial.into(), state, model: Some("Pixel 8".into()), product: None, transport_id: None }
    }

    #[test]
    fn only_ip_addresses_count() {
        assert!(is_tcp_addr("192.168.1.5:5555"));
        assert!(!is_tcp_addr("adb-ABC._adb-tls-connect._tcp"));
        assert!(!is_tcp_addr("emulator-5554"));
        assert!(!is_tcp_addr("R58M123ABC"));
    }

    #[test]
    fn remembers_online_wireless_devices_once() {
        let mut saved = Saved::default();
        let devices = [dev("192.168.1.5:5555", DeviceState::Online), dev("USB123", DeviceState::Online)];
        assert!(remember(&mut saved, &devices));
        assert!(!remember(&mut saved, &devices));
        assert_eq!(saved.devices, vec![SavedDevice { addr: "192.168.1.5:5555".into(), name: Some("Pixel 8".into()) }]);
        assert!(!remember(&mut saved, &[dev("10.0.0.2:5555", DeviceState::Offline)]));
    }

    #[test]
    fn finds_missing_and_forgets() {
        let mut saved = Saved::default();
        remember(&mut saved, &[dev("192.168.1.5:5555", DeviceState::Online)]);
        assert!(missing(&saved, &[dev("192.168.1.5:5555", DeviceState::Offline)]).is_empty());
        assert_eq!(missing(&saved, &[]), vec!["192.168.1.5:5555"]);
        assert!(forget(&mut saved, "192.168.1.5:5555"));
        assert!(!forget(&mut saved, "192.168.1.5:5555"));
    }

    #[test]
    fn round_trips_and_tolerates_junk() {
        let dir = std::env::temp_dir().join(format!("appraiser-known-{}", std::process::id()));
        let path = dir.join("wireless.json");
        assert_eq!(load(&path), Saved::default());
        let mut saved = Saved { auto_reconnect: false, devices: vec![] };
        remember(&mut saved, &[dev("192.168.1.5:5555", DeviceState::Online)]);
        save(&path, &saved).unwrap();
        assert_eq!(load(&path), saved);
        std::fs::write(&path, "not json").unwrap();
        assert_eq!(load(&path), Saved::default());
        let _ = std::fs::remove_dir_all(dir);
    }
}
