import { Plus, Smartphone, Wifi } from 'lucide-react'
import { isWireless, type Device, type DeviceState } from '../../lib/adb'
import { Badge, type Tone } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { cn } from '../../components/ui/cn'

const stateTone: Record<DeviceState, Tone> = {
  online: 'green',
  unauthorized: 'amber',
  offline: 'red',
  other: 'zinc',
}

interface Props {
  devices: Device[]
  error: string | null
  selected: string | null
  onSelect: (serial: string) => void
  onAdd: () => void
}

export function Sidebar({ devices, error, selected, onSelect, onAdd }: Props) {
  return (
    <aside className="flex w-72 flex-none flex-col border-r border-zinc-200 bg-zinc-100/60 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="px-4 pt-5 pb-3">
        <h1 className="text-base font-semibold">ADB GUI</h1>
        <p className="text-xs text-zinc-500">
          {devices.length} device{devices.length === 1 ? '' : 's'}
        </p>
      </div>

      <nav className="flex-1 space-y-1.5 overflow-y-auto px-3">
        {error && (
          <p className="rounded-lg bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {!error && devices.length === 0 && (
          <p className="px-1 py-2 text-sm text-zinc-500">No devices connected.</p>
        )}
        {devices.map((d) => (
          <button
            key={d.serial}
            onClick={() => onSelect(d.serial)}
            className={cn(
              'flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
              d.serial === selected
                ? 'bg-white shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-800 dark:ring-zinc-700'
                : 'hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60',
            )}
          >
            {isWireless(d.serial) ? (
              <Wifi size={18} className="flex-none text-zinc-500" />
            ) : (
              <Smartphone size={18} className="flex-none text-zinc-500" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{d.model ?? d.serial}</div>
              <div className="truncate text-xs text-zinc-500">{d.serial}</div>
            </div>
            <Badge tone={stateTone[d.state]}>{d.state}</Badge>
          </button>
        ))}
      </nav>

      <div className="p-3">
        <Button variant="primary" className="w-full" onClick={onAdd}>
          <Plus size={16} /> Add device
        </Button>
      </div>
    </aside>
  )
}
