# Notes for AI agents and new contributors

Appraiser is a Tauri 2 app (React + TypeScript frontend in `src/`, Rust backend in `src-tauri/`).

## Build prerequisites

- **Rust, Node.js**, then `npm ci`.
- **A JDK (17+) and an Android SDK** with `platforms;android-36` and `build-tools;36.0.0`.
  `src-tauri/build.rs` compiles the vendored scrcpy server (`vendor/scrcpy`) on every
  `cargo build`/`cargo check`. It locates the JDK itself (`JAVA_HOME`, PATH,
  `/usr/libexec/java_home`, the usual install folders) and the SDK (`ANDROID_HOME`
  or the usual locations), so you normally need no setup. If it panics, read the
  list of places it looked.
- **adb** is bundled into releases by `scripts/fetch-platform-tools.mjs`
  (run automatically by `beforeBuildCommand`). In `tauri dev` the app falls back to
  `adb` on PATH.

## Checks

```
npx tsc -b          # frontend types
npx oxlint          # lint
cd src-tauri && cargo check
```

## Don't conclude a tool is missing too fast

Sandboxed shells often have a different PATH from the user's terminal. macOS also
ships stub `java`/`javac` in `/usr/bin` that exist but fail when no JDK is on PATH.
Before telling the user something isn't installed, look for it (`/usr/libexec/java_home`,
`/Library/Java/JavaVirtualMachines`, Homebrew, `ls` the usual folders) and say
"my shell can't find X" rather than "you don't have X".

Network access may be blocked in a sandbox (downloads, `npm install`, the
platform-tools fetch). If so, say what you couldn't verify instead of working around it.

## Releases

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds installers for
macOS (arm64 + x64), Windows and Linux and attaches them to a draft GitHub release.
