import { invoke } from '@tauri-apps/api/core'
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
