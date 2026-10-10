import { Eraser, Eye, EyeOff, FolderDown, Play, Search, Trash2, SquareX, Brush } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  appDetail,
  appStorage,
  clearAppCache,
  extractAppApk,
  fireIntent,
  forceStopApp,
  launchApp,
  setAppEnabled,
  setAppPermission,
  type App,
  type AppDetail,
  type AppStorage,
} from '../../lib/adb'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { InfoRow } from '../../components/ui/InfoRow'
import { Input } from '../../components/ui/Input'
import { Switch } from '../../components/ui/Switch'
import { useToast } from '../../components/ui/toast'
import { formatSize } from '../files/paths'
import { AppIcon } from './AppIcon'

interface Props {
  serial: string
  app: App | null
  onClose: () => void
  /** The list should reload (the app was disabled, enabled or changed). */
  onChanged: () => void
  /** Destructive actions are confirmed by the list, so hand them back. */
  onRequest: (kind: 'uninstall' | 'clear', app: App) => void
}

export function AppDetailDialog({ serial, app, onClose, onChanged, onRequest }: Props) {
  return (
    <Dialog open={app !== null} onClose={onClose} title="App details" size="lg">
      {app && <Body serial={serial} app={app} onChanged={onChanged} onRequest={onRequest} />}
    </Dialog>
  )
}

const shortName = (permission: string) => permission.replace(/^android\.permission\./, '')

function Body({ serial, app, onChanged, onRequest }: Omit<Props, 'app' | 'onClose'> & { app: App }) {
  const toast = useToast()
  const pkg = app.package
  const [detail, setDetail] = useState<AppDetail | null>(null)
  const [storage, setStorage] = useState<AppStorage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const load = useCallback(() => {
    appDetail(serial, pkg)
      .then(setDetail)
      .catch((e) => setError(String(e)))
    appStorage(serial, pkg)
      .then(setStorage)
      .catch(() => setStorage({ app_bytes: null, data_bytes: null, cache_bytes: null }))
  }, [serial, pkg])
  useEffect(load, [load])

  const run = async (key: string, action: () => Promise<string | void>, reload = false) => {
    setBusy(key)
    try {
      const message = await action()
      if (message) toast(message)
      if (reload) {
        load()
        onChanged()
      }
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const togglePermission = async (name: string, grant: boolean) => {
    const set = (granted: boolean) =>
      setDetail((d) => d && { ...d, permissions: d.permissions.map((p) => (p.name === name ? { ...p, granted } : p)) })
    set(grant)
    try {
      await setAppPermission(serial, pkg, name, grant)
    } catch (e) {
      set(!grant)
      toast(String(e), 'error')
    }
  }

  const permissions = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = detail?.permissions ?? []
    return q ? all.filter((p) => p.name.toLowerCase().includes(q)) : all
  }, [detail, query])

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>

  const enabled = detail?.enabled ?? true
  const size = (bytes: number | null | undefined) => (bytes == null ? '-' : formatSize(bytes))

  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-3">
        <AppIcon serial={serial} pkg={pkg} apkPath={app.apk_path} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{pkg}</div>
          <div className="text-xs text-zinc-500">{detail?.version_name ?? app.version_name ?? 'unknown version'}</div>
        </div>
        {detail?.system && <Badge tone="zinc">system</Badge>}
        {detail && !enabled && <Badge tone="amber">disabled</Badge>}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button disabled={busy !== null || !enabled} onClick={() => run('launch', () => launchApp(serial, pkg))}>
          <Play size={15} /> Launch
        </Button>
        <Button disabled={busy !== null} onClick={() => run('stop', () => forceStopApp(serial, pkg).then(() => 'Force stopped'))}>
          <SquareX size={15} /> Force stop
        </Button>
        <Button
          disabled={busy !== null}
          onClick={() => run('cache', () => clearAppCache(serial, pkg).then(() => 'Cache cleared'), true)}
        >
          <Brush size={15} /> Clear cache
        </Button>
        <Button disabled={busy !== null} onClick={() => onRequest('clear', app)}>
          <Eraser size={15} /> Clear data
        </Button>
        <Button
          disabled={busy !== null || !detail}
          onClick={() =>
            run(
              'enabled',
              () => setAppEnabled(serial, pkg, !enabled).then(() => (enabled ? 'Disabled' : 'Enabled')),
              true,
            )
          }
        >
          {enabled ? <EyeOff size={15} /> : <Eye size={15} />} {enabled ? 'Disable' : 'Enable'}
        </Button>
        <Button
          disabled={busy !== null}
          onClick={() => run('apk', async () => `Saved the APK to ${await extractAppApk(serial, pkg)}`)}
        >
          <FolderDown size={15} /> Extract APK
        </Button>
        <Button
          disabled={busy !== null}
          onClick={() => onRequest('uninstall', app)}
          className="text-red-600 dark:text-red-400"
        >
          <Trash2 size={15} /> Uninstall
        </Button>
      </div>

      <dl className="grid gap-x-8 text-sm sm:grid-cols-2 [&>div]:border-b [&>div]:border-zinc-100 dark:[&>div]:border-zinc-800">
        <InfoRow plain label="Version code" value={detail?.version_code ?? (detail ? '-' : undefined)} />
        <InfoRow
          plain
          label="SDK"
          value={detail ? `target ${detail.target_sdk ?? '?'}, min ${detail.min_sdk ?? '?'}` : undefined}
        />
        <InfoRow plain label="Installed by" value={detail ? (detail.installer ?? 'adb or unknown') : undefined} mono />
        <InfoRow plain label="First installed" value={detail?.first_install ?? (detail ? '-' : undefined)} />
        <InfoRow plain label="Last updated" value={detail?.last_update ?? (detail ? '-' : undefined)} />
        <InfoRow
          plain
          label="APK files"
          value={detail ? `${detail.apk_paths.length} file${detail.apk_paths.length === 1 ? '' : 's'}` : undefined}
        />
        <InfoRow plain label="App size" value={storage ? size(storage.app_bytes) : undefined} />
        <InfoRow plain label="Data size" value={storage ? size(storage.data_bytes) : undefined} />
        <InfoRow plain label="Cache size" value={storage ? size(storage.cache_bytes) : undefined} />
      </dl>

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
            Permissions{detail ? ` (${detail.permissions.length})` : ''}
          </h3>
          <div className="relative w-48">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-zinc-400" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter" className="pl-8" />
          </div>
        </div>
        {!detail ? (
          <p className="py-3 text-center text-sm text-zinc-500">Loading...</p>
        ) : permissions.length === 0 ? (
          <p className="py-3 text-center text-sm text-zinc-500">
            {detail.permissions.length === 0 ? 'This app asks for no permissions.' : 'No permissions match.'}
          </p>
        ) : (
          <ul className="max-h-64 divide-y divide-zinc-200 overflow-auto rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {permissions.map((p) => (
              <li key={p.name} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm" title={p.name}>
                  {shortName(p.name)}
                </span>
                {p.runtime ? (
                  <Switch
                    checked={p.granted}
                    onChange={(grant) => void togglePermission(p.name, grant)}
                    aria-label={`${shortName(p.name)} permission`}
                  />
                ) : (
                  <Badge tone={p.granted ? 'green' : 'zinc'}>{p.granted ? 'granted' : 'not granted'}</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-zinc-500">
          Only runtime permissions can be switched. The others are fixed when the app is installed.
        </p>
      </section>

      {detail && detail.activities.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
            Screens ({detail.activities.length})
          </h3>
          <ul className="max-h-48 divide-y divide-zinc-200 overflow-auto rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {detail.activities.map((component) => (
              <li key={component} className="flex items-center gap-3 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate font-mono text-xs" title={component}>
                  {component.slice(pkg.length + 1)}
                </span>
                <Button
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() =>
                    run('activity', async () => {
                      await fireIntent(serial, {
                        target: 'activity',
                        action: null,
                        data: null,
                        mime: null,
                        component,
                        package: null,
                        categories: [],
                        extras: [],
                      })
                    })
                  }
                  title="Open this screen"
                >
                  <Play size={14} />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
