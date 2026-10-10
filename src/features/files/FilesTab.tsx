import { downloadDir } from '@tauri-apps/api/path'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { ArrowUp, ChevronRight, Download, FilePlus2, FolderPlus, FolderUp, RefreshCw, Search, Trash2, UploadCloud, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { cn } from '../../components/ui/cn'
import { Input } from '../../components/ui/Input'
import { Tooltip } from '../../components/ui/Tooltip'
import { useToast } from '../../components/ui/toast'
import {
  deleteFiles,
  downloadFiles,
  listFiles,
  makeFolder,
  readFile,
  renameFile,
  uploadFiles,
  type FileEntry,
} from '../../lib/adb'
import { useFileDrop } from '../../lib/useFileDrop'
import { DeleteDialog, NameDialog, PreviewDialog } from './FileDialogs'
import { FileList } from './FileList'
import { breadcrumbs, joinPath, parentOf, previewMime, ROOT, sortEntries, type SortKey } from './paths'

const QUICK_LINKS = [
  { label: 'Internal storage', path: ROOT },
  { label: 'Downloads', path: `${ROOT}/Download` },
  { label: 'Camera', path: `${ROOT}/DCIM/Camera` },
  { label: 'Pictures', path: `${ROOT}/Pictures` },
  { label: 'Documents', path: `${ROOT}/Documents` },
]

const NO_SELECTION: ReadonlySet<string> = new Set()

type Dialogs =
  | { kind: 'newFolder' }
  | { kind: 'rename'; entry: FileEntry }
  | { kind: 'delete'; names: string[] }
  | { kind: 'preview'; entry: FileEntry; src: string | null; error: string | null }
  | null

interface Props {
  serial: string
  /** Only accept dropped files while this tab is showing. */
  active: boolean
}

export function FilesTab({ serial, active }: Props) {
  const toast = useToast()
  const [path, setPath] = useState(ROOT)
  const [refresh, setRefresh] = useState(0)
  const [result, setResult] = useState<{ key: string; entries: FileEntry[]; error: string | null } | null>(null)
  const [selection, setSelection] = useState<{ path: string; names: ReadonlySet<string> }>({ path, names: NO_SELECTION })
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({ key: 'name', ascending: true })
  const [busy, setBusy] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialogs>(null)

  // The folder being shown is whichever `result` matches the current path and refresh count.
  const key = `${path}#${refresh}`
  const loading = result?.key !== key
  const entries = useMemo(() => (loading || !result ? [] : result.entries), [loading, result])
  const error = !loading && result ? result.error : null
  const selected = selection.path === path ? selection.names : NO_SELECTION

  useEffect(() => {
    let cancelled = false
    listFiles(serial, path)
      .then((list) => !cancelled && setResult({ key, entries: list, error: null }))
      .catch((e) => !cancelled && setResult({ key, entries: [], error: String(e) }))
    return () => {
      cancelled = true
    }
  }, [serial, path, key])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = needle ? entries.filter((e) => e.name.toLowerCase().includes(needle)) : entries
    return sortEntries(filtered, sort.key, sort.ascending)
  }, [entries, query, sort])

  const reload = () => setRefresh((n) => n + 1)
  const goTo = (next: string) => {
    setPath(next)
    setQuery('')
  }

  const setSelected = (names: ReadonlySet<string>) => setSelection({ path, names })
  const toggle = (name: string) => {
    const next = new Set(selected)
    if (!next.delete(name)) next.add(name)
    setSelected(next)
  }
  const toggleAll = (checked: boolean) => setSelected(checked ? new Set(visible.map((e) => e.name)) : NO_SELECTION)

  const onSort = (k: SortKey) =>
    setSort((s) => (s.key === k ? { key: k, ascending: !s.ascending } : { key: k, ascending: true }))

  /** Runs a slow action with a status line, then refreshes the listing. */
  const run = async (label: string, action: () => Promise<string | void>, reloadAfter = true) => {
    setBusy(label)
    try {
      const message = await action()
      if (message) toast(message)
      if (reloadAfter) reload()
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const download = (names: string[]) =>
    run(
      names.length === 1 ? `Downloading ${names[0]}...` : `Downloading ${names.length} items...`,
      async () => {
        const dest = await downloadDir()
        const written = await downloadFiles(serial, names.map((n) => joinPath(path, n)), dest)
        return `Saved ${written.length === 1 ? 'it' : `${written.length} items`} to Downloads`
      },
      false,
    )

  const upload = (paths: string[]) => {
    if (paths.length === 0) return
    return run(`Uploading ${paths.length === 1 ? '1 item' : `${paths.length} items`}...`, async () => {
      await uploadFiles(serial, paths, path)
      return `Uploaded ${paths.length === 1 ? '1 item' : `${paths.length} items`}`
    })
  }

  const pick = async (directory: boolean) => {
    const choice = await openDialog({ multiple: !directory, directory })
    if (!choice) return
    await upload(Array.isArray(choice) ? choice : [choice])
  }

  const dragOver = useFileDrop(active && busy === null, (paths) => void upload(paths))

  const open = (entry: FileEntry) => {
    if (entry.kind === 'dir') return goTo(joinPath(path, entry.name))
    if (!previewMime(entry.name)) return toggle(entry.name)
    setDialog({ kind: 'preview', entry, src: null, error: null })
    const mime = previewMime(entry.name)
    readFile(serial, joinPath(path, entry.name))
      .then((b64) => setDialog((d) => (d?.kind === 'preview' && d.entry === entry ? { ...d, src: `data:${mime};base64,${b64}` } : d)))
      .catch((e) => setDialog((d) => (d?.kind === 'preview' && d.entry === entry ? { ...d, error: String(e) } : d)))
  }

  const crumbs = breadcrumbs(path)
  const selectedNames = [...selected]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip label="Up one folder">
          <Button disabled={path === '/'} onClick={() => goTo(parentOf(path))}>
            <ArrowUp size={16} />
          </Button>
        </Tooltip>
        <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 text-sm" aria-label="Folder path">
          <button type="button" className="cursor-pointer rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => goTo('/')}>
            /
          </button>
          {crumbs.map((c, i) => (
            <span key={c.path} className="flex items-center gap-0.5">
              {i > 0 && <ChevronRight size={14} className="text-zinc-400" />}
              {i === crumbs.length - 1 ? (
                <span className="px-1.5 py-0.5 font-semibold">{c.name}</span>
              ) : (
                <button type="button" className="cursor-pointer rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => goTo(c.path)}>
                  {c.name}
                </button>
              )}
            </span>
          ))}
        </nav>
        <Tooltip label="Upload files">
          <Button onClick={() => void pick(false)} disabled={busy !== null}>
            <FilePlus2 size={16} /> Upload
          </Button>
        </Tooltip>
        <Tooltip label="Upload a folder">
          <Button onClick={() => void pick(true)} disabled={busy !== null}>
            <FolderUp size={16} />
          </Button>
        </Tooltip>
        <Tooltip label="New folder">
          <Button onClick={() => setDialog({ kind: 'newFolder' })} disabled={busy !== null}>
            <FolderPlus size={16} />
          </Button>
        </Tooltip>
        <Tooltip label="Refresh">
          <Button onClick={reload}>
            <RefreshCw size={16} className={cn(loading && 'animate-spin')} />
          </Button>
        </Tooltip>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-48 flex-1">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-zinc-400" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by name" className="pl-8" />
        </div>
        <div className="flex flex-wrap gap-1">
          {QUICK_LINKS.map((l) => (
            <Button key={l.path} variant={path === l.path ? 'secondary' : 'ghost'} onClick={() => goTo(l.path)}>
              {l.label}
            </Button>
          ))}
        </div>
      </div>

      {selectedNames.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm">
          <span className="font-medium">{selectedNames.length} selected</span>
          <div className="flex-1" />
          <Button onClick={() => void download(selectedNames)} disabled={busy !== null}>
            <Download size={15} /> Download
          </Button>
          <Button variant="danger" onClick={() => setDialog({ kind: 'delete', names: selectedNames })} disabled={busy !== null}>
            <Trash2 size={15} /> Delete
          </Button>
          <Button variant="ghost" onClick={() => setSelected(NO_SELECTION)}>
            <X size={15} /> Clear
          </Button>
        </div>
      )}

      {busy && <p className="animate-pulse text-sm text-blue-600 dark:text-blue-400">{busy}</p>}

      <div className="relative">
        {error ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm">
            <p className="font-medium">Can't open this folder</p>
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">{error}</p>
            <p className="mt-2 text-xs text-zinc-500">Android keeps some folders, like other apps' private data, off limits over adb.</p>
          </div>
        ) : loading ? (
          <p className="py-10 text-center text-sm text-zinc-500">Loading...</p>
        ) : visible.length === 0 ? (
          <div className="grid justify-items-center gap-2 rounded-xl border border-dashed border-zinc-300 py-12 text-center dark:border-zinc-700">
            <UploadCloud size={28} className="text-zinc-400" />
            <p className="text-sm font-medium">{entries.length === 0 ? 'This folder is empty' : 'No files match'}</p>
            {entries.length === 0 && <p className="text-xs text-zinc-500">Drag files here to upload them</p>}
          </div>
        ) : (
          <FileList
            entries={visible}
            selected={selected}
            sort={sort}
            onSort={onSort}
            onToggle={toggle}
            onToggleAll={toggleAll}
            onOpen={open}
            onDownload={(e) => void download([e.name])}
            onRename={(entry) => setDialog({ kind: 'rename', entry })}
            onDelete={(e) => setDialog({ kind: 'delete', names: [e.name] })}
          />
        )}
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl border-2 border-dashed border-blue-500 bg-blue-500/10 backdrop-blur-[1px]">
            <div className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium shadow-lg dark:bg-zinc-900">
              <UploadCloud size={18} className="text-blue-500" /> Drop to upload to {path}
            </div>
          </div>
        )}
      </div>

      {!loading && !error && entries.length > 0 && (
        <p className="text-xs text-zinc-500">
          {visible.length === entries.length ? `${entries.length} items` : `${visible.length} of ${entries.length} items`}
        </p>
      )}

      <NameDialog
        open={dialog?.kind === 'newFolder'}
        title="New folder"
        label="Folder name"
        initial=""
        confirm="Create"
        onClose={() => setDialog(null)}
        onSubmit={(name) => {
          setDialog(null)
          void run('Creating folder...', async () => {
            await makeFolder(serial, path, name)
          })
        }}
      />
      <NameDialog
        open={dialog?.kind === 'rename'}
        title="Rename"
        label="New name"
        initial={dialog?.kind === 'rename' ? dialog.entry.name : ''}
        confirm="Rename"
        onClose={() => setDialog(null)}
        onSubmit={(name) => {
          const entry = dialog?.kind === 'rename' ? dialog.entry : null
          setDialog(null)
          if (!entry || name === entry.name) return
          void run('Renaming...', async () => {
            await renameFile(serial, joinPath(path, entry.name), name)
            setSelected(NO_SELECTION)
          })
        }}
      />
      <DeleteDialog
        open={dialog?.kind === 'delete'}
        names={dialog?.kind === 'delete' ? dialog.names : []}
        onClose={() => setDialog(null)}
        onConfirm={() => {
          const names = dialog?.kind === 'delete' ? dialog.names : []
          setDialog(null)
          void run('Deleting...', async () => {
            await deleteFiles(serial, names.map((n) => joinPath(path, n)))
            setSelected(NO_SELECTION)
            return names.length === 1 ? 'Deleted' : `Deleted ${names.length} items`
          })
        }}
      />
      <PreviewDialog
        name={dialog?.kind === 'preview' ? dialog.entry.name : null}
        src={dialog?.kind === 'preview' ? dialog.src : null}
        error={dialog?.kind === 'preview' ? dialog.error : null}
        onClose={() => setDialog(null)}
        onDownload={() => {
          const name = dialog?.kind === 'preview' ? dialog.entry.name : null
          setDialog(null)
          if (name) void download([name])
        }}
      />
    </div>
  )
}
