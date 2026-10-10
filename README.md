# Appraiser

A visual manager for adb-connected Android devices, built with Tauri 2 (Rust) and React + TypeScript.
Targets macOS and Windows.

## Prerequisites
- [Rust](https://rustup.rs) (stable)
- Node.js 20+
- Android platform-tools (`adb` on your PATH)
- Windows: WebView2 (preinstalled on Windows 11) and MSVC build tools

## Develop
```sh
npm install
npm run tauri dev
```

## Architecture
- `src-tauri/src/adb/`: core adb layer. No Tauri or UI knowledge; unit tested.
- `src-tauri/src/commands/`: thin Tauri command layer exposed to the frontend.
- `src/lib/adb.ts`: typed frontend wrapper around the commands and events.
- `src/features/<name>/`: one folder per UI feature (devices, files, apps, logcat...).

To add a feature: add functions to `adb/`, expose them in `commands/`, register them in `lib.rs`, then add a folder under `src/features/`.
