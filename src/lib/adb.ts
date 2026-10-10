import { Channel, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export type DeviceState = 'online' | 'offline' | 'unauthorized' | 'other'

export interface Device {
  serial: string
  state: DeviceState
  model: string | null
  product: string | null
  transport_id: string | null
}

// Rust's Result<T, E> serializes as { Ok: T } | { Err: E } when emitted as an event.
type RustResult<T> = { Ok: T } | { Err: string }

export const listDevices = () => invoke<Device[]>('list_devices')

export function onDevicesChanged(
  handler: (result: { devices: Device[] } | { error: string }) => void,
) {
  return listen<RustResult<Device[]>>('devices-changed', (e) => {
    handler('Ok' in e.payload ? { devices: e.payload.Ok } : { error: e.payload.Err })
  })
}

export interface DeviceInfo {
  manufacturer: string | null
  model: string | null
  android_version: string | null
  sdk_level: string | null
  battery_level: number | null
  sections: { title: string; rows: [string, string][] }[]
  props: [string, string][]
}

export type RebootMode = 'system' | 'recovery' | 'bootloader'

export const deviceInfo = (serial: string) => invoke<DeviceInfo>('device_info', { serial })
export const rebootDevice = (serial: string, mode: RebootMode) =>
  invoke<void>('reboot_device', { serial, mode })
/** Returns a base64-encoded PNG. */
export const screenshot = (serial: string) => invoke<string>('screenshot', { serial })
export const runShell = (serial: string, command: string) =>
  invoke<string>('run_shell', { serial, command })

export const connectDevice = (addr: string) => invoke<string>('connect_device', { addr })
export const pairDevice = (addr: string, code: string) =>
  invoke<string>('pair_device', { addr, code })
export const disconnectDevice = (addr: string) => invoke<void>('disconnect_device', { addr })
/** Switches a USB device to Wi-Fi debugging; resolves with the ip:port. */
export const enableWireless = (serial: string) => invoke<string>('enable_wireless', { serial })

/** Wireless serials look like `192.168.1.5:5555` or `adb-XXXX._adb-tls-connect._tcp`. */
export const isWireless = (serial: string) => /:\d+$/.test(serial) || serial.includes('._adb-tls-')

export interface QrSession {
  svg: string
  name: string
  password: string
}

export const startQrPairing = () => invoke<QrSession>('start_qr_pairing')
/** Resolves once the phone has scanned the code and paired (up to ~2 min). */
export const finishQrPairing = (name: string, password: string) =>
  invoke<string>('finish_qr_pairing', { name, password })
export const cancelQrPairing = () => invoke<void>('cancel_qr_pairing')

export interface App {
  package: string
  version_name: string | null
  system: boolean
  apk_path: string | null
}

export const listApps = (serial: string, includeSystem: boolean) =>
  invoke<App[]>('list_apps', { serial, includeSystem })
export const appVersions = (serial: string) =>
  invoke<Record<string, string>>('app_versions', { serial })
export const appIcon = (serial: string, pkg: string, apkPath: string) =>
  invoke<string | null>('app_icon', { serial, package: pkg, apkPath })
/** `paths` is one APK, or several for a split-APK set (base + config splits). */
export const installApk = (serial: string, paths: string[]) =>
  invoke<void>('install_apk', { serial, paths })
export const uninstallApp = (serial: string, pkg: string) =>
  invoke<void>('uninstall_app', { serial, package: pkg })
export const clearAppData = (serial: string, pkg: string) =>
  invoke<void>('clear_app_data', { serial, package: pkg })
export const forceStopApp = (serial: string, pkg: string) =>
  invoke<void>('force_stop_app', { serial, package: pkg })

/**
 * Starts mirroring. Messages arrive as binary: `[0][codec len][codec][avcC]`
 * (decoder config), `[1][key][AVCC frame]`, `[2][utf8 error]`, `[3][s16le stereo 48 kHz PCM]`, `[4][utf8 notice]` or `[5][utf8 clipboard text]`.
 */
export const startMirror = (serial: string, onMessage: (data: ArrayBuffer) => void) => {
  const channel = new Channel<ArrayBuffer>()
  channel.onmessage = onMessage
  return invoke<void>('start_mirror', { serial, onFrame: channel })
}
/** Input for the mirrored phone. Touch coordinates are in video pixels. */
export type MirrorInput =
  | { kind: 'touch'; action: 0 | 1 | 2; x: number; y: number; width: number; height: number }
  | { kind: 'scroll'; x: number; y: number; width: number; height: number; h: number; v: number }
  | { kind: 'key'; keycode: number }
  | { kind: 'text'; text: string }
  | { kind: 'clipboard'; text: string; paste: boolean }
  | { kind: 'get_clipboard' }

export const mirrorInput = (serial: string, input: MirrorInput) =>
  invoke<void>('mirror_input', { serial, input })
export const stopMirror = (serial: string) => invoke<void>('stop_mirror', { serial })

/** What the log stream sends: batches of raw `logcat -v threadtime` lines, or the end of the stream. */
export type LogMessage = { kind: 'lines'; lines: string[] } | { kind: 'ended'; reason: string }

export const startLogcat = (serial: string, onMessage: (message: LogMessage) => void) => {
  const channel = new Channel<LogMessage>()
  channel.onmessage = onMessage
  return invoke<void>('start_logcat', { serial, onEvent: channel })
}
export const stopLogcat = (serial: string) => invoke<void>('stop_logcat', { serial })
/** Empties the phone's log buffers. */
export const clearLogcat = (serial: string) => invoke<void>('clear_logcat', { serial })

export interface FileEntry {
  name: string
  kind: 'dir' | 'file'
  size: number
  /** `YYYY-MM-DD HH:MM`, as the phone reports it. */
  modified: string
  permissions: string
}

export const listFiles = (serial: string, path: string) => invoke<FileEntry[]>('list_files', { serial, path })
/** Copies phone files into a folder on this computer; returns where each landed (existing files are never overwritten). */
export const downloadFiles = (serial: string, paths: string[], destDir: string) =>
  invoke<string[]>('download_files', { serial, paths, destDir })
export const uploadFiles = (serial: string, paths: string[], remoteDir: string) =>
  invoke<void>('upload_files', { serial, paths, remoteDir })
export const deleteFiles = (serial: string, paths: string[]) => invoke<void>('delete_files', { serial, paths })
export const renameFile = (serial: string, path: string, newName: string) =>
  invoke<void>('rename_file', { serial, path, newName })
export const makeFolder = (serial: string, parent: string, name: string) =>
  invoke<void>('make_folder', { serial, parent, name })
/** A file's contents, base64-encoded (capped in size; meant for previews). */
export const readFile = (serial: string, path: string) => invoke<string>('read_file', { serial, path })

export interface SavedDevice {
  addr: string
  name: string | null
}

/** Wireless devices that are brought back automatically when they return to the network. */
export interface SavedDevices {
  auto_reconnect: boolean
  devices: SavedDevice[]
}

export const savedDevices = () => invoke<SavedDevices>('saved_devices')
export const forgetDevice = (addr: string) => invoke<void>('forget_device', { addr })
export const setAutoReconnect = (on: boolean) => invoke<void>('set_auto_reconnect', { on })

export interface Permission {
  name: string
  granted: boolean
  /** Runtime permissions can be granted and revoked; the rest are fixed at install. */
  runtime: boolean
}

export interface AppDetail {
  package: string
  version_name: string | null
  version_code: string | null
  min_sdk: string | null
  target_sdk: string | null
  installer: string | null
  first_install: string | null
  last_update: string | null
  enabled: boolean
  system: boolean
  permissions: Permission[]
  apk_paths: string[]
  /** `package/.Class` components that declare an intent filter. */
  activities: string[]
}

export interface AppStorage {
  app_bytes: number | null
  data_bytes: number | null
  cache_bytes: number | null
}

export const appDetail = (serial: string, pkg: string) => invoke<AppDetail>('app_detail', { serial, package: pkg })
export const appStorage = (serial: string, pkg: string) => invoke<AppStorage>('app_storage', { serial, package: pkg })
export const setAppPermission = (serial: string, pkg: string, permission: string, grant: boolean) =>
  invoke<void>('set_app_permission', { serial, package: pkg, permission, grant })
export const launchApp = (serial: string, pkg: string) => invoke<void>('launch_app', { serial, package: pkg })
export const setAppEnabled = (serial: string, pkg: string, enabled: boolean) =>
  invoke<void>('set_app_enabled', { serial, package: pkg, enabled })
export const clearAppCache = (serial: string, pkg: string) => invoke<void>('clear_app_cache', { serial, package: pkg })
/** Copies the app's APK into Downloads; resolves with where it landed. */
export const extractAppApk = (serial: string, pkg: string) => invoke<string>('extract_app_apk', { serial, package: pkg })

/** Takes a screenshot and saves it to Pictures/Appraiser; resolves with the saved path and the image (base64 PNG). */
export const saveScreenshot = (serial: string, name: string) =>
  invoke<[string, string]>('save_screenshot', { serial, name })
/** Saves a PNG or recording from the mirror to this computer; resolves with the saved path. */
export const saveMedia = (kind: 'screenshot' | 'recording', name: string, data: ArrayBuffer) =>
  invoke<string>('save_media', data, { headers: { 'x-kind': kind, 'x-name': name } })

export interface DevSettings {
  show_touches: boolean
  pointer_location: boolean
  layout_bounds: boolean
  stay_awake: boolean
  dont_keep_activities: boolean
  dark_mode: string | null
  animation_scale: number
  font_scale: number
  density: number | null
  default_density: number | null
  size: string | null
  default_size: string | null
}

export const devSettings = (serial: string) => invoke<DevSettings>('dev_settings', { serial })
export const setDevSetting = (serial: string, key: string, value: string) =>
  invoke<void>('set_dev_setting', { serial, key, value })
export const resetDevSettings = (serial: string) => invoke<void>('reset_dev_settings', { serial })

export interface NetworkState {
  wifi: boolean | null
  mobile_data: boolean | null
  airplane: boolean | null
  proxy: string | null
}

export interface Forward {
  reverse: boolean
  from: string
  to: string
}

export const networkState = (serial: string) => invoke<NetworkState>('network_state', { serial })
export const setWifi = (serial: string, on: boolean) => invoke<void>('set_wifi', { serial, on })
export const setMobileData = (serial: string, on: boolean) => invoke<void>('set_mobile_data', { serial, on })
export const setAirplane = (serial: string, on: boolean) => invoke<void>('set_airplane', { serial, on })
/** Pass `null` to clear the proxy. */
export const setProxy = (serial: string, proxy: string | null) => invoke<void>('set_proxy', { serial, proxy })
export const listForwards = (serial: string) => invoke<Forward[]>('list_forwards', { serial })
export const addForward = (serial: string, reverse: boolean, from: string, to: string) =>
  invoke<void>('add_forward', { serial, reverse, from, to })
export const removeForward = (serial: string, reverse: boolean, from: string) =>
  invoke<void>('remove_forward', { serial, reverse, from })

export interface Battery {
  level: number | null
  /** 2 charging, 3 discharging, 4 not charging, 5 full. */
  status: number | null
  ac: boolean
  usb: boolean
  wireless: boolean
  temperature: number | null
  voltage_mv: number | null
}

export const batteryState = (serial: string) => invoke<Battery>('battery_state', { serial })
export const setBattery = (serial: string, key: 'level' | 'status' | 'plugged' | 'temp', value: string) =>
  invoke<void>('set_battery', { serial, key, value })
export const resetBattery = (serial: string) => invoke<void>('reset_battery', { serial })

export type IntentTarget = 'activity' | 'broadcast' | 'service'
export type ExtraKind = 'string' | 'int' | 'long' | 'float' | 'bool' | 'uri'

export interface Intent {
  target: IntentTarget
  action: string | null
  data: string | null
  mime: string | null
  component: string | null
  package: string | null
  categories: string[]
  extras: { kind: ExtraKind; key: string; value: string }[]
}

export const fireIntent = (serial: string, intent: Intent) => invoke<string>('fire_intent', { serial, intent })

export interface Capture {
  dir: string
  files: string[]
  skipped: string[]
}

/** Collects a bug report, crash reports and logs into a new folder under Downloads/Appraiser. */
export const captureDiagnostics = (serial: string, label: string) =>
  invoke<Capture>('capture_diagnostics', { serial, label })

export interface PerfSample {
  cpu_total: number
  cpu_idle: number
  mem_total_kb: number
  mem_available_kb: number
  battery_level: number | null
  battery_temp: number | null
  uptime: number
  app: {
    pid: number
    cpu_ticks: number
    pss_kb: number | null
    frames: number | null
    janky_frames: number | null
  } | null
}

/** Cumulative counters; two samples make a rate. Pass a package to include that app's numbers. */
export const perfSample = (serial: string, pkg: string | null) => invoke<PerfSample>('perf_sample', { serial, package: pkg })
/** The visible view hierarchy as uiautomator XML. */
export const dumpUi = (serial: string) => invoke<string>('dump_ui', { serial })

/** Positions are fractions (0-1) of the screen. */
export type MacroStep =
  | { kind: 'tap'; x: number; y: number }
  | { kind: 'swipe'; x1: number; y1: number; x2: number; y2: number; duration_ms: number }
  | { kind: 'key'; keycode: number }
  | { kind: 'text'; text: string }
  | { kind: 'wait'; ms: number }
  | { kind: 'shell'; command: string }

/** Resolves when the macro finishes or is stopped. */
export const runMacro = (serial: string, steps: MacroStep[], landscape: boolean) =>
  invoke<void>('run_macro', { serial, steps, landscape })
export const stopMacro = (serial: string) => invoke<void>('stop_macro', { serial })
