import { cn } from './cn'

interface Props {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  'aria-label': string
}

/** An on/off toggle. */
export function Switch({ checked, onChange, disabled, 'aria-label': label }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 flex-none cursor-pointer items-center rounded-full transition-colors disabled:pointer-events-none disabled:opacity-50',
        checked ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-700',
      )}
    >
      <span
        className={cn(
          'inline-block size-4 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}
