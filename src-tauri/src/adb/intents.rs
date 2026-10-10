//! Firing intents at the phone (`am start`, `am broadcast`, `am startservice`)
//! for testing deep links and broadcast receivers.

use serde::Deserialize;

use super::runner::{self, sh_quote};
use super::AdbError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Target {
    Activity,
    Broadcast,
    Service,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Extra {
    /// `string`, `int`, `long`, `float`, `bool` or `uri`.
    pub kind: String,
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Intent {
    pub target: Target,
    pub action: Option<String>,
    pub data: Option<String>,
    pub mime: Option<String>,
    /// `package/.Class`
    pub component: Option<String>,
    pub package: Option<String>,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub extras: Vec<Extra>,
}

fn fail<T>(msg: impl Into<String>) -> Result<T, AdbError> {
    Err(AdbError::Failed(msg.into()))
}

fn present(s: &Option<String>) -> Option<&str> {
    s.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

/// Names (actions, categories, components, extra keys) never contain whitespace.
fn word<'a>(label: &str, s: &'a str) -> Result<&'a str, AdbError> {
    if s.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return fail(format!("{label} can't contain spaces: {s:?}"));
    }
    Ok(s)
}

/// The shell command that fires `intent`.
fn build(intent: &Intent) -> Result<String, AdbError> {
    let mut parts: Vec<String> = vec![
        "am".into(),
        match intent.target {
            Target::Activity => "start",
            Target::Broadcast => "broadcast",
            Target::Service => "startservice",
        }
        .into(),
    ];
    let mut flag = |name: &str, value: &str| {
        parts.push(name.into());
        parts.push(sh_quote(value));
    };

    let data = present(&intent.data);
    // A bare link means "open this", which is what the Android VIEW action is for.
    let action = present(&intent.action).or_else(|| {
        (data.is_some() && intent.target == Target::Activity).then_some("android.intent.action.VIEW")
    });
    if let Some(a) = action {
        flag("-a", word("Action", a)?);
    }
    if let Some(d) = data {
        flag("-d", d);
    }
    if let Some(t) = present(&intent.mime) {
        flag("-t", word("Type", t)?);
    }
    for c in &intent.categories {
        let c = c.trim();
        if !c.is_empty() {
            flag("-c", word("Category", c)?);
        }
    }
    if let Some(c) = present(&intent.component) {
        flag("-n", word("Component", c)?);
    }
    if let Some(p) = present(&intent.package) {
        parts.push(sh_quote(word("Package", p)?));
    }
    for extra in &intent.extras {
        let key = word("Extra key", extra.key.trim())?;
        if key.is_empty() {
            continue;
        }
        let flag_name = match extra.kind.as_str() {
            "string" => "--es",
            "int" => "--ei",
            "long" => "--el",
            "float" => "--ef",
            "bool" => "--ez",
            "uri" => "--eu",
            other => return fail(format!("Unknown extra type: {other}")),
        };
        parts.push(flag_name.into());
        parts.push(sh_quote(key));
        parts.push(sh_quote(&extra.value));
    }
    if parts.len() == 2 {
        return fail("Give the intent an action, a link, or a component");
    }
    Ok(parts.join(" "))
}

/// Fires the intent; returns what `am` printed.
pub fn fire(serial: &str, intent: &Intent) -> Result<String, AdbError> {
    let command = build(intent)?;
    let out = runner::shell(serial, &command)?;
    let text = out.trim();
    if text.contains("Error") || text.contains("Exception") {
        return fail(text.to_string());
    }
    Ok(text.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn intent(target: Target) -> Intent {
        Intent {
            target,
            action: None,
            data: None,
            mime: None,
            component: None,
            package: None,
            categories: vec![],
            extras: vec![],
        }
    }

    #[test]
    fn a_link_defaults_to_the_view_action() {
        let mut i = intent(Target::Activity);
        i.data = Some("https://example.com/?a=1&b=2".into());
        assert_eq!(
            build(&i).unwrap(),
            "am start -a 'android.intent.action.VIEW' -d 'https://example.com/?a=1&b=2'"
        );
    }

    #[test]
    fn builds_a_broadcast_with_extras() {
        let mut i = intent(Target::Broadcast);
        i.action = Some("com.example.PING".into());
        i.extras = vec![
            Extra { kind: "string".into(), key: "who".into(), value: "it's me".into() },
            Extra { kind: "bool".into(), key: "loud".into(), value: "true".into() },
        ];
        assert_eq!(
            build(&i).unwrap(),
            r"am broadcast -a 'com.example.PING' --es 'who' 'it'\''s me' --ez 'loud' 'true'"
        );
    }

    #[test]
    fn rejects_empty_and_unsafe_intents() {
        assert!(build(&intent(Target::Activity)).is_err());
        let mut i = intent(Target::Activity);
        i.action = Some("a b".into());
        assert!(build(&i).is_err());
        let mut i = intent(Target::Broadcast);
        i.action = Some("x".into());
        i.extras = vec![Extra { kind: "nope".into(), key: "k".into(), value: "v".into() }];
        assert!(build(&i).is_err());
    }
}
