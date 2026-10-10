import { Check } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from './cn'

export interface ListboxItem {
  key: string
  label: ReactNode
  /** Small secondary text on the right. */
  hint?: ReactNode
  icon?: ReactNode
}

interface Props {
  items: ListboxItem[]
  /** Index of the highlighted item (keyboard or hover), or -1. */
  active: number
  onPick: (index: number) => void
  /** Marks the current value with a check. */
  selectedKey?: string
  /** `terminal` is the always-dark look used next to the shell. */
  variant?: 'default' | 'terminal'
  /** Which side of the (relatively positioned) parent the list opens on. */
  placement?: 'bottom' | 'top'
  /** Monospace, smaller text, for commands and package names. */
  mono?: boolean
  footer?: ReactNode
  className?: string
}

/**
 * The app's dropdown list: used by Select, Combobox and the shell's
 * autocomplete, so every dropdown looks and behaves the same. It is a plain
 * list; the owner handles keyboard input and open/close.
 */
export function Listbox({
  items,
  active,
  onPick,
  selectedKey,
  variant = 'default',
  placement = 'bottom',
  mono,
  footer,
  className,
}: Props) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const terminal = variant === 'terminal'

  useEffect(() => refs.current[active]?.scrollIntoView({ block: 'nearest' }), [active])

  return (
    <div
      className={cn(
        'absolute inset-x-0 z-20 overflow-hidden rounded-lg border shadow-lg',
        placement === 'top' ? 'bottom-full mb-1' : 'top-full mt-1',
        terminal
          ? 'border-zinc-700 bg-zinc-900 text-zinc-100'
          : 'border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900',
        className,
      )}
    >
      <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
        {items.map((item, i) => {
          const selected = item.key === selectedKey
          return (
            <li key={item.key} role="option" aria-selected={selected}>
              <button
                type="button"
                tabIndex={-1}
                ref={(el) => {
                  refs.current[i] = el
                }}
                // mouseDown, not click, so the field that owns the list keeps focus.
                onMouseDown={(e) => {
                  e.preventDefault()
                  onPick(i)
                }}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left',
                  mono ? 'font-mono text-xs' : 'text-sm',
                  i === active
                    ? terminal
                      ? 'bg-blue-500/20'
                      : 'bg-zinc-100 dark:bg-zinc-800'
                    : terminal
                      ? 'hover:bg-zinc-800'
                      : 'hover:bg-zinc-100 dark:hover:bg-zinc-800',
                  selected && !terminal && 'text-blue-600 dark:text-blue-400',
                )}
              >
                {item.icon && <span className="flex-none text-zinc-400">{item.icon}</span>}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.hint && <span className="flex-none text-[10px] text-zinc-400">{item.hint}</span>}
                {selected && <Check size={14} className="flex-none" />}
              </button>
            </li>
          )
        })}
      </ul>
      {footer && (
        <p
          className={cn(
            'border-t px-3 py-1 text-[10px] text-zinc-400',
            terminal ? 'border-zinc-800' : 'border-zinc-200 dark:border-zinc-800',
          )}
        >
          {footer}
        </p>
      )}
    </div>
  )
}
