# Vendored scrcpy server

The phone-side half of screen mirroring. This is the `server/` directory of
[Genymobile/scrcpy](https://github.com/Genymobile/scrcpy), **unmodified**, from
tag `v5.0.1` (tag object `a0c27ff382c411af1301dcc1cd8205c9aeb81996`).
Licensed under the Apache License 2.0, see `LICENSE`.

Only what the build needs is kept: `server/src/main`, the manual build script
and the proguard rules. Upstream's Gradle files, unit tests and the C client
are not vendored (we have our own client in `src-tauri/src/adb/mirror.rs`).

## Building

There is nothing to run by hand: `src-tauri/build.rs` compiles this source
into the Cargo build directory whenever it changes (and on a fresh checkout),
and the app embeds the resulting jar. `npm run tauri dev` and `cargo build`
both do it.

It needs a JDK (`javac`) and an Android SDK with `platforms;android-36` and
`build-tools;36.0.0`. `build.rs` finds the SDK from `ANDROID_HOME` /
`ANDROID_SDK_ROOT`, or the usual Homebrew and Android Studio locations. Set
`ANDROID_PLATFORM` / `ANDROID_BUILD_TOOLS` to use other versions. The build
bundles `server/build_without_gradle.sh`, which needs `bash` (on Windows, Git Bash).

## Patching

Change files under `vendor/scrcpy/server/src/main/java/...`, then record the
change in the log below, so the next upstream merge knows what to re-apply.

The client and server must report the exact same version string, or the server
refuses to start. The version comes from `SCRCPY_VERSION_NAME` in
`server/build_without_gradle.sh`, and `build.rs` passes it to the app, so
there is one place to change. When you patch the server, give it a local
version there (e.g. `5.0.1-appraiser.1`).

### Patch log

| Date | File(s) | What and why |
| ---- | ------- | ------------ |
| -    | -       | none yet, tree is identical to upstream `v5.0.1` |

## Upgrading to a new upstream release

1. Replace `server/src/main` and `server/build_without_gradle.sh` with the new
   tag's, then re-apply the patch log on top.
2. Update the tag above and check `doc/develop.md` upstream for protocol changes (the client in
   `src/adb/mirror.rs` and `src/adb/control.rs` follows it).
3. Build (`cargo build`), then run the live tests: `APPRAISER_SERIAL=<serial> cargo test
   -- --ignored mirror_live --nocapture`.
