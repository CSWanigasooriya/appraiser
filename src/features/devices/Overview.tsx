import { Camera, Power, RotateCcw, Unplug, Wifi } from 'lucide-react'
import { useState } from 'react'
import {
  disconnectDevice,
  enableWireless,
  rebootDevice,
  screenshot,
  type Device,
  type DeviceInfo,
  type RebootMode,
} from '../../lib/adb'
import { Button } from '../../components/ui/Button'
import { Card, CardTitle } from '../../components/ui/Card'
import { Dialog } from '../../components/ui/Dialog'
import { useToast } from '../../components/ui/toast'

interface Props {
  device: Device
  info: DeviceInfo | null
  wireless: boolean
}

const rebootLabels: Record<RebootMode, string> = {
  system: 'Reboot',
  recovery: 'Reboot to recovery',
  bootloader: 'Reboot to bootloader',
}

export function Overview({ device, info, wireless }: Props) {
  const serial = device.serial
  const toast = useToast()
  const [image, setImage] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [pendingReboot, setPendingReboot] = useState<RebootMode | null>(null)

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try {
      await fn()
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const rows: [string, string][] = [
    ['Manufacturer', info?.manufacturer ?? '-'],
    ['Model', info?.model ?? device.model ?? '-'],
    ['Android', info?.android_version ? `${info.android_version} (SDK ${info.sdk_level ?? '?'})` : '-'],
    ['Serial', serial],
  ]

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardTitle>Device info</CardTitle>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-zinc-500">{k}</dt>
              <dd className="break-all">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card>
        <CardTitle>Quick actions</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy === 'shot'}
            onClick={() => run('shot', async () => setImage(await screenshot(serial)))}
          >
            <Camera size={16} /> {busy === 'shot' ? 'Capturing...' : 'Screenshot'}
          </Button>
          {wireless ? (
            <Button
              onClick={() =>
                run('disconnect', async () => {
                  await disconnectDevice(serial)
                  toast('Disconnected')
                })
              }
            >
              <Unplug size={16} /> Disconnect
            </Button>
          ) : (
            <Button
              disabled={busy === 'wireless'}
              onClick={() =>
                run('wireless', async () => {
                  const addr = await enableWireless(serial)
                  toast(`Connected at ${addr}. You can unplug the cable.`)
                })
              }
            >
              <Wifi size={16} /> {busy === 'wireless' ? 'Switching...' : 'Switch to wireless'}
            </Button>
          )}
        </div>

        <CardTitle className="mt-5">Power</CardTitle>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(rebootLabels) as RebootMode[]).map((mode) => (
            <Button key={mode} onClick={() => setPendingReboot(mode)}>
              {mode === 'system' ? <RotateCcw size={16} /> : <Power size={16} />}
              {rebootLabels[mode]}
            </Button>
          ))}
        </div>
      </Card>

      {image && (
        <Card className="md:col-span-2">
          <CardTitle>Screenshot</CardTitle>
          <img
            src={`data:image/png;base64,${image}`}
            alt="Device screenshot"
            className="max-h-[480px] rounded-lg border border-zinc-200 dark:border-zinc-700"
          />
        </Card>
      )}

      <Dialog
        open={pendingReboot !== null}
        onClose={() => setPendingReboot(null)}
        title={pendingReboot ? rebootLabels[pendingReboot] : ''}
      >
        <p className="mb-5 text-sm text-zinc-600 dark:text-zinc-400">
          This will restart {device.model ?? serial}. Unsaved work on the device may be lost.
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setPendingReboot(null)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              const mode = pendingReboot!
              setPendingReboot(null)
              run('reboot', async () => {
                await rebootDevice(serial, mode)
                toast(`Rebooting (${mode})...`)
              })
            }}
          >
            Reboot
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
