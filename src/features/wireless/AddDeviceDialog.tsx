import { Link, QrCode, KeyRound, Trash2, Wifi } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  connectDevice,
  forgetDevice,
  pairDevice,
  savedDevices,
  setAutoReconnect,
  type SavedDevices,
} from '../../lib/adb'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Field, Input } from '../../components/ui/Input'
import { Switch } from '../../components/ui/Switch'
import { Tabs } from '../../components/ui/Tabs'
import { useToast } from '../../components/ui/toast'
import { QrPairing } from './QrPairing'

type Tab = 'qr' | 'pair' | 'ip'

/** A small form that runs one async action and reports via toast. */
function AddrForm({
  fields,
  submitLabel,
  action,
  onDone,
}: {
  fields: { label: string; placeholder: string }[]
  submitLabel: string
  action: (values: string[]) => Promise<string>
  onDone: () => void
}) {
  const toast = useToast()
  const [values, setValues] = useState(fields.map(() => ''))
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      toast(await action(values))
      onDone()
    } catch (err) {
      toast(String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      {fields.map((f, i) => (
        <Field key={f.label} label={f.label}>
          <Input
            value={values[i]}
            placeholder={f.placeholder}
            onChange={(e) => setValues(values.map((v, j) => (j === i ? e.target.value : v)))}
          />
        </Field>
      ))}
      <Button variant="primary" disabled={busy || values.some((v) => !v.trim())}>
        {busy ? 'Working...' : submitLabel}
      </Button>
    </form>
  )
}

/** Wireless devices the app brings back by itself when they return to the network. */
function SavedList() {
  const toast = useToast()
  const [saved, setSaved] = useState<SavedDevices | null>(null)

  const load = useCallback(() => {
    savedDevices()
      .then(setSaved)
      .catch(() => {})
  }, [])
  useEffect(load, [load])

  if (!saved || saved.devices.length === 0) return null

  const toggle = async (on: boolean) => {
    setSaved({ ...saved, auto_reconnect: on })
    try {
      await setAutoReconnect(on)
    } catch (e) {
      toast(String(e), 'error')
      load()
    }
  }

  return (
    <section className="grid gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <div className="flex items-center gap-3">
        <h3 className="flex-1 text-sm font-semibold text-zinc-500 dark:text-zinc-400">Remembered devices</h3>
        <span className="text-sm text-zinc-500">Reconnect automatically</span>
        <Switch checked={saved.auto_reconnect} onChange={(on) => void toggle(on)} aria-label="Reconnect automatically" />
      </div>
      <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {saved.devices.map((d) => (
          <li key={d.addr} className="flex items-center gap-3 px-3 py-2">
            <Wifi size={15} className="flex-none text-zinc-400" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{d.name ?? d.addr}</div>
              {d.name && <div className="truncate font-mono text-xs text-zinc-500">{d.addr}</div>}
            </div>
            <Button
              variant="ghost"
              title="Forget this device"
              onClick={() =>
                void forgetDevice(d.addr)
                  .then(load)
                  .catch((e) => toast(String(e), 'error'))
              }
            >
              <Trash2 size={15} />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function AddDeviceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('qr')

  return (
    <Dialog open={open} onClose={onClose} title="Add device">
      <div className="grid gap-4">
        <p className="text-sm text-zinc-500">
          USB devices appear automatically. To go wireless, connect by USB once and use "Switch to
          wireless", or pair below.
        </p>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'qr', label: 'QR code', icon: <QrCode size={16} /> },
            { id: 'pair', label: 'Pair code', icon: <KeyRound size={16} /> },
            { id: 'ip', label: 'IP address', icon: <Link size={16} /> },
          ]}
        />
        {tab === 'qr' && <QrPairing onDone={onClose} onNeedsConnect={() => setTab('ip')} />}
        {tab === 'pair' && (
          <>
            <p className="text-sm text-zinc-500">
              Wireless debugging, Pair device with pairing code. Then connect using the IP address
              tab with the main address shown on that screen.
            </p>
            <AddrForm
              fields={[
                { label: 'Pairing address', placeholder: '192.168.1.42:37123' },
                { label: 'Pairing code', placeholder: '123456' },
              ]}
              submitLabel="Pair"
              action={([addr, code]) => pairDevice(addr, code)}
              onDone={() => setTab('ip')}
            />
          </>
        )}
        {tab === 'ip' && (
          <>
            <p className="text-sm text-zinc-500">
              Use the IP address and port on the phone's main Wireless debugging screen.
              This is different from the pairing address.
            </p>
            <AddrForm
              fields={[{ label: 'IP address and port', placeholder: '192.168.1.42:41839' }]}
              submitLabel="Connect"
              action={([addr]) => connectDevice(addr)}
              onDone={onClose}
            />
          </>
        )}
        <SavedList />
      </div>
    </Dialog>
  )
}
