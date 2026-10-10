use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    build_scrcpy_server();
    tauri_build::build()
}

/// Compiles the vendored scrcpy server (`vendor/scrcpy`) into the build
/// directory, so the app can embed it. Cargo reruns this only when the server
/// source or the SDK location changes. Needs a JDK and an Android SDK with
/// `platforms;android-36` and `build-tools;36.0.0` (see vendor/scrcpy/README.md).
fn build_scrcpy_server() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let server = manifest.join("../vendor/scrcpy/server");
    let script = server.join("build_without_gradle.sh");

    println!("cargo:rerun-if-changed={}", server.join("src").display());
    println!("cargo:rerun-if-changed={}", script.display());
    for var in ["ANDROID_HOME", "ANDROID_SDK_ROOT", "ANDROID_PLATFORM", "ANDROID_BUILD_TOOLS"] {
        println!("cargo:rerun-if-env-changed={var}");
    }

    // The script is the single source of truth for the server's version.
    let version = std::fs::read_to_string(&script)
        .ok()
        .and_then(|s| s.lines().find_map(|l| l.strip_prefix("SCRCPY_VERSION_NAME=").map(str::to_string)))
        .expect("SCRCPY_VERSION_NAME not found in vendor/scrcpy/server/build_without_gradle.sh");

    let build_dir = PathBuf::from(env::var("OUT_DIR").unwrap()).join("scrcpy");
    let jar = build_dir.join("scrcpy-server");

    let platform = env::var("ANDROID_PLATFORM").unwrap_or_else(|_| "36".into());
    let tools = env::var("ANDROID_BUILD_TOOLS").unwrap_or_else(|_| "36.0.0".into());
    let sdk = find_sdk(&platform, &tools).unwrap_or_else(|| {
        panic!(
            "\n\nCannot build the scrcpy server: no Android SDK with platforms;android-{platform} and \
             build-tools;{tools} found.\nInstall one and set ANDROID_HOME, e.g.\n  \
             sdkmanager \"platforms;android-{platform}\" \"build-tools;{tools}\"\n\
             See vendor/scrcpy/README.md.\n"
        )
    });

    if Command::new("javac").arg("-version").output().map_or(true, |o| !o.status.success()) {
        panic!("\n\nCannot build the scrcpy server: a JDK is required (`javac` not found). See vendor/scrcpy/README.md.\n");
    }

    std::fs::create_dir_all(&build_dir).unwrap();
    let status = Command::new("bash")
        .arg(&script)
        .env("BUILD_DIR", &build_dir)
        .env("ANDROID_HOME", &sdk)
        .env("ANDROID_PLATFORM", &platform)
        .env("ANDROID_BUILD_TOOLS", &tools)
        .current_dir(&build_dir)
        .status()
        .expect("failed to run bash to build the scrcpy server");
    assert!(status.success() && jar.exists(), "building the scrcpy server failed (see output above)");

    println!("cargo:rustc-env=SCRCPY_VERSION={version}");
    println!("cargo:rustc-env=SCRCPY_SERVER_JAR={}", jar.display());
}

/// First SDK location that has the platform and build tools we need.
fn find_sdk(platform: &str, tools: &str) -> Option<PathBuf> {
    let home = env::var("HOME").unwrap_or_default();
    let candidates = [
        env::var("ANDROID_HOME").ok(),
        env::var("ANDROID_SDK_ROOT").ok(),
        Some("/opt/homebrew/share/android-commandlinetools".into()),
        Some("/usr/local/share/android-commandlinetools".into()),
        Some(format!("{home}/Library/Android/sdk")),
        Some(format!("{home}/Android/Sdk")),
    ];
    candidates.into_iter().flatten().map(PathBuf::from).find(|sdk| {
        let ok = |p: &Path| p.exists();
        ok(&sdk.join(format!("platforms/android-{platform}/android.jar"))) && ok(&sdk.join(format!("build-tools/{tools}")))
    })
}
