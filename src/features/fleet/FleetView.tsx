import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { AlertCircle, CheckCircle2, Layers, Loader2, PackagePlus, Terminal as TerminalIcon, UploadCloud } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card, CardTitle } from '../../components/ui/Card'
import { cn } from '../../components/ui/cn'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import {
  installApk,
  rebootDevice,
  runShell,
  saveScreenshot,
  setAirplane,
  setDevSetting,
  setMobileData,
  setWifi,
  type Device,
} from '../../lib/adb'
import { fileSafe, stamp } from '../../lib/format'
import { useFileDrop } from '../../lib/useFileDrop'

type Outcome = { state: 'running' } | { state: 'ok'; text: string } | { state: 'error'; text: string }

interface Toggle {
  label: string
  on: (serial: string) => Promise<unknown>
  off: (serial: string) => Promise<unknown>
}

const setting = (key: string, on: string, off: string): Pick<Toggle, 'on' | 'off'> => ({
  on: (s) => setDevSetting(s, key, on),
  off: (s) => setDevSetting(s, key, off),
})

const TOGGLES: Toggle[] = [
  { label: 'Wi-Fi', on: (s) => setWifi(s, true), off: (s) => setWifi(s, false) },
  { label: 'Mobile data', on: (s) => setMobileData(s, true), off: (s) => setMobileData(s, false) },
  { label: 'Airplane mode', on: (s) => setAirplane(s, true), off: (s) => setAirplane(s, false) },
  { label: 'Stay awake', ...setting('stay_awake', '1', '0') },
  { label: 'Show touches', ...setting('show_touches', '1', '0') },
  { label: 'Dark mode', ...setting('dark_mode', 'yes', 'no') },
]

const name = (d: Device) => d.model ?? d.serial

/** Runs one action on several phones at once. */
export function FleetView({ devices }: { devices: Device[] }) {
  const online = useMemo(() => devices.filter((d) => d.state === 'online'), [devices])
  const [chosen, setChosen] = useState<ReadonlySet<string> | null>(null)
  const [results, setResults] = useState<Record<string, Outcome>>({})
  const [title, setTitle] = useState<string | null>(null)
  const [command, setCommand] = useState('')
  const [confirmReboot, setConfirmReboot] = useState(false)
  const [installing, setInstalling] = useState(false)

  // Until the user picks, every connected phone is included.
  const targets = online.filter((d) => chosen === null || chosen.has(d.serial))
  const busy = Object.values(results).some((r) => r.state === 'running')

  const toggleDevice = (serial: string) => {
    const next = new Set(chosen ?? online.map((d) => d.serial))
    if (!next.delete(serial)) next.add(serial)
    setChosen(next)
  }

  /** Runs `action` on every chosen phone in parallel, showing each result as it lands. */
  const runAll = async (label: string, action: (serial: string) => Promise<string | void | unknown>) => {
    const list = targets
    setTitle(label)
    setResults(Object.fromEntries(list.map((d) => [d.serial, { state: 'running' } as Outcome])))
    await Promise.all(
      list.map(async (d) => {
        let outcome: Outcome
        try {
          const out = await action(d.serial)
          outcome = { state: 'ok', text: typeof out === 'string' ? out.trim() : '' }
        } catch (e) {
          outcome = { state: 'error', text: String(e) }
        }
        setResults((r) => ({ ...r, [d.serial]: outcome }))
      }),
    )
  }

  const install = async (paths: string[]) => {
    const apks = paths.filter((p) => p.toLowerCase().endsWith('.apk'))
    if (apks.length === 0) return
    setInstalling(true)
    await runAll(apks.length > 1 ? `Install ${apks.length} split APKs` : 'Install APK', async (serial) => {
      await installApk(serial, apks)
      return 'Installed'
    })
    setInstalling(false)
  }

  const dragOver = useFileDrop(true, (paths) => void install(paths))

  const pick = async () => {
    const selection = await openDialog({ multiple: true, filters: [{ name: 'APK', extensions: ['apk'] }] })
    if (selection) void install(Array.isArray(selection) ? selection : [selection])
  }

  const disabled = busy || targets.length === 0

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">All devices</h2>
        <Badge tone="blue">
          <Layers size={12} /> {targets.length} of {online.length} selected
        </Badge>
      </header>

      <Card>
        <CardTitle>Devices</CardTitle>
        {online.length === 0 ? (
          <p className="text-sm text-zinc-500">No device is online.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {online.map((d) => {
              const on = chosen === null || chosen.has(d.serial)
              return (
                <button
                  key={d.serial}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDevice(d.serial)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors',
                    on
                      ? 'border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300'
                      : 'border-zinc-300 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800',
                  )}
                >
                  {name(d)}
                  <span className="text-xs text-zinc-500">{d.serial}</span>
                </button>
              )
            })}
          </div>
        )}
      </Card>

      <div
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition-colors',
          dragOver ? 'border-blue-500 bg-blue-500/10' : 'border-zinc-300 dark:border-zinc-700',
        )}
      >
        {installing ? (
          <>
            <PackagePlus size={28} className="animate-pulse text-blue-500" />
            <p className="text-sm font-medium">Installing on {targets.length} devices...</p>
          </>
        ) : (
          <>
            <UploadCloud size={28} className="text-zinc-400" />
            <p className="text-sm font-medium">Drag an APK here to install it on every selected device</p>
            <Button disabled={disabled} onClick={() => void pick()}>
              Choose file...
            </Button>
          </>
        )}
      </div>

      <Card>
        <CardTitle>Run a command</CardTitle>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const cmd = command.trim()
            if (cmd) void runAll(`$ ${cmd}`, (serial) => runShell(serial, cmd))
          }}
        >
          <div className="relative flex-1">
            <TerminalIcon size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-zinc-400" />
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="getprop ro.build.version.release"
              className="pl-8 font-mono"
              spellCheck={false}
              aria-label="Shell command"
            />
          </div>
          <Button variant="primary" disabled={disabled || !command.trim()}>
            Run
          </Button>
        </form>
      </Card>

      <Card>
        <CardTitle>Switches and actions</CardTitle>
        <div className="grid gap-2 sm:grid-cols-2">
          {TOGGLES.map((t) => (
            <div key={t.label} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 text-sm">{t.label}</span>
              <Button disabled={disabled} onClick={() => void runAll(`${t.label} on`, t.on)}>
                On
              </Button>
              <Button disabled={disabled} onClick={() => void runAll(`${t.label} off`, t.off)}>
                Off
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            disabled={disabled}
            onClick={() =>
              void runAll('Screenshot', async (serial) => {
                const d = devices.find((x) => x.serial === serial)
                const [path] = await saveScreenshot(serial, `${fileSafe(d ? name(d) : serial)}-${stamp()}.png`)
                return `Saved to ${path}`
              })
            }
          >
            Take screenshots
          </Button>
          <Button variant="danger" disabled={disabled} onClick={() => setConfirmReboot(true)}>
            Reboot
          </Button>
        </div>
      </Card>

      {title && (
        <Card>
          <CardTitle>{title}</CardTitle>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {Object.entries(results).map(([serial, r]) => {
              const d = devices.find((x) => x.serial === serial)
              return (
                <li key={serial} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="mt-0.5 flex-none">
                    {r.state === 'running' ? (
                      <Loader2 size={16} className="animate-spin text-zinc-400" />
                    ) : r.state === 'ok' ? (
                      <CheckCircle2 size={16} className="text-green-600" />
                    ) : (
                      <AlertCircle size={16} className="text-red-600 dark:text-red-400" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{d ? name(d) : serial}</div>
                    {r.state !== 'running' && r.text && (
                      <pre
                        className={cn(
                          'mt-1 max-h-40 overflow-auto font-mono text-xs whitespace-pre-wrap',
                          r.state === 'error' ? 'text-red-600 dark:text-red-400' : 'text-zinc-500',
                        )}
                      >
                        {r.text}
                      </pre>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      <Dialog open={confirmReboot} onClose={() => setConfirmReboot(false)} title="Reboot devices">
        <p className="mb-5 text-sm text-zinc-600 dark:text-zinc-400">
          This restarts {targets.length} device{targets.length === 1 ? '' : 's'}. Unsaved work on them may be lost.
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirmReboot(false)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmReboot(false)
              void runAll('Reboot', async (serial) => {
                await rebootDevice(serial, 'system')
                return 'Rebooting'
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
