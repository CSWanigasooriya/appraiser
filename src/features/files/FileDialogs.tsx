import { Download } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import { nameProblem } from './paths'

interface NameDialogProps {
  open: boolean
  title: string
  label: string
  initial: string
  confirm: string
  onClose: () => void
  onSubmit: (name: string) => void
}

/** Asks for one file or folder name (new folder, rename). */
export function NameDialog({ open, title, label, initial, confirm, onClose, onSubmit }: NameDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <NameForm label={label} initial={initial} confirm={confirm} onCancel={onClose} onSubmit={onSubmit} />
    </Dialog>
  )
}

function NameForm({ label, initial, confirm, onCancel, onSubmit }: Pick<NameDialogProps, 'label' | 'initial' | 'confirm' | 'onSubmit'> & { onCancel: () => void }) {
  const [name, setName] = useState(initial)
  const problem = nameProblem(name)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!problem) onSubmit(name.trim())
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <label className="grid gap-1 text-sm">
        <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          onFocus={(e) => {
            // Select the name without its extension, as file managers do.
            const dot = e.target.value.lastIndexOf('.')
            e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length)
          }}
          spellCheck={false}
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={problem !== null} title={problem ?? undefined}>
          {confirm}
        </Button>
      </div>
    </form>
  )
}

interface DeleteDialogProps {
  open: boolean
  names: string[]
  onClose: () => void
  onConfirm: () => void
}

export function DeleteDialog({ open, names, onClose, onConfirm }: DeleteDialogProps) {
  const shown = names.slice(0, 5)
  return (
    <Dialog open={open} onClose={onClose} title={names.length === 1 ? 'Delete this item?' : `Delete ${names.length} items?`}>
      <ul className="mb-3 space-y-1 text-sm">
        {shown.map((n) => (
          <li key={n} className="truncate font-mono text-xs">
            {n}
          </li>
        ))}
        {names.length > shown.length && <li className="text-xs text-zinc-500">and {names.length - shown.length} more</li>}
      </ul>
      <p className="mb-5 text-sm text-zinc-600 dark:text-zinc-400">
        This permanently deletes {names.length === 1 ? 'it' : 'them'} from the phone, including everything inside folders. It
        can't be undone.
      </p>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm}>
          Delete
        </Button>
      </div>
    </Dialog>
  )
}

interface PreviewDialogProps {
  name: string | null
  src: string | null
  error: string | null
  onClose: () => void
  onDownload: () => void
}

export function PreviewDialog({ name, src, error, onClose, onDownload }: PreviewDialogProps) {
  return (
    <Dialog open={name !== null} onClose={onClose} title={name ?? ''} size="lg">
      <div className="grid min-h-40 place-items-center rounded-lg bg-zinc-100 p-2 dark:bg-zinc-950">
        {error ? (
          <p className="p-6 text-sm text-red-500">{error}</p>
        ) : src ? (
          <img src={src} alt={name ?? ''} className="max-h-[60vh] max-w-full object-contain" />
        ) : (
          <p className="text-sm text-zinc-500">Loading preview...</p>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Close</Button>
        <Button variant="primary" onClick={onDownload}>
          <Download size={15} /> Download
        </Button>
      </div>
    </Dialog>
  )
}
