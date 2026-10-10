//! One round of performance counters for the live monitor. The counters are
//! cumulative; the UI turns two samples into rates.

use serde::Serialize;

use super::appdetail;
use super::runner;
use super::AdbError;

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct PerfSample {
    /// Jiffies, all CPUs: busy + idle, and idle alone.
    pub cpu_total: u64,
    pub cpu_idle: u64,
    pub mem_total_kb: u64,
    pub mem_available_kb: u64,
    pub battery_level: Option<u8>,
    /// Degrees Celsius.
    pub battery_temp: Option<f32>,
    pub uptime: f64,
    /// Present when an app was asked for and is running.
    pub app: Option<AppSample>,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct AppSample {
    pub pid: u32,
    /// utime + stime of the app's process, in jiffies.
    pub cpu_ticks: u64,
    pub pss_kb: Option<u64>,
    pub frames: Option<u64>,
    pub janky_frames: Option<u64>,
}

pub fn sample(serial: &str, package: Option<&str>) -> Result<PerfSample, AdbError> {
    let mut script = String::from(
        "echo '#stat'; head -n 1 /proc/stat; echo '#mem'; head -n 3 /proc/meminfo; \
         echo '#uptime'; cat /proc/uptime; echo '#bat'; dumpsys battery; ",
    );
    if let Some(package) = package {
        let package = appdetail::validate_package(package)?;
        script.push_str(&format!(
            "PID=$(pidof -s {package}); echo \"#pid $PID\"; \
             if [ -n \"$PID\" ]; then echo '#proc'; cat /proc/$PID/stat; \
             echo '#pss'; dumpsys meminfo $PID | grep -E 'TOTAL'; \
             echo '#gfx'; dumpsys gfxinfo {package} | grep -E 'Total frames rendered|Janky frames'; fi"
        ));
    }
    Ok(parse(&runner::shell(serial, &script)?))
}

fn parse(out: &str) -> PerfSample {
    let mut s = PerfSample::default();
    let mut section = "";
    let mut app = AppSample::default();
    let mut has_app = false;
    let mut battery = String::new();

    for line in out.lines().map(str::trim) {
        if let Some(name) = line.strip_prefix('#') {
            let (name, rest) = name.split_once(' ').unwrap_or((name, ""));
            section = match name {
                "stat" => "stat",
                "mem" => "mem",
                "uptime" => "uptime",
                "bat" => "bat",
                "proc" => "proc",
                "pss" => "pss",
                "gfx" => "gfx",
                "pid" => {
                    if let Ok(pid) = rest.trim().parse() {
                        app.pid = pid;
                        has_app = true;
                    }
                    ""
                }
                _ => "",
            };
            continue;
        }
        match section {
            "stat" => {
                let n: Vec<u64> = line.split_whitespace().skip(1).filter_map(|t| t.parse().ok()).collect();
                s.cpu_total = n.iter().sum();
                s.cpu_idle = n.get(3).copied().unwrap_or(0) + n.get(4).copied().unwrap_or(0);
            }
            "mem" => {
                let kb = || line.split_whitespace().nth(1).and_then(|v| v.parse().ok()).unwrap_or(0);
                if line.starts_with("MemTotal:") {
                    s.mem_total_kb = kb();
                } else if line.starts_with("MemAvailable:") {
                    s.mem_available_kb = kb();
                }
            }
            "uptime" => s.uptime = line.split_whitespace().next().and_then(|v| v.parse().ok()).unwrap_or(0.0),
            "bat" => {
                battery.push_str(line);
                battery.push('\n');
            }
            "proc" => {
                // The command name is in parentheses and may contain spaces; fields count from after it.
                if let Some(rest) = line.rsplit_once(')').map(|(_, r)| r) {
                    let f: Vec<&str> = rest.split_whitespace().collect();
                    // utime and stime are fields 14 and 15 overall: indexes 11 and 12 after the state.
                    let tick = |i: usize| f.get(i).and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
                    app.cpu_ticks = tick(11) + tick(12);
                }
            }
            "pss" => {
                if app.pss_kb.is_none() {
                    // "TOTAL PSS:   123456  TOTAL RSS: ..." or the older "TOTAL   123456   ...".
                    let t: Vec<&str> = line.split_whitespace().collect();
                    let value = match t.as_slice() {
                        ["TOTAL", "PSS:", v, ..] | ["TOTAL", v, ..] => v.parse().ok(),
                        _ => None,
                    };
                    app.pss_kb = value;
                }
            }
            "gfx" => {
                if let Some(v) = line.strip_prefix("Total frames rendered:") {
                    app.frames = v.trim().parse().ok();
                } else if let Some(v) = line.strip_prefix("Janky frames:") {
                    app.janky_frames = v.split_whitespace().next().and_then(|n| n.parse().ok());
                }
            }
            _ => {}
        }
    }

    let b = super::diagnostics::parse_battery(&battery);
    s.battery_level = b.level;
    s.battery_temp = b.temperature;
    if has_app && app.pid != 0 {
        s.app = Some(app);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_system_sample() {
        let out = "#stat\ncpu  100 5 50 800 20 3 2 0 0 0\n#mem\nMemTotal:        5000000 kB\nMemFree:  100 kB\nMemAvailable:    2500000 kB\n\
                   #uptime\n1234.56 4000.00\n#bat\n  level: 77\n  temperature: 305\n";
        let s = parse(out);
        assert_eq!(s.cpu_total, 980);
        assert_eq!(s.cpu_idle, 820);
        assert_eq!((s.mem_total_kb, s.mem_available_kb), (5_000_000, 2_500_000));
        assert_eq!(s.uptime, 1234.56);
        assert_eq!((s.battery_level, s.battery_temp), (Some(77), Some(30.5)));
        assert_eq!(s.app, None);
    }

    #[test]
    fn parses_an_app_sample() {
        let out = "#pid 4242\n#proc\n4242 (com.some app) S 1 2 3 4 5 6 7 8 9 10 120 30 0 0 20 0 1\n\
                   #pss\n        TOTAL PSS:   150000            TOTAL RSS:   200000\n\
                   #gfx\nTotal frames rendered: 900\nJanky frames: 45 (5.00%)\n";
        let app = parse(out).app.unwrap();
        assert_eq!(app.pid, 4242);
        assert_eq!(app.cpu_ticks, 150);
        assert_eq!(app.pss_kb, Some(150_000));
        assert_eq!((app.frames, app.janky_frames), (Some(900), Some(45)));
    }

    #[test]
    fn a_stopped_app_has_no_sample() {
        assert_eq!(parse("#pid \n").app, None);
    }
}
