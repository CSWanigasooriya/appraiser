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
    <aside className="flex w-16 flex-none lg:w-72 flex-col border-r border-zinc-200 bg-zinc-100/60 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="px-2 pt-5 pb-3 max-lg:text-center lg:px-4">
        <h1 className="text-base font-semibold max-lg:text-xs">ADB GUI</h1>
        <p className="text-xs text-zinc-500 max-lg:hidden">
          {devices.length} device{devices.length === 1 ? '' : 's'}
        </p>
      </div>

      <nav className="flex-1 space-y-1.5 overflow-y-auto px-2 lg:px-3">
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
            title={d.model ?? d.serial}
            onClick={() => onSelect(d.serial)}
            className={cn(
              'flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 max-lg:justify-center max-lg:px-0 text-left transition-colors',
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
            <div className="min-w-0 flex-1 max-lg:hidden">
              <div className="truncate text-sm font-medium">{d.model ?? d.serial}</div>
              <div className="truncate text-xs text-zinc-500">{d.serial}</div>
            </div>
            <Badge tone={stateTone[d.state]} className="max-lg:hidden">{d.state}</Badge>
          </button>
        ))}
      </nav>

      <div className="p-2 lg:p-3">
        <Button variant="primary" className="w-full max-lg:px-0" onClick={onAdd} title="Add device">
          <Plus size={16} /> <span className="max-lg:sr-only">Add device</span>
        </Button>
      </div>
    </aside>
  )
}
