use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DeviceState {
    Online,
    Offline,
    Unauthorized,
    Other,
}

impl DeviceState {
    fn parse(s: &str) -> Self {
        match s {
            "device" => Self::Online,
            "offline" => Self::Offline,
            "unauthorized" => Self::Unauthorized,
            _ => Self::Other,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Device {
    pub serial: String,
    pub state: DeviceState,
    pub model: Option<String>,
    pub product: Option<String>,
    pub transport_id: Option<String>,
}

/// Parses the output of `adb devices -l`.
pub fn parse_devices(output: &str) -> Vec<Device> {
    output
        .lines()
        .skip_while(|l| !l.starts_with("List of devices"))
        .skip(1)
        .filter_map(parse_line)
        .collect()
}

fn parse_line(line: &str) -> Option<Device> {
    let mut parts = line.split_whitespace();
    let serial = parts.next()?.to_string();
    let state = DeviceState::parse(parts.next()?);

    let mut device = Device {
        serial,
        state,
        model: None,
        product: None,
        transport_id: None,
    };
    for part in parts {
        match part.split_once(':') {
            Some(("model", v)) => device.model = Some(v.replace('_', " ")),
            Some(("product", v)) => device.product = Some(v.to_string()),
            Some(("transport_id", v)) => device.transport_id = Some(v.to_string()),
            _ => {}
        }
    }
    Some(device)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_devices_and_skips_daemon_noise() {
        let out = "* daemon started successfully\n\
List of devices attached\n\
emulator-5554          device product:sdk_gphone model:sdk_gphone64_arm64 device:emu transport_id:1\n\
R58M123ABC             unauthorized usb:1-1 transport_id:2\n\
\n";
        let devices = parse_devices(out);
        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].serial, "emulator-5554");
        assert_eq!(devices[0].state, DeviceState::Online);
        assert_eq!(devices[0].model.as_deref(), Some("sdk gphone64 arm64"));
        assert_eq!(devices[1].state, DeviceState::Unauthorized);
    }

    #[test]
    fn empty_list() {
        assert!(parse_devices("List of devices attached\n\n").is_empty());
    }
}
