import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from './cn'
import { Input } from './Input'
import { Listbox } from './Listbox'
import { useDismiss } from './useDismiss'

interface Props {
  value: string
  onChange: (value: string) => void
  /** Suggestions. The field also accepts any other text. */
  options: string[]
  placeholder?: string
  /** Icon drawn inside the left edge of the field. */
  icon?: ReactNode
  invalid?: boolean
  /** Most suggestions to show at once. */
  limit?: number
  className?: string
  'aria-label'?: string
}

/** A text field with a styled suggestion list, in place of the native `<datalist>`. */
export function Combobox({ value, onChange, options, placeholder, icon, invalid, limit = 8, className, 'aria-label': ariaLabel }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)

  useDismiss(box, open, () => setOpen(false))

  // Matches that start with the text first, then ones that merely contain it.
  const matches = useMemo(() => {
    const needle = value.trim().toLowerCase()
    const hits = needle ? options.filter((o) => o.toLowerCase().includes(needle)) : options
    if (needle) hits.sort((a, b) => Number(b.toLowerCase().startsWith(needle)) - Number(a.toLowerCase().startsWith(needle)))
    return hits.slice(0, limit)
  }, [options, value, limit])

  const showing = open && matches.length > 0 && !(matches.length === 1 && matches[0] === value)

  const pick = (i: number) => {
    onChange(matches[i])
    setOpen(false)
    setActive(-1)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!showing) return setOpen(true)
      const down = e.key === 'ArrowDown'
      const n = matches.length
      setActive((i) => (i === -1 ? (down ? 0 : n - 1) : (i + (down ? 1 : -1) + n) % n))
    } else if (showing && (e.key === 'Enter' || e.key === 'Tab') && active >= 0) {
      e.preventDefault()
      pick(active)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={box} className={cn('relative', className)}>
      {icon && <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-zinc-400">{icon}</span>}
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={showing}
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        className={cn(icon ? 'pl-8' : undefined, invalid && 'border-red-500')}
      />
      {showing && <Listbox items={matches.map((m) => ({ key: m, label: m }))} active={active} onPick={pick} mono />}
    </div>
  )
}
