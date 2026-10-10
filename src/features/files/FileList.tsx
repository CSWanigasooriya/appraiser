import { ArrowDown, ArrowUp, Download, Pencil, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { cn } from '../../components/ui/cn'
import { Tooltip } from '../../components/ui/Tooltip'
import type { FileEntry } from '../../lib/adb'
import { FileIcon } from './FileIcon'
import { formatSize, type SortKey } from './paths'

interface Props {
  entries: FileEntry[]
  selected: ReadonlySet<string>
  sort: { key: SortKey; ascending: boolean }
  onSort: (key: SortKey) => void
  onToggle: (name: string) => void
  onToggleAll: (checked: boolean) => void
  onOpen: (entry: FileEntry) => void
  onDownload: (entry: FileEntry) => void
  onRename: (entry: FileEntry) => void
  onDelete: (entry: FileEntry) => void
}

function SortHeader({ label, id, sort, onSort, className }: { label: string; id: SortKey; sort: Props['sort']; onSort: Props['onSort']; className?: string }) {
  const active = sort.key === id
  return (
    <button
      type="button"
      onClick={() => onSort(id)}
      className={cn('flex cursor-pointer items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100', active && 'text-zinc-900 dark:text-zinc-100', className)}
    >
      {label}
      {active && (sort.ascending ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
    </button>
  )
}

export function FileList({ entries, selected, sort, onSort, onToggle, onToggleAll, onOpen, onDownload, onRename, onDelete }: Props) {
  const allSelected = entries.length > 0 && entries.every((e) => selected.has(e.name))

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60">
        <input type="checkbox" checked={allSelected} onChange={(e) => onToggleAll(e.target.checked)} aria-label="Select all" />
        <SortHeader label="Name" id="name" sort={sort} onSort={onSort} className="min-w-0 flex-1" />
        <SortHeader label="Size" id="size" sort={sort} onSort={onSort} className="w-20 flex-none justify-end" />
        <SortHeader label="Modified" id="modified" sort={sort} onSort={onSort} className="hidden w-36 flex-none md:flex" />
        <span className="w-28 flex-none" />
      </div>
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {entries.map((entry) => (
          <li
            key={entry.name}
            className={cn('group flex items-center gap-3 px-4 py-2', selected.has(entry.name) && 'bg-blue-500/10')}
          >
            <input
              type="checkbox"
              checked={selected.has(entry.name)}
              onChange={() => onToggle(entry.name)}
              aria-label={`Select ${entry.name}`}
            />
            <button
              type="button"
              onClick={() => onOpen(entry)}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
            >
              <FileIcon entry={entry} />
              <span className="truncate text-sm font-medium" title={entry.name}>
                {entry.name}
              </span>
            </button>
            <span className="w-20 flex-none text-right text-xs text-zinc-500">{entry.kind === 'dir' ? '' : formatSize(entry.size)}</span>
            <span className="hidden w-36 flex-none text-xs text-zinc-500 md:block">{entry.modified}</span>
            <div className="flex w-28 flex-none justify-end gap-0.5">
              <Tooltip label="Download">
                <Button variant="ghost" className="px-1.5" onClick={() => onDownload(entry)}>
                  <Download size={15} />
                </Button>
              </Tooltip>
              <Tooltip label="Rename">
                <Button variant="ghost" className="px-1.5" onClick={() => onRename(entry)}>
                  <Pencil size={15} />
                </Button>
              </Tooltip>
              <Tooltip label="Delete">
                <Button variant="ghost" className="px-1.5 text-red-500 hover:bg-red-500/10" onClick={() => onDelete(entry)}>
                  <Trash2 size={15} />
                </Button>
              </Tooltip>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
