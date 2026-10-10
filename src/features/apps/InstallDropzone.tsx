import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { PackagePlus, UploadCloud } from 'lucide-react'
import { useEffect, useState } from 'react'
import { installApk } from '../../lib/adb'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/toast'

interface Props {
  serial: string
  onInstalled: () => void
}

/** Drag-and-drop + file-picker zone for installing one APK, or several for a split-APK set. */
export function InstallDropzone({ serial, onInstalled }: Props) {
  const toast = useToast()
  const [dragOver, setDragOver] = useState(false)
  const [installing, setInstalling] = useState(false)

  const install = async (paths: string[]) => {
    const apks = paths.filter((p) => p.toLowerCase().endsWith('.apk'))
    if (apks.length === 0) {
      toast('Drop an .apk file (or several, for a split APK).', 'error')
      return
    }
    setInstalling(true)
    try {
      await installApk(serial, apks)
      toast(apks.length > 1 ? `Installed ${apks.length} split APKs` : 'Installed')
      onInstalled()
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setInstalling(false)
    }
  }

  // Tauri delivers OS-level drag-drop as a window event with real file paths,
  // not a browser DragEvent, so adb can install straight from disk.
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === 'drop') {
        setDragOver(false)
        install(e.payload.paths)
      } else if (e.payload.type === 'over') {
        setDragOver(true)
      } else {
        setDragOver(false)
      }
    })
    return () => {
      unlisten.then((fn) => fn())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serial])

  const pick = async () => {
    const selection = await openDialog({
      multiple: true,
      filters: [{ name: 'APK', extensions: ['apk'] }],
    })
    if (!selection) return
    install(Array.isArray(selection) ? selection : [selection])
  }

  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
        dragOver
          ? 'border-blue-500 bg-blue-500/10'
          : 'border-zinc-300 dark:border-zinc-700'
      }`}
    >
      {installing ? (
        <>
          <PackagePlus size={28} className="animate-pulse text-blue-500" />
          <p className="text-sm font-medium">Installing...</p>
        </>
      ) : (
        <>
          <UploadCloud size={28} className="text-zinc-400" />
          <p className="text-sm font-medium">Drag an APK here to install</p>
          <p className="text-xs text-zinc-500">
            Drop several files at once to install a split APK (a base + config splits)
          </p>
          <Button onClick={pick}>Choose file...</Button>
        </>
      )}
    </div>
  )
}
