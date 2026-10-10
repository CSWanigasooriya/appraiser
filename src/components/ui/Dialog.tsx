import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from './Button'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  /** `lg` for content like image previews. */
  size?: 'md' | 'lg'
  children: ReactNode
}

/** Modal built on the native <dialog> element: focus trap and Esc come for free. */
export function Dialog({ open, onClose, title, size = 'md', children }: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`m-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] overflow-y-auto ${size === 'lg' ? 'max-w-3xl' : 'max-w-md'} rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-black/50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100`}
    >
      {/* Content only mounts while open so forms and QR sessions reset on close. */}
      {open && (
        <div className="p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{title}</h2>
            <Button variant="ghost" onClick={onClose} aria-label="Close" className="px-1.5">
              <X size={18} />
            </Button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  )
}
