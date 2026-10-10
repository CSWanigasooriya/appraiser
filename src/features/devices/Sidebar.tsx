import { Layers, Plus, Smartphone, Wifi } from 'lucide-react'
import { isWireless, type Device, type DeviceState } from '../../lib/adb'
import { Badge, type Tone } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { cn } from '../../components/ui/cn'
import { useResizable } from '../../components/ui/useResizable'
import { FLEET_ID } from '../fleet/id'

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

/** Below this width the sidebar shows icons only. */
const COMPACT_BELOW = 160

export function Sidebar({ devices, error, selected, onSelect, onAdd }: Props) {
  const { width, dragging, handleProps } = useResizable({
    storageKey: 'sidebar-width',
    initial: 288,
    min: 64,
    max: 480,
  })
  const compact = width < COMPACT_BELOW

  return (
    <aside
      style={{ width }}
      className={cn(
        'relative flex flex-none flex-col border-r border-zinc-200 bg-zinc-100/60 dark:border-zinc-800 dark:bg-zinc-900/40',
        dragging && 'select-none',
      )}
    >
      <div className={cn('pt-5 pb-3', compact ? 'px-2 text-center' : 'px-4')}>
        {compact ? (
          <div
            title="Appraiser"
            className="mx-auto grid size-9 place-items-center rounded-lg bg-emerald-500/10 text-base font-semibold text-emerald-500"
          >
            A
          </div>
        ) : (
          <>
            <h1 className="truncate text-base font-semibold">Appraiser</h1>
            <p className="text-xs text-zinc-500">
              {devices.length} device{devices.length === 1 ? '' : 's'}
            </p>
          </>
        )}
      </div>

      <nav className={cn('flex-1 space-y-1.5 overflow-y-auto', compact ? 'px-2' : 'px-3')}>
        {error && !compact && (
          <p className="rounded-lg bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {!error && devices.length === 0 && !compact && (
          <p className="px-1 py-2 text-sm text-zinc-500">No devices connected.</p>
        )}
        {devices.length > 1 && (
          <button
            title="Run on all devices"
            onClick={() => onSelect(FLEET_ID)}
            className={cn(
              'flex w-full cursor-pointer items-center gap-3 rounded-lg py-2.5 text-left transition-colors',
              compact ? 'justify-center px-0' : 'px-3',
              selected === FLEET_ID
                ? 'bg-white shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-800 dark:ring-zinc-700'
                : 'hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60',
            )}
          >
            <Layers size={18} className="flex-none text-zinc-500" />
            {!compact && <span className="truncate text-sm font-medium">All devices</span>}
          </button>
        )}
        {devices.map((d) => (
          <button
            key={d.serial}
            title={d.model ?? d.serial}
            onClick={() => onSelect(d.serial)}
            className={cn(
              'flex w-full cursor-pointer items-center gap-3 rounded-lg py-2.5 text-left transition-colors',
              compact ? 'justify-center px-0' : 'px-3',
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
            {!compact && (
              <>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{d.model ?? d.serial}</div>
                  <div className="truncate text-xs text-zinc-500">{d.serial}</div>
                </div>
                <Badge tone={stateTone[d.state]}>{d.state}</Badge>
              </>
            )}
          </button>
        ))}
      </nav>

      <div className={compact ? 'p-2' : 'p-3'}>
        <Button variant="primary" className={cn('w-full', compact && 'px-0')} onClick={onAdd} title="Add device">
          <Plus size={16} />
          {!compact && 'Add device'}
        </Button>
      </div>

      <div
        {...handleProps}
        title="Drag to resize, double-click to reset"
        className={cn(
          'absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize outline-none transition-colors hover:bg-blue-500/30 focus-visible:bg-blue-500/40',
          dragging && 'bg-blue-500/40',
        )}
      />
    </aside>
  )
}
