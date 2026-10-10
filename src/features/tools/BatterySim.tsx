import { BatteryCharging, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Card, CardTitle } from '../../components/ui/Card'
import { InfoRow } from '../../components/ui/InfoRow'
import { Input } from '../../components/ui/Input'
import { Select, type SelectOption } from '../../components/ui/Select'
import { useToast } from '../../components/ui/toast'
import { batteryState, resetBattery, setBattery, type Battery } from '../../lib/adb'
import { ControlRow } from './ToggleRow'

const STATUS: Record<number, string> = { 1: 'Unknown', 2: 'Charging', 3: 'Discharging', 4: 'Not charging', 5: 'Full' }
const STATUS_OPTIONS: SelectOption<string>[] = [2, 3, 4, 5].map((n) => ({ value: String(n), label: STATUS[n] }))

const SOURCES: SelectOption<string>[] = [
  { value: 'none', label: 'Unplugged' },
  { value: 'ac', label: 'AC charger' },
  { value: 'usb', label: 'USB' },
]

const PRESETS: { label: string; level: string; plugged: string; status: string }[] = [
  { label: 'Low (15%)', level: '15', plugged: 'none', status: '3' },
  { label: 'Critical (4%)', level: '4', plugged: 'none', status: '3' },
  { label: 'Charging (50%)', level: '50', plugged: 'ac', status: '2' },
  { label: 'Full (100%)', level: '100', plugged: 'ac', status: '5' },
]

const source = (b: Battery) => (b.ac ? 'ac' : b.usb || b.wireless ? 'usb' : 'none')

/** Fakes the battery readings Android reports, to test how an app behaves when power is low. */
export function BatterySim({ serial }: { serial: string }) {
  const toast = useToast()
  const [battery, setBatteryState] = useState<Battery | null>(null)
  const [level, setLevel] = useState(50)
  const [temp, setTemp] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    batteryState(serial)
      .then((b) => {
        setBatteryState(b)
        if (b.level != null) setLevel(b.level)
      })
      .catch((e) => toast(String(e), 'error'))
  }, [serial, toast])
  useEffect(load, [load])

  const run = async (action: () => Promise<unknown>, message?: string) => {
    setBusy(true)
    try {
      await action()
      if (message) toast(message)
      load()
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!battery) return <p className="py-6 text-center text-sm text-zinc-500">Reading battery...</p>

  return (
    <div className="grid gap-4">
      <Card className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
            <BatteryCharging size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold">Battery</h3>
            <p className="text-xs text-zinc-500">What Android reports right now. Changes below are fake until reset.</p>
          </div>
          <Button disabled={busy} onClick={() => void run(() => resetBattery(serial), 'Showing the real battery again')}>
            <RotateCcw size={16} /> Reset
          </Button>
        </div>
        <dl className="grid gap-x-8 text-sm sm:grid-cols-2 [&>div]:border-b [&>div]:border-zinc-100 dark:[&>div]:border-zinc-800">
          <InfoRow plain label="Level" value={battery.level != null ? `${battery.level}%` : '-'} />
          <InfoRow plain label="Status" value={STATUS[battery.status ?? 1] ?? '-'} />
          <InfoRow plain label="Power source" value={SOURCES.find((o) => o.value === source(battery))?.label ?? '-'} />
          <InfoRow plain label="Temperature" value={battery.temperature != null ? `${battery.temperature.toFixed(1)} °C` : '-'} />
          <InfoRow plain label="Voltage" value={battery.voltage_mv != null ? `${battery.voltage_mv} mV` : '-'} />
        </dl>
      </Card>

      <Card>
        <CardTitle>Presets</CardTitle>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await setBattery(serial, 'plugged', p.plugged)
                  await setBattery(serial, 'status', p.status)
                  await setBattery(serial, 'level', p.level)
                }, `Pretending: ${p.label.toLowerCase()}`)
              }
            >
              {p.label}
            </Button>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle>Custom</CardTitle>
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          <ControlRow label="Level" hint={`${level}%`}>
            <input
              type="range"
              min={0}
              max={100}
              value={level}
              aria-label="Battery level"
              onChange={(e) => setLevel(Number(e.target.value))}
              onPointerUp={() => void run(() => setBattery(serial, 'level', String(level)))}
              onKeyUp={() => void run(() => setBattery(serial, 'level', String(level)))}
              className="w-56 accent-blue-600"
            />
          </ControlRow>
          <ControlRow label="Power source">
            <Select className="w-44" aria-label="Power source" value={source(battery)} options={SOURCES} onChange={(v) => void run(() => setBattery(serial, 'plugged', v))} />
          </ControlRow>
          <ControlRow label="Status">
            <Select className="w-44" aria-label="Battery status" value={String(battery.status ?? 3)} options={STATUS_OPTIONS} onChange={(v) => void run(() => setBattery(serial, 'status', v))} />
          </ControlRow>
          <ControlRow label="Temperature" hint="Degrees Celsius">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void run(() => setBattery(serial, 'temp', temp.trim()))
              }}
            >
              <Input className="w-28" inputMode="decimal" value={temp} onChange={(e) => setTemp(e.target.value)} placeholder="45" aria-label="Temperature" />
              <Button disabled={busy || !temp.trim()}>Apply</Button>
            </form>
          </ControlRow>
        </div>
      </Card>
    </div>
  )
}
