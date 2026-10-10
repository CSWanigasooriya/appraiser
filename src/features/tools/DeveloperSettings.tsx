import { RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Card, CardTitle } from '../../components/ui/Card'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import { Select, type SelectOption } from '../../components/ui/Select'
import { useToast } from '../../components/ui/toast'
import { devSettings, resetDevSettings, setDevSetting, type DevSettings } from '../../lib/adb'
import { ControlRow, ToggleRow } from './ToggleRow'

const DARK: SelectOption<string>[] = [
  { value: 'auto', label: 'Follow the system' },
  { value: 'yes', label: 'Dark' },
  { value: 'no', label: 'Light' },
]

const ANIMATION: SelectOption<string>[] = [
  { value: '0', label: 'Off' },
  { value: '0.5', label: '0.5x (faster)' },
  { value: '1', label: '1x (normal)' },
  { value: '2', label: '2x' },
  { value: '5', label: '5x' },
  { value: '10', label: '10x (slowest)' },
]

const FONT: SelectOption<string>[] = [
  { value: '0.85', label: 'Small' },
  { value: '1', label: 'Default' },
  { value: '1.15', label: 'Large' },
  { value: '1.3', label: 'Largest' },
]

/** The option list, plus the current value if it isn't one of the presets. */
function withCurrent(options: SelectOption<string>[], value: number): SelectOption<string>[] {
  const v = String(value)
  return options.some((o) => o.value === v) ? options : [...options, { value: v, label: `${v}x (custom)` }]
}

export function DeveloperSettings({ serial }: { serial: string }) {
  const toast = useToast()
  const [settings, setSettings] = useState<DevSettings | null>(null)
  const [density, setDensity] = useState('')
  const [size, setSize] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    devSettings(serial)
      .then((s) => {
        setSettings(s)
        setDensity(String(s.density ?? ''))
        setSize(s.size ?? '')
      })
      .catch((e) => toast(String(e), 'error'))
  }, [serial, toast])
  useEffect(load, [load])

  /** Applies one setting, then re-reads them all so the screen shows what the phone really has. */
  const apply = async (key: string, value: string | boolean) => {
    setBusy(true)
    try {
      await setDevSetting(serial, key, typeof value === 'boolean' ? (value ? '1' : '0') : value)
      load()
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    setConfirmReset(false)
    setBusy(true)
    try {
      await resetDevSettings(serial)
      toast('Developer settings are back to normal')
      load()
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!settings) return <p className="py-6 text-center text-sm text-zinc-500">Reading settings...</p>

  return (
    <div className="grid gap-4">
      <Card>
        <CardTitle>Debugging aids</CardTitle>
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          <ToggleRow label="Show touches" hint="Draws a dot where the screen is touched" checked={settings.show_touches} disabled={busy} onChange={(v) => apply('show_touches', v)} />
          <ToggleRow label="Pointer location" hint="Shows touch coordinates along the top of the screen" checked={settings.pointer_location} disabled={busy} onChange={(v) => apply('pointer_location', v)} />
          <ToggleRow label="Layout bounds" hint="Outlines every view's edges" checked={settings.layout_bounds} disabled={busy} onChange={(v) => apply('layout_bounds', v)} />
          <ToggleRow label="Stay awake" hint="Keeps the screen on while charging" checked={settings.stay_awake} disabled={busy} onChange={(v) => apply('stay_awake', v)} />
          <ToggleRow label="Don't keep activities" hint="Destroys each screen as soon as you leave it" checked={settings.dont_keep_activities} disabled={busy} onChange={(v) => apply('dont_keep_activities', v)} />
        </div>
      </Card>

      <Card>
        <CardTitle>Display</CardTitle>
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          <ControlRow label="Dark mode">
            <Select className="w-44" aria-label="Dark mode" value={settings.dark_mode ?? 'auto'} options={DARK} onChange={(v) => apply('dark_mode', v)} />
          </ControlRow>
          <ControlRow label="Animation speed" hint="Window, transition and animator scale">
            <Select className="w-44" aria-label="Animation speed" value={String(settings.animation_scale)} options={withCurrent(ANIMATION, settings.animation_scale)} onChange={(v) => apply('animation_scale', v)} />
          </ControlRow>
          <ControlRow label="Font size">
            <Select className="w-44" aria-label="Font size" value={String(settings.font_scale)} options={withCurrent(FONT, settings.font_scale)} onChange={(v) => apply('font_scale', v)} />
          </ControlRow>
          <ControlRow label="Screen density" hint={settings.default_density ? `Default is ${settings.default_density} dpi` : undefined}>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void apply('density', density.trim())
              }}
            >
              <Input className="w-28" inputMode="numeric" value={density} onChange={(e) => setDensity(e.target.value)} placeholder="dpi" aria-label="Screen density" />
              <Button disabled={busy || !density.trim()}>Apply</Button>
              <Button type="button" disabled={busy} onClick={() => void apply('density', 'reset')}>
                Default
              </Button>
            </form>
          </ControlRow>
          <ControlRow label="Resolution" hint={settings.default_size ? `Default is ${settings.default_size}` : undefined}>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void apply('size', size.trim())
              }}
            >
              <Input className="w-36" value={size} onChange={(e) => setSize(e.target.value)} placeholder="1080x2400" aria-label="Resolution" />
              <Button disabled={busy || !size.trim()}>Apply</Button>
              <Button type="button" disabled={busy} onClick={() => void apply('size', 'reset')}>
                Default
              </Button>
            </form>
          </ControlRow>
        </div>
      </Card>

      <div>
        <Button disabled={busy} onClick={() => setConfirmReset(true)}>
          <RotateCcw size={16} /> Reset all
        </Button>
      </div>

      <Dialog open={confirmReset} onClose={() => setConfirmReset(false)} title="Reset developer settings">
        <p className="mb-5 text-sm text-zinc-600 dark:text-zinc-400">
          This turns off every overlay above and puts animation speed, font size, dark mode, density and resolution
          back to their defaults.
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => void reset()}>
            Reset all
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
