import { useCallback, useEffect, useState } from 'react'
import { appVersions, listApps, type App } from '../../lib/adb'
import { useToast } from '../../components/ui/toast'
import { AppList } from './AppList'
import { InstallDropzone } from './InstallDropzone'

export function AppsTab({ serial }: { serial: string }) {
  const toast = useToast()
  const [apps, setApps] = useState<App[]>([])
  const [loading, setLoading] = useState(true)
  const [includeSystem, setIncludeSystem] = useState(false)

  const refresh = useCallback(() => {
    setLoading(true)
    listApps(serial, includeSystem)
      .then((list) => {
        setApps(list)
        setLoading(false)
        // Version names are slow to fetch; fill them in once the list shows.
        appVersions(serial)
          .then((v) =>
            setApps((cur) => cur.map((a) => ({ ...a, version_name: v[a.package] ?? a.version_name }))),
          )
          .catch(() => {})
      })
      .catch((e) => {
        toast(String(e), 'error')
        setLoading(false)
      })
  }, [serial, includeSystem, toast])

  useEffect(refresh, [refresh])

  return (
    <div className="space-y-5">
      <InstallDropzone serial={serial} onInstalled={refresh} />
      <AppList
        serial={serial}
        apps={apps}
        loading={loading}
        includeSystem={includeSystem}
        onIncludeSystemChange={setIncludeSystem}
        onChanged={refresh}
      />
    </div>
  )
}
