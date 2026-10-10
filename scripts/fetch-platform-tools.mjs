// Downloads Google's Android platform-tools for the current OS and keeps only
// what the app needs (adb) in src-tauri/resources/platform-tools, which Tauri
// bundles as a resource. Run automatically before `tauri build`.
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const platform = { darwin: "darwin", linux: "linux", win32: "windows" }[process.platform];
if (!platform) throw new Error(`Unsupported platform: ${process.platform}`);

const dest = fileURLToPath(new URL("../src-tauri/resources/platform-tools/", import.meta.url));
const exe = platform === "windows" ? "adb.exe" : "adb";
if (existsSync(join(dest, exe)) && !process.argv.includes("--force")) {
  console.log("platform-tools already present (use --force to refetch)");
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), "platform-tools-"));
try {
  const url = `https://dl.google.com/android/repository/platform-tools-latest-${platform}.zip`;
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const zip = join(tmp, "pt.zip");
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));

  // bsdtar (Windows 10+, macOS) and unzip (Linux/macOS) both handle zips.
  if (platform === "windows") execFileSync("tar", ["-xf", zip, "-C", tmp]);
  else execFileSync("unzip", ["-q", zip, "-d", tmp]);

  mkdirSync(dest, { recursive: true });
  const keep = [exe, "NOTICE.txt", "source.properties"];
  if (platform === "windows") keep.push("AdbWinApi.dll", "AdbWinUsbApi.dll");
  for (const f of keep) cpSync(join(tmp, "platform-tools", f), join(dest, f));
  if (platform !== "windows") chmodSync(join(dest, exe), 0o755);
  console.log(`platform-tools installed to ${dest}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
