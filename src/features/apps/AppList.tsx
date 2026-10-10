import { Eraser, Search, SquareX, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { clearAppData, forceStopApp, uninstallApp, type App } from '../../lib/adb'
import { AppIcon } from './AppIcon'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Tooltip } from '../../components/ui/Tooltip'
import { Input } from '../../components/ui/Input'
import { useToast } from '../../components/ui/toast'

interface Props {
  serial: string
  apps: App[]
  loading: boolean
  includeSystem: boolean
  onIncludeSystemChange: (v: boolean) => void
  onChanged: () => void
}

type PendingAction = { kind: 'uninstall' | 'clear'; app: App }

export function AppList({ serial, apps, loading, includeSystem, onIncludeSystemChange, onChanged }: Props) {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? apps.filter((a) => a.package.toLowerCase().includes(q)) : apps
  }, [apps, query])

  const run = async (pkg: string, fn: () => Promise<void>, successMsg: string) => {
    setBusy(pkg)
    try {
      await fn()
      toast(successMsg)
      onChanged()
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const confirmPending = () => {
    if (!pending) return
    const { kind, app } = pending
    setPending(null)
    if (kind === 'uninstall') {
      run(app.package, () => uninstallApp(serial, app.package), 'Uninstalled')
    } else {
      run(app.package, () => clearAppData(serial, app.package), 'Data cleared')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-zinc-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by package name"
            className="pl-8"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-500">
          <input
            type="checkbox"
            checked={includeSystem}
            onChange={(e) => onIncludeSystemChange(e.target.checked)}
          />
          Show system apps
        </label>
      </div>

      {loading ? (
        <p className="py-6 text-center text-sm text-zinc-500">Loading apps...</p>
      ) : filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">No apps match.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {filtered.map((app) => (
            <li key={app.package} className="flex items-center gap-3 px-4 py-2.5">
              <AppIcon key={`${serial}/${app.package}`} serial={serial} pkg={app.package} apkPath={app.apk_path} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{app.package}</div>
                <div className="text-xs text-zinc-500">
                  {app.version_name ?? 'unknown version'}
                  {app.system && (
                    <>
                      {' · '}
                      <Badge tone="zinc">system</Badge>
                    </>
                  )}
                </div>
              </div>
              <div className="flex flex-none gap-1">
                <Tooltip label="Force stop">
                  <Button
                    variant="ghost"
                    disabled={busy === app.package}
                    onClick={() => run(app.package, () => forceStopApp(serial, app.package), 'Force stopped')}
                  >
                    <SquareX size={15} />
                  </Button>
                </Tooltip>
                <Tooltip label="Clear data">
                  <Button
                    variant="ghost"
                    disabled={busy === app.package}
                    onClick={() => setPending({ kind: 'clear', app })}
                  >
                    <Eraser size={15} />
                  </Button>
                </Tooltip>
                <Tooltip label="Uninstall">
                  <Button
                    variant="ghost"
                    disabled={busy === app.package}
                    onClick={() => setPending({ kind: 'uninstall', app })}
                    className="text-red-600 dark:text-red-400"
                  >
                    <Trash2 size={15} />
                  </Button>
                </Tooltip>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending?.kind === 'uninstall' ? 'Uninstall app' : 'Clear app data'}
      >
        <p className="mb-5 text-sm text-zinc-600 dark:text-zinc-400">
          {pending?.kind === 'uninstall'
            ? `This will remove ${pending.app.package} and its data from the device.`
            : `This will erase all local data for ${pending?.app.package}, as if newly installed.`}
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setPending(null)}>Cancel</Button>
          <Button variant="danger" onClick={confirmPending}>
            {pending?.kind === 'uninstall' ? 'Uninstall' : 'Clear data'}
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
