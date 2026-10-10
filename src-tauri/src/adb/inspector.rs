//! Reads the visible view hierarchy through `uiautomator`.

use super::runner;
use super::AdbError;

const REMOTE: &str = "/data/local/tmp/appraiser-ui.xml";

/// The screen's view hierarchy as XML. Dumping takes a second or so, and
/// fails while the screen is off or showing something uiautomator can't read.
pub fn dump_ui(serial: &str) -> Result<String, AdbError> {
    let first = dump(serial, "")?;
    // uiautomator reads only the "active" window, which on some phones is a
    // SystemUI overlay on top of the app. If the app in front is missing,
    // ask for every window instead.
    let focused = runner::shell(serial, "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'")
        .ok()
        .and_then(|out| focused_package(&out));
    if let Some(pkg) = focused {
        if !first.contains(&format!("package=\"{pkg}\"")) {
            if let Ok(all) = dump(serial, "--windows") {
                if all.contains(&format!("package=\"{pkg}\"")) {
                    return Ok(all);
                }
            }
        }
    }
    Ok(first)
}

fn dump(serial: &str, flags: &str) -> Result<String, AdbError> {
    let out = runner::shell(
        serial,
        &format!("uiautomator dump {flags} {REMOTE} >/dev/null 2>&1; cat {REMOTE}; rm -f {REMOTE}"),
    )?;
    extract_xml(&out).ok_or_else(|| {
        AdbError::Failed("Couldn't read the screen. Turn it on and unlock the phone, then try again.".into())
    })
}

/// The package of the window with input focus, from `mCurrentFocus=Window{... u0 com.pkg/com.pkg.Activity}`.
fn focused_package(out: &str) -> Option<String> {
    out.lines()
        .filter(|l| l.contains("mCurrentFocus") || l.contains("mFocusedApp"))
        .find_map(|l| {
            let component = l.split_whitespace().find(|t| t.contains('/'))?;
            let pkg = component.trim_end_matches(['}', ')']).split('/').next()?;
            let ok = pkg.contains('.') && pkg.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_');
            ok.then(|| pkg.to_string())
        })
}

fn extract_xml(out: &str) -> Option<String> {
    let start = out.find("<?xml").or_else(|| out.find("<hierarchy"))?;
    let end = out.rfind("</hierarchy>")? + "</hierarchy>".len();
    (end > start).then(|| out[start..end].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_text_around_the_xml() {
        let out = "UI hierchary dumped to: x\n<?xml version='1.0'?><hierarchy rotation=\"0\"><node/></hierarchy>\r\n";
        assert_eq!(extract_xml(out).unwrap(), "<?xml version='1.0'?><hierarchy rotation=\"0\"><node/></hierarchy>");
        assert_eq!(extract_xml("ERROR: null root node returned by UiTestAutomationBridge."), None);
    }

    #[test]
    fn finds_the_focused_package() {
        let out = "  mCurrentFocus=Window{abc u0 com.example.app/com.example.app.MainActivity}\n  mFocusedApp=ActivityRecord{x u0 com.example.app/.MainActivity t12}\n";
        assert_eq!(focused_package(out).as_deref(), Some("com.example.app"));
        assert_eq!(focused_package("mCurrentFocus=null"), None);
    }
}
