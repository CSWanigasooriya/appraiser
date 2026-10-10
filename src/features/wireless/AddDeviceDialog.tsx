import { Link, QrCode, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { connectDevice, pairDevice } from '../../lib/adb'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Field, Input } from '../../components/ui/Input'
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
        {tab === 'qr' && <QrPairing onDone={onClose} />}
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
          <AddrForm
            fields={[{ label: 'IP address and port', placeholder: '192.168.1.42:5555' }]}
            submitLabel="Connect"
            action={([addr]) => connectDevice(addr)}
            onDone={onClose}
          />
        )}
      </div>
    </Dialog>
  )
}
