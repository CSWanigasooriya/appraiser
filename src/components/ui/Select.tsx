import { ChevronDown } from 'lucide-react'
import { useRef, useState, type KeyboardEvent } from 'react'
import { cn } from './cn'
import { fieldClass } from './Input'
import { Listbox } from './Listbox'
import { useDismiss } from './useDismiss'

export interface SelectOption<T extends string> {
  value: T
  label: string
}

interface Props<T extends string> {
  value: T
  onChange: (value: T) => void
  options: SelectOption<T>[]
  className?: string
  'aria-label'?: string
}

/** A dropdown that matches the app, in place of the system's native select menu. */
export function Select<T extends string>({ value, onChange, options, className, 'aria-label': ariaLabel }: Props<T>) {
  const box = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const current = options.findIndex((o) => o.value === value)

  useDismiss(box, open, () => setOpen(false))

  const openList = () => {
    setActive(Math.max(current, 0))
    setOpen(true)
  }

  const pick = (i: number) => {
    onChange(options[i].value)
    setOpen(false)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return openList()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (i + step + options.length) % options.length)
    } else if ((e.key === 'Enter' || e.key === ' ') && open) {
      e.preventDefault()
      pick(active)
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div ref={box} className={cn('relative', className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={cn(fieldClass, 'flex w-full cursor-pointer items-center justify-between gap-2 text-left')}
      >
        <span className="truncate">{options[current]?.label ?? ''}</span>
        <ChevronDown size={14} className={cn('flex-none text-zinc-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <Listbox
          items={options.map((o) => ({ key: o.value, label: o.label }))}
          active={active}
          onPick={pick}
          selectedKey={value}
          className="min-w-max"
        />
      )}
    </div>
  )
}
