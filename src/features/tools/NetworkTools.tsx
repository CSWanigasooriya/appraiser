import { ArrowLeftRight, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card, CardTitle } from '../../components/ui/Card'
import { Field, Input } from '../../components/ui/Input'
import { Select, type SelectOption } from '../../components/ui/Select'
import { useToast } from '../../components/ui/toast'
import {
  addForward,
  listForwards,
  networkState,
  removeForward,
  setAirplane,
  setMobileData,
  setProxy,
  setWifi,
  type Forward,
  type NetworkState,
} from '../../lib/adb'
import { ControlRow, ToggleRow } from './ToggleRow'

type Direction = 'forward' | 'reverse'

const DIRECTIONS: SelectOption<Direction>[] = [
  { value: 'forward', label: 'Computer to phone' },
  { value: 'reverse', label: 'Phone to computer' },
]

/** `8080` becomes `tcp:8080`; anything else (`localabstract:...`) is used as typed. */
const address = (v: string) => (/^\d+$/.test(v.trim()) ? `tcp:${v.trim()}` : v.trim())

export function NetworkTools({ serial }: { serial: string }) {
  const toast = useToast()
  const [state, setState] = useState<NetworkState | null>(null)
  const [forwards, setForwards] = useState<Forward[]>([])
  const [proxy, setProxyText] = useState('')
  const [direction, setDirection] = useState<Direction>('forward')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    networkState(serial)
      .then((s) => {
        setState(s)
        setProxyText(s.proxy ?? '')
      })
      .catch((e) => toast(String(e), 'error'))
    listForwards(serial)
      .then(setForwards)
      .catch((e) => toast(String(e), 'error'))
  }, [serial, toast])
  useEffect(load, [load])

  const run = async (action: () => Promise<void>, message?: string) => {
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

  const reverse = direction === 'reverse'

  return (
    <div className="grid gap-4">
      <Card>
        <CardTitle>Connections</CardTitle>
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          <ToggleRow label="Wi-Fi" checked={state?.wifi ?? false} disabled={busy || state?.wifi == null} onChange={(on) => run(() => setWifi(serial, on))} />
          <ToggleRow label="Mobile data" hint={state?.mobile_data == null ? 'Not reported by this phone' : undefined} checked={state?.mobile_data ?? false} disabled={busy || state?.mobile_data == null} onChange={(on) => run(() => setMobileData(serial, on))} />
          <ToggleRow label="Airplane mode" hint="Turning it on may drop a wireless adb connection" checked={state?.airplane ?? false} disabled={busy || state?.airplane == null} onChange={(on) => run(() => setAirplane(serial, on))} />
        </div>
      </Card>

      <Card>
        <CardTitle>HTTP proxy</CardTitle>
        <ControlRow label="Global proxy" hint={state?.proxy ? `Currently ${state.proxy}` : 'No proxy is set'}>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void run(() => setProxy(serial, proxy.trim()), 'Proxy set')
            }}
          >
            <Input className="w-56" value={proxy} onChange={(e) => setProxyText(e.target.value)} placeholder="192.168.1.10:8888" aria-label="Proxy host and port" />
            <Button disabled={busy || !proxy.trim()}>Set</Button>
            <Button type="button" disabled={busy || !state?.proxy} onClick={() => void run(() => setProxy(serial, null), 'Proxy cleared')}>
              Clear
            </Button>
          </form>
        </ControlRow>
      </Card>

      <Card>
        <CardTitle>Port forwarding</CardTitle>
        {forwards.length === 0 ? (
          <p className="pb-3 text-sm text-zinc-500">No ports are forwarded for this phone.</p>
        ) : (
          <ul className="mb-4 divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {forwards.map((f) => (
              <li key={`${f.reverse}-${f.from}`} className="flex items-center gap-3 px-3 py-2">
                <Badge tone={f.reverse ? 'amber' : 'blue'}>{f.reverse ? 'Phone to computer' : 'Computer to phone'}</Badge>
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {f.from} <ArrowLeftRight size={11} className="mx-1 inline text-zinc-400" /> {f.to}
                </span>
                <Button variant="ghost" disabled={busy} onClick={() => void run(() => removeForward(serial, f.reverse, f.from))} title="Remove">
                  <Trash2 size={15} />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="grid gap-3 sm:grid-cols-[12rem_1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              await addForward(serial, reverse, address(from), address(to))
              setFrom('')
              setTo('')
            }, 'Port forwarded')
          }}
        >
          <Field label="Direction">
            <Select aria-label="Direction" value={direction} options={DIRECTIONS} onChange={setDirection} />
          </Field>
          <Field label={reverse ? 'Phone port' : 'Computer port'}>
            <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="8080 or tcp:8080" />
          </Field>
          <Field label={reverse ? 'Computer port' : 'Phone port'}>
            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="8080 or tcp:8080" />
          </Field>
          <Button variant="primary" disabled={busy || !from.trim() || !to.trim()}>
            <Plus size={16} /> Add
          </Button>
        </form>
        <p className="mt-3 text-xs text-zinc-500">
          {reverse
            ? 'The phone can reach a server on this computer by connecting to its own localhost port.'
            : 'This computer can reach a server on the phone by connecting to its own localhost port.'}
        </p>
      </Card>
    </div>
  )
}
