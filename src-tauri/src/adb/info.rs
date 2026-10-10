use serde::Serialize;

#[derive(Debug, Default, Serialize, PartialEq, Eq)]
pub struct DeviceInfo {
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub android_version: Option<String>,
    pub sdk_level: Option<String>,
    pub battery_level: Option<u8>,
}

/// Parses `getprop` ("[key]: [value]" lines) and `dumpsys battery` output.
pub fn parse_info(getprop: &str, battery: &str) -> DeviceInfo {
    let prop = |key: &str| {
        let prefix = format!("[{key}]: [");
        getprop
            .lines()
            .find_map(|l| l.trim().strip_prefix(&prefix)?.strip_suffix(']'))
            .filter(|v| !v.is_empty())
            .map(str::to_string)
    };

    let battery_level = battery
        .lines()
        .find_map(|l| l.trim().strip_prefix("level:"))
        .and_then(|v| v.trim().parse().ok());

    DeviceInfo {
        manufacturer: prop("ro.product.manufacturer"),
        model: prop("ro.product.model"),
        android_version: prop("ro.build.version.release"),
        sdk_level: prop("ro.build.version.sdk"),
        battery_level,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_props_and_battery() {
        let props = "[ro.product.model]: [Pixel 7]\n[ro.build.version.release]: [14]\n[ro.product.manufacturer]: [Google]\n";
        let battery = "Current Battery Service state:\n  AC powered: false\n  level: 85\n";
        let info = parse_info(props, battery);
        assert_eq!(info.model.as_deref(), Some("Pixel 7"));
        assert_eq!(info.android_version.as_deref(), Some("14"));
        assert_eq!(info.battery_level, Some(85));
        assert_eq!(info.sdk_level, None);
    }
}
