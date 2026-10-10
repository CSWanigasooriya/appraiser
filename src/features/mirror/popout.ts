import { WebviewWindow } from '@tauri-apps/api/webviewWindow'

/** Window labels only allow `a-z A-Z 0-9 - / : _`. */
const labelFor = (serial: string) => `mirror-${serial.replace(/[^a-zA-Z0-9\-/:_]/g, '-')}`

/** The detached mirror window for this device, if one is open. */
export const findMirrorWindow = (serial: string) => WebviewWindow.getByLabel(labelFor(serial))

/** Opens the mirror in its own window (or focuses it if already open). */
export async function openMirrorWindow(serial: string, title: string): Promise<WebviewWindow> {
  const existing = await findMirrorWindow(serial)
  if (existing) {
    await existing.setFocus()
    return existing
  }
  const params = new URLSearchParams({ mirror: serial, title })
  const win = new WebviewWindow(labelFor(serial), {
    url: `index.html?${params}`,
    title,
    width: 380,
    height: 760,
    minWidth: 260,
    minHeight: 440,
  })
  await new Promise<void>((resolve, reject) => {
    void win.once('tauri://created', () => resolve())
    void win.once('tauri://error', (e) => reject(new Error(String(e.payload))))
  })
  return win
}
