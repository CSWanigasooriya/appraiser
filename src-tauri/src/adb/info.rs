use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Default, Serialize, PartialEq, Eq)]
pub struct Section {
    pub title: String,
    pub rows: Vec<(String, String)>,
}

#[derive(Debug, Default, Serialize, PartialEq, Eq)]
pub struct DeviceInfo {
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub android_version: Option<String>,
    pub sdk_level: Option<String>,
    pub battery_level: Option<u8>,
    /// Grouped, human-readable details. Empty rows are omitted.
    pub sections: Vec<Section>,
    /// Every `getprop` entry, sorted by key.
    pub props: Vec<(String, String)>,
}

/// One round trip: each command is preceded by an `@@name` marker line so the
/// output can be split afterwards. Every command is best-effort.
pub const SCRIPT: &str = "\
echo @@getprop; getprop; \
echo @@battery; dumpsys battery; \
echo @@meminfo; cat /proc/meminfo; \
echo @@df; df -k /data; \
echo @@uptime; cat /proc/uptime; \
echo @@uname; uname -a; \
echo @@wm; wm size; wm density; \
echo @@cpu; cat /proc/cpuinfo; \
echo @@ip; ip -f inet addr show wlan0; \
echo @@mac; cat /sys/class/net/wlan0/address; \
echo @@selinux; getenforce; \
echo @@androidid; settings get secure android_id; \
echo @@devname; settings get global device_name; \
echo @@wifi; dumpsys wifi | grep -m1 mWifiInfo; \
echo @@end";

fn split_sections(dump: &str) -> HashMap<&str, String> {
    let mut map: HashMap<&str, String> = HashMap::new();
    let mut current: Option<&str> = None;
    for line in dump.lines() {
        if let Some(name) = line.trim_end().strip_prefix("@@") {
            current = Some(name);
            map.entry(name).or_default();
        } else if let Some(name) = current {
            let buf = map.get_mut(name).unwrap();
            buf.push_str(line);
            buf.push('\n');
        }
    }
    map
}

fn parse_props(getprop: &str) -> Vec<(String, String)> {
    let mut props: Vec<_> = getprop
        .lines()
        .filter_map(|l| {
            let (k, v) = l.trim().strip_prefix('[')?.split_once("]: [")?;
            Some((k.to_string(), v.strip_suffix(']')?.to_string()))
        })
        .collect();
    props.sort();
    props
}

fn kv<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    text.lines()
        .find_map(|l| l.trim().strip_prefix(key)?.strip_prefix(':'))
        .map(str::trim)
        .filter(|v| !v.is_empty())
}

fn kib(text: &str, key: &str) -> Option<u64> {
    kv(text, key)?.split_whitespace().next()?.parse().ok()
}

fn fmt_bytes(kib: u64) -> String {
    let gb = kib as f64 / 1024.0 / 1024.0;
    if gb >= 1.0 {
        format!("{gb:.1} GB")
    } else {
        format!("{:.0} MB", kib as f64 / 1024.0)
    }
}

fn fmt_duration(secs: u64) -> String {
    let (d, h, m) = (secs / 86400, secs / 3600 % 24, secs / 60 % 60);
    match (d, h) {
        (0, 0) => format!("{m}m"),
        (0, _) => format!("{h}h {m}m"),
        _ => format!("{d}d {h}h {m}m"),
    }
}

fn battery_status(code: &str) -> &str {
    match code {
        "2" => "Charging",
        "3" => "Discharging",
        "4" => "Not charging",
        "5" => "Full",
        other => other,
    }
}

fn battery_health(code: &str) -> &str {
    match code {
        "2" => "Good",
        "3" => "Overheat",
        "4" => "Dead",
        "5" => "Over voltage",
        "6" => "Failure",
        "7" => "Cold",
        other => other,
    }
}

fn plugged(b: &str) -> Option<String> {
    let mut sources = vec![];
    for (key, name) in [("AC powered", "AC"), ("USB powered", "USB"), ("Wireless powered", "Wireless")] {
        if kv(b, key) == Some("true") {
            sources.push(name);
        }
    }
    (!sources.is_empty()).then(|| sources.join(", "))
}

struct Builder(Vec<Section>);

impl Builder {
    fn section(&mut self, title: &str, rows: Vec<(&str, Option<String>)>) {
        let rows: Vec<_> = rows
            .into_iter()
            .filter_map(|(k, v)| Some((k.to_string(), v.filter(|v| !v.trim().is_empty())?)))
            .collect();
        if !rows.is_empty() {
            self.0.push(Section { title: title.to_string(), rows });
        }
    }
}

fn some(s: &str) -> Option<String> {
    let s = s.trim();
    (!s.is_empty() && s != "null").then(|| s.to_string())
}

pub fn parse_info(dump: &str) -> DeviceInfo {
    let parts = split_sections(dump);
    let get = |k: &str| parts.get(k).map(String::as_str).unwrap_or("");
    let props = parse_props(get("getprop"));
    let prop = |key: &str| {
        props
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.clone())
            .filter(|v| !v.is_empty())
    };
    let battery = get("battery");
    let battery_level: Option<u8> = kv(battery, "level").and_then(|v| v.parse().ok());

    let mut b = Builder(vec![]);

    b.section("Device", vec![
        ("Name", some(get("devname"))),
        ("Manufacturer", prop("ro.product.manufacturer")),
        ("Brand", prop("ro.product.brand")),
        ("Model", prop("ro.product.model")),
        ("Codename", prop("ro.product.device")),
        ("Product", prop("ro.product.name")),
        ("Board", prop("ro.product.board")),
        ("Hardware", prop("ro.hardware")),
        ("Serial number", prop("ro.serialno")),
        ("Android ID", some(get("androidid"))),
    ]);

    b.section("Software", vec![
        ("Android", prop("ro.build.version.release")),
        ("API level", prop("ro.build.version.sdk").map(|s| format!("SDK {s}"))),
        ("Security patch", prop("ro.build.version.security_patch")),
        ("Build ID", prop("ro.build.id")),
        ("Display build", prop("ro.build.display.id")),
        ("Incremental", prop("ro.build.version.incremental")),
        ("Build type", prop("ro.build.type")),
        ("Build tags", prop("ro.build.tags")),
        ("Build date", prop("ro.build.date")),
        ("Bootloader", prop("ro.bootloader")),
        ("Baseband", prop("gsm.version.baseband")),
        ("Kernel", some(get("uname"))),
        ("Fingerprint", prop("ro.build.fingerprint")),
        ("Language", prop("persist.sys.locale").or_else(|| prop("ro.product.locale"))),
        ("Time zone", prop("persist.sys.timezone")),
    ]);

    let cpu = get("cpu");
    let cores = cpu.lines().filter(|l| l.starts_with("processor")).count();
    b.section("Hardware", vec![
        ("SoC", prop("ro.soc.model").or_else(|| prop("ro.board.platform"))),
        ("SoC manufacturer", prop("ro.soc.manufacturer")),
        ("CPU", kv(cpu, "Hardware").map(str::to_string)),
        ("CPU cores", (cores > 0).then(|| cores.to_string())),
        ("ABIs", prop("ro.product.cpu.abilist")),
        ("OpenGL ES", prop("ro.opengles.version").and_then(|v| {
            let n: u32 = v.parse().ok()?;
            Some(format!("{}.{}", n >> 16, n & 0xffff))
        })),
    ]);

    let mem = get("meminfo");
    let total = kib(mem, "MemTotal");
    let avail = kib(mem, "MemAvailable");
    let swap = kib(mem, "SwapTotal").filter(|s| *s > 0);
    // df -k /data: last line is "<fs> <total> <used> <avail> <use%> <mount>".
    let df = get("df").lines().last().map(|l| l.split_whitespace().collect::<Vec<_>>());
    let (st_total, st_used) = df
        .filter(|f| f.len() >= 4)
        .map(|f| (f[1].parse::<u64>().ok(), f[2].parse::<u64>().ok()))
        .unwrap_or((None, None));
    b.section("Memory & storage", vec![
        ("RAM", total.map(fmt_bytes)),
        ("RAM available", avail.map(fmt_bytes)),
        ("Swap", swap.map(fmt_bytes)),
        ("Storage", st_total.map(fmt_bytes)),
        ("Storage used", st_used.zip(st_total).map(|(u, t)| format!("{} ({}%)", fmt_bytes(u), u * 100 / t.max(1)))),
    ]);

    let wm = get("wm");
    let wm_val = |key: &str| {
        // Prefer the "Override" line (user-set) over "Physical".
        let lines: Vec<_> = wm.lines().filter(|l| l.contains(key)).collect();
        let l = lines.iter().find(|l| l.starts_with("Override")).or(lines.first())?;
        some(l.split(':').nth(1)?)
    };
    b.section("Display", vec![
        ("Resolution", wm_val("size")),
        ("Density", wm_val("density").map(|d| format!("{d} dpi"))),
    ]);

    b.section("Battery", vec![
        ("Level", battery_level.map(|l| format!("{l}%"))),
        ("Status", kv(battery, "status").map(|s| battery_status(s).to_string())),
        ("Health", kv(battery, "health").map(|s| battery_health(s).to_string())),
        ("Power source", plugged(battery)),
        ("Temperature", kv(battery, "temperature").and_then(|t| t.parse::<f32>().ok()).map(|t| format!("{:.1} °C", t / 10.0))),
        ("Voltage", kv(battery, "voltage").map(|v| format!("{v} mV"))),
        ("Technology", kv(battery, "technology").map(str::to_string)),
        ("Cycle count", kv(battery, "Cycle count").map(str::to_string)),
    ]);

    let ip = get("ip")
        .split_whitespace()
        .skip_while(|w| *w != "inet")
        .nth(1)
        .map(|a| a.split('/').next().unwrap_or(a).to_string());
    let ssid = get("wifi")
        .split("SSID: ")
        .nth(1)
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().trim_matches('"').to_string())
        .filter(|s| s != "<unknown ssid>");
    b.section("Network", vec![
        ("Wi-Fi IP", ip),
        ("Wi-Fi MAC", some(get("mac"))),
        ("Wi-Fi network", ssid),
        ("Operator", prop("gsm.operator.alpha")),
        ("Network type", prop("gsm.network.type")),
        ("SIM state", prop("gsm.sim.state")),
    ]);

    let uptime = get("uptime").split_whitespace().next().and_then(|s| s.parse::<f64>().ok());
    b.section("Security & system", vec![
        ("Uptime", uptime.map(|s| fmt_duration(s as u64))),
        ("SELinux", some(get("selinux"))),
        ("Encryption", prop("ro.crypto.state")),
        ("Verified boot", prop("ro.boot.verifiedbootstate")),
        ("Bootloader lock", prop("ro.boot.flash.locked").map(|v| if v == "1" { "Locked".into() } else { "Unlocked".into() })),
        ("Treble", prop("ro.treble.enabled")),
        ("Dynamic partitions", prop("ro.boot.dynamic_partitions")),
        ("First API level", prop("ro.product.first_api_level")),
        ("Debuggable", prop("ro.debuggable").map(|v| if v == "1" { "Yes".into() } else { "No".into() })),
    ]);

    DeviceInfo {
        manufacturer: prop("ro.product.manufacturer"),
        model: prop("ro.product.model"),
        android_version: prop("ro.build.version.release"),
        sdk_level: prop("ro.build.version.sdk"),
        battery_level,
        sections: b.0,
        props,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_props_and_battery() {
        let dump = "@@getprop\n[ro.product.model]: [Pixel 7]\n[ro.build.version.release]: [14]\n[ro.product.manufacturer]: [Google]\n\
@@battery\nCurrent Battery Service state:\n  AC powered: false\n  USB powered: true\n  status: 2\n  level: 85\n  temperature: 281\n\
@@meminfo\nMemTotal:        7864320 kB\nMemAvailable:    3932160 kB\n\
@@df\nFilesystem 1K-blocks Used Available Use% Mounted on\n/dev/block/dm-7 100000000 25000000 75000000 25% /data\n\
@@uptime\n93784.12 1000.00\n@@end\n";
        let info = parse_info(dump);
        assert_eq!(info.model.as_deref(), Some("Pixel 7"));
        assert_eq!(info.android_version.as_deref(), Some("14"));
        assert_eq!(info.battery_level, Some(85));
        assert_eq!(info.sdk_level, None);
        assert_eq!(info.props.len(), 3);

        let row = |section: &str, label: &str| {
            info.sections
                .iter()
                .find(|s| s.title == section)?
                .rows
                .iter()
                .find(|(k, _)| k == label)
                .map(|(_, v)| v.as_str())
        };
        assert_eq!(row("Battery", "Status"), Some("Charging"));
        assert_eq!(row("Battery", "Power source"), Some("USB"));
        assert_eq!(row("Battery", "Temperature"), Some("28.1 °C"));
        assert_eq!(row("Memory & storage", "RAM"), Some("7.5 GB"));
        assert_eq!(row("Memory & storage", "Storage used"), Some("23.8 GB (25%)"));
        assert_eq!(row("Security & system", "Uptime"), Some("1d 2h 3m"));
    }
}
