import type { ReactNode } from 'react'
import { Switch } from '../../components/ui/Switch'

interface Props {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

/** A label with an optional explanation and an on/off switch. */
export function ToggleRow({ label, hint, checked, onChange, disabled }: Props) {
  return (
    <div className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-zinc-500">{hint}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} aria-label={label} />
    </div>
  )
}

/** A label on the left and a control on the right, for settings that aren't a switch. */
export function ControlRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1 basis-40">
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-zinc-500">{hint}</div>}
      </div>
      {children}
    </div>
  )
}
