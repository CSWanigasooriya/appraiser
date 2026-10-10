import { Camera, Copy, Power, RotateCcw, Search, Smartphone, Unplug, Wifi } from 'lucide-react'
import { useState } from 'react'
import {
  disconnectDevice,
  enableWireless,
  rebootDevice,
  saveScreenshot,
  type Device,
  type DeviceInfo,
  type RebootMode,
} from '../../lib/adb'
import { Button } from '../../components/ui/Button'
import { Card, CardTitle } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Dialog } from '../../components/ui/Dialog'
import { InfoRow } from '../../components/ui/InfoRow'
import { useToast } from '../../components/ui/toast'
import { copyPng, fileSafe, fromBase64, stamp } from '../../lib/format'

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

  const model = info?.model ?? device.model
  const title = [info?.manufacturer, model].filter(Boolean).join(' ') || serial

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
            <Smartphone size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold">{title}</h3>
            <p className="text-xs text-zinc-500">
              {info ? (model ?? 'Unknown model') : 'Reading device info...'}
            </p>
          </div>
          {info?.android_version && <Badge tone="green">Android {info.android_version}</Badge>}
        </div>

        <dl className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <InfoRow icon={<Wifi size={15} />} label="Connection ID" value={serial} mono copyable />
        </dl>
      </Card>

      <Card>
        <CardTitle>Quick actions</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy === 'shot'}
            onClick={() =>
              run('shot', async () => {
                const [path, png] = await saveScreenshot(serial, `${fileSafe(title)}-${stamp()}.png`)
                setImage(png)
                toast(`Saved to ${path}`)
              })
            }
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
        <Card>
          <div className="mb-3 flex items-center justify-between gap-2">
            <CardTitle className="mb-0!">Screenshot</CardTitle>
            <Button
              onClick={() =>
                run('copy', async () => {
                  await copyPng(new Blob([fromBase64(image)], { type: 'image/png' }))
                  toast('Screenshot copied')
                })
              }
            >
              <Copy size={16} /> Copy
            </Button>
          </div>
          <img
            src={`data:image/png;base64,${image}`}
            alt="Device screenshot"
            className="max-h-[480px] rounded-lg border border-zinc-200 dark:border-zinc-700"
          />
        </Card>
      )}

      {info?.sections.map((section) => (
        <Card key={section.title}>
          <CardTitle>{section.title}</CardTitle>
          <dl className="grid gap-x-8 text-sm sm:grid-cols-2 xl:grid-cols-3 [&>div]:border-b [&>div]:border-zinc-100 dark:[&>div]:border-zinc-800">
            {section.rows.map(([label, value]) => (
              <InfoRow key={label} label={label} value={value} copyable plain mono={value.length > 24} />
            ))}
          </dl>
        </Card>
      ))}

      {info && info.props.length > 0 && <PropsCard props={info.props} />}

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

function PropsCard({ props }: { props: [string, string][] }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const q = query.trim().toLowerCase()
  const shown = q
    ? props.filter(([k, v]) => k.toLowerCase().includes(q) || v.toLowerCase().includes(q))
    : props

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-sm font-semibold text-zinc-500 dark:text-zinc-400"
      >
        <span>All properties ({props.length})</span>
        <span className="text-xs font-normal">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="mt-3">
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter properties..."
              className="w-full rounded-lg border border-zinc-200 bg-transparent py-1.5 pl-8 pr-3 text-sm outline-none focus:border-emerald-500 dark:border-zinc-700"
            />
          </div>
          <div className="max-h-96 overflow-auto font-mono text-xs">
            {shown.map(([k, v]) => (
              <div key={k} className="flex gap-3 border-b border-zinc-100 py-1 dark:border-zinc-800">
                <span className="w-1/2 shrink-0 break-all text-zinc-500">{k}</span>
                <span className="min-w-0 flex-1 break-all">{v}</span>
              </div>
            ))}
            {shown.length === 0 && <p className="py-2 text-zinc-500">No matches.</p>}
          </div>
        </div>
      )}
    </Card>
  )
}
