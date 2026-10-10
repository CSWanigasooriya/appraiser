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
/// Set `SCRCPY_SERVER_PREBUILT` to a ready-made server jar to skip all of that.
fn build_scrcpy_server() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let server = manifest.join("../vendor/scrcpy/server");
    let script = server.join("build_without_gradle.sh");

    println!("cargo:rerun-if-changed={}", server.join("src").display());
    println!("cargo:rerun-if-changed={}", script.display());
    for var in ["ANDROID_HOME", "ANDROID_SDK_ROOT", "ANDROID_PLATFORM", "ANDROID_BUILD_TOOLS", "JAVA_HOME"] {
        println!("cargo:rerun-if-env-changed={var}");
    }

    // The script is the single source of truth for the server's version.
    let version = std::fs::read_to_string(&script)
        .ok()
        .and_then(|s| s.lines().find_map(|l| l.strip_prefix("SCRCPY_VERSION_NAME=").map(str::to_string)))
        .expect("SCRCPY_VERSION_NAME not found in vendor/scrcpy/server/build_without_gradle.sh");

    let build_dir = PathBuf::from(env::var("OUT_DIR").unwrap()).join("scrcpy");
    let jar = build_dir.join("scrcpy-server");

    // CI builds the server once on Linux and hands it to every platform, because
    // the script is not Windows-safe (aidl path handling, `:` classpath separator,
    // `d8.bat`). The jar is a dex archive, identical on every OS.
    println!("cargo:rerun-if-env-changed=SCRCPY_SERVER_PREBUILT");
    if let Some(prebuilt) = env::var_os("SCRCPY_SERVER_PREBUILT").filter(|v| !v.is_empty()).map(PathBuf::from) {
        println!("cargo:rerun-if-changed={}", prebuilt.display());
        assert!(prebuilt.is_file(), "SCRCPY_SERVER_PREBUILT={} is not a file", prebuilt.display());
        std::fs::create_dir_all(&build_dir).unwrap();
        std::fs::copy(&prebuilt, &jar).expect("failed to copy the prebuilt scrcpy server");
        println!("cargo:rustc-env=SCRCPY_VERSION={version}");
        println!("cargo:rustc-env=SCRCPY_SERVER_JAR={}", jar.display());
        return;
    }

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

    let jdk = find_jdk().unwrap_or_else(|searched| {
        panic!(
            "\n\nCannot build the scrcpy server: no JDK (`javac`) found.\nLooked in:\n  {}\n\
             Install a JDK (17 or newer) or set JAVA_HOME to one. See vendor/scrcpy/README.md.\n",
            searched.join("\n  ")
        )
    });

    std::fs::create_dir_all(&build_dir).unwrap();
    let mut cmd = Command::new(find_bash());
    if let Some(home) = &jdk {
        // The script calls plain `javac`, so put the JDK we found first on PATH.
        let mut paths = vec![home.join("bin")];
        paths.extend(env::split_paths(&env::var_os("PATH").unwrap_or_default()));
        cmd.env("JAVA_HOME", home).env("PATH", env::join_paths(paths).unwrap());
    }
    let status = cmd
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

fn javac_works(javac: &str) -> bool {
    Command::new(javac).arg("-version").output().is_ok_and(|o| o.status.success())
}

fn jdk_has_javac(home: &Path) -> bool {
    let exe = if cfg!(windows) { "javac.exe" } else { "javac" };
    let javac = home.join("bin").join(exe);
    javac.exists() && javac_works(&javac.to_string_lossy())
}

/// Locates a JDK. `Ok(None)` means `javac` on PATH works as is; `Ok(Some(home))`
/// is a JDK to put on PATH instead (macOS ships a `/usr/bin/javac` stub that
/// fails even when a JDK is installed, and IDE or shell setups often leave
/// JDKs off PATH). `Err` lists everywhere that was searched.
fn find_jdk() -> Result<Option<PathBuf>, Vec<String>> {
    let mut searched = Vec::new();

    if let Some(home) = env::var_os("JAVA_HOME").map(PathBuf::from) {
        if jdk_has_javac(&home) {
            return Ok(Some(home));
        }
        searched.push(format!("JAVA_HOME={} (no working bin/javac)", home.display()));
    }

    if javac_works("javac") {
        return Ok(None);
    }
    searched.push("javac on PATH".into());

    if cfg!(target_os = "macos") {
        let out = Command::new("/usr/libexec/java_home").output();
        if let Some(home) = out.ok().filter(|o| o.status.success()).map(|o| PathBuf::from(String::from_utf8_lossy(&o.stdout).trim())) {
            if jdk_has_javac(&home) {
                return Ok(Some(home));
            }
        }
        searched.push("/usr/libexec/java_home".into());
    }

    // Folders that hold one JDK per subfolder, and where inside that folder the home is.
    let home = env::var("HOME").or_else(|_| env::var("USERPROFILE")).unwrap_or_default();
    let program_files = env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".into());
    let roots: Vec<(String, &str)> = vec![
        ("/Library/Java/JavaVirtualMachines".into(), "Contents/Home"),
        (format!("{home}/Library/Java/JavaVirtualMachines"), "Contents/Home"),
        ("/opt/homebrew/opt".into(), "libexec/openjdk.jdk/Contents/Home"),
        ("/usr/local/opt".into(), "libexec/openjdk.jdk/Contents/Home"),
        ("/usr/lib/jvm".into(), ""),
        (format!("{home}/.sdkman/candidates/java"), ""),
        (format!("{program_files}/Eclipse Adoptium"), ""),
        (format!("{program_files}/Java"), ""),
        (format!("{program_files}/Microsoft"), ""),
    ];
    for (root, inner) in roots {
        searched.push(root.clone());
        let Ok(entries) = std::fs::read_dir(&root) else { continue };
        let mut homes: Vec<PathBuf> = entries.flatten().map(|e| e.path().join(inner)).filter(|h| jdk_has_javac(h)).collect();
        homes.sort();
        if let Some(h) = homes.pop() {
            return Ok(Some(h));
        }
    }
    Err(searched)
}

/// `bash` for the server build script. On Windows a bare `bash` can resolve to
/// the WSL launcher in System32, which can't run the script, so prefer Git Bash.
fn find_bash() -> PathBuf {
    if cfg!(windows) {
        let roots = ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"];
        for var in roots {
            let Ok(root) = env::var(var) else { continue };
            for rel in ["Git/bin/bash.exe", "Programs/Git/bin/bash.exe"] {
                let bash = Path::new(&root).join(rel);
                if bash.exists() {
                    return bash;
                }
            }
        }
    }
    "bash".into()
}
