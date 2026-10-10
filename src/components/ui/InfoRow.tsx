import { Check, Copy } from 'lucide-react'
import { useState, type ReactNode } from 'react'

export function InfoRow({
  icon,
  label,
  value,
  mono,
  copyable,
  plain,
}: {
  icon?: ReactNode
  label: string
  value: ReactNode
  mono?: boolean
  copyable?: boolean
  /** Standalone cell (e.g. in a grid): no first/last trimming. */
  plain?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    if (typeof value !== 'string' || !value) return
    navigator.clipboard
      .writeText(String(value))
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      })
      .catch(() => {})
  }

  return (
    <div className={`flex items-center gap-3 py-2.5 ${plain ? '' : 'first:pt-0 last:pb-0'}`}>
      {icon && <span className="text-zinc-400">{icon}</span>}
      <dt className="w-32 shrink-0 text-zinc-500">{label}</dt>
      <dd
        className={`min-w-0 flex-1 truncate text-right ${mono ? 'font-mono text-xs' : ''}`}
        title={typeof value === 'string' ? value : undefined}
      >
        {value ?? <span className="inline-block h-3 w-20 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />}
      </dd>
      {copyable && value && (
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${label.toLowerCase()}`}
          className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      )}
    </div>
  )
}
