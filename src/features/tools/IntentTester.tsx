import { History, Package, Plus, Rocket, Search, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Card, CardTitle } from '../../components/ui/Card'
import { Combobox } from '../../components/ui/Combobox'
import { Field, Input } from '../../components/ui/Input'
import { Select, type SelectOption } from '../../components/ui/Select'
import { useToast } from '../../components/ui/toast'
import { appDetail, fireIntent, listApps, type ExtraKind, type Intent, type IntentTarget } from '../../lib/adb'
import { isArrayOf, useStored } from '../../lib/useStored'

const TARGETS: SelectOption<IntentTarget>[] = [
  { value: 'activity', label: 'Open a screen or link' },
  { value: 'broadcast', label: 'Send a broadcast' },
  { value: 'service', label: 'Start a service' },
]

const EXTRA_KINDS: SelectOption<ExtraKind>[] = [
  { value: 'string', label: 'String' },
  { value: 'int', label: 'Int' },
  { value: 'long', label: 'Long' },
  { value: 'float', label: 'Float' },
  { value: 'bool', label: 'Boolean' },
  { value: 'uri', label: 'URI' },
]

const ACTIONS = [
  'android.intent.action.VIEW',
  'android.intent.action.MAIN',
  'android.intent.action.SEND',
  'android.intent.action.SENDTO',
  'android.intent.action.DIAL',
  'android.intent.action.EDIT',
  'android.intent.action.WEB_SEARCH',
  'android.intent.action.BOOT_COMPLETED',
  'android.intent.action.LOCALE_CHANGED',
  'android.intent.action.PACKAGE_REPLACED',
  'android.settings.SETTINGS',
]

/** The form's text fields; empty strings mean "not set". */
interface Form {
  target: IntentTarget
  data: string
  action: string
  component: string
  mime: string
  categories: string
  extras: { kind: ExtraKind; key: string; value: string }[]
}

const EMPTY: Form = { target: 'activity', data: '', action: '', component: '', mime: '', categories: '', extras: [] }

interface Entry {
  id: string
  at: number
  form: Form
}

const isEntry = (v: unknown): v is Entry =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as Entry).id === 'string' &&
  typeof (v as Entry).form === 'object' &&
  (v as Entry).form !== null &&
  Array.isArray((v as Entry).form.extras)

const NONE: Entry[] = []
const HISTORY_LIMIT = 30

const orNull = (s: string) => s.trim() || null

function toIntent(f: Form): Intent {
  return {
    target: f.target,
    action: orNull(f.action),
    data: orNull(f.data),
    mime: orNull(f.mime),
    component: orNull(f.component),
    package: null,
    categories: f.categories.split(/[\s,]+/).filter(Boolean),
    extras: f.extras.filter((x) => x.key.trim()),
  }
}

const summary = (f: Form) =>
  f.data.trim() || f.action.trim() || f.component.trim() || 'Empty intent'

export function IntentTester({ serial }: { serial: string }) {
  const toast = useToast()
  const [form, setForm] = useState<Form>(EMPTY)
  const [history, setHistory] = useStored<Entry[]>('intent-history', NONE, isArrayOf(isEntry))
  const [output, setOutput] = useState<{ text: string; error: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [packages, setPackages] = useState<string[]>([])
  const [lookup, setLookup] = useState('')
  const [screens, setScreens] = useState<string[]>([])

  useEffect(() => {
    listApps(serial, true)
      .then((apps) => setPackages(apps.map((a) => a.package)))
      .catch(() => {})
  }, [serial])

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }))

  const fire = async () => {
    setBusy(true)
    try {
      const text = await fireIntent(serial, toIntent(form))
      setOutput({ text: text || 'Sent.', error: false })
      setHistory((all) => {
        const rest = all.filter((e) => JSON.stringify(e.form) !== JSON.stringify(form))
        return [{ id: crypto.randomUUID(), at: Date.now(), form }, ...rest].slice(0, HISTORY_LIMIT)
      })
    } catch (e) {
      setOutput({ text: String(e), error: true })
    } finally {
      setBusy(false)
    }
  }

  const findScreens = async () => {
    try {
      const detail = await appDetail(serial, lookup.trim())
      setScreens(detail.activities)
      if (detail.activities.length === 0) toast('That app declares no screens that can be opened from outside', 'error')
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const empty = !form.data.trim() && !form.action.trim() && !form.component.trim()

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="grid gap-4">
        <Card className="grid gap-3">
          <CardTitle className="mb-0!">Intent</CardTitle>
          <Field label="What to do">
            <Select aria-label="What to do" value={form.target} options={TARGETS} onChange={(v) => set('target', v)} />
          </Field>
          <Field label="Link or data (a deep link, a web address, tel:, geo:...)">
            <Input value={form.data} onChange={(e) => set('data', e.target.value)} placeholder="myapp://product/42" spellCheck={false} />
          </Field>
          <Field label="Action">
            <Combobox value={form.action} onChange={(v) => set('action', v)} options={ACTIONS} placeholder="Defaults to VIEW when there is a link" aria-label="Action" limit={6} />
          </Field>
          <Field label="Component (package/.Class)">
            <Input value={form.component} onChange={(e) => set('component', e.target.value)} placeholder="com.example.app/.MainActivity" spellCheck={false} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="MIME type">
              <Input value={form.mime} onChange={(e) => set('mime', e.target.value)} placeholder="text/plain" spellCheck={false} />
            </Field>
            <Field label="Categories (separated by spaces)">
              <Input value={form.categories} onChange={(e) => set('categories', e.target.value)} placeholder="android.intent.category.DEFAULT" spellCheck={false} />
            </Field>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-500 dark:text-zinc-400">Extras</span>
              <Button onClick={() => set('extras', [...form.extras, { kind: 'string', key: '', value: '' }])}>
                <Plus size={15} /> Add extra
              </Button>
            </div>
            {form.extras.map((x, i) => {
              const patch = (p: Partial<typeof x>) => set('extras', form.extras.map((e, j) => (j === i ? { ...e, ...p } : e)))
              return (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Select className="w-28" aria-label="Extra type" value={x.kind} options={EXTRA_KINDS} onChange={(kind) => patch({ kind })} />
                  <Input className="w-40 flex-1" value={x.key} onChange={(e) => patch({ key: e.target.value })} placeholder="key" aria-label="Extra key" spellCheck={false} />
                  <Input className="w-40 flex-1" value={x.value} onChange={(e) => patch({ value: e.target.value })} placeholder="value" aria-label="Extra value" spellCheck={false} />
                  <Button variant="ghost" onClick={() => set('extras', form.extras.filter((_, j) => j !== i))} title="Remove">
                    <X size={15} />
                  </Button>
                </div>
              )
            })}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy || empty} onClick={() => void fire()}>
              <Rocket size={16} /> {busy ? 'Sending...' : 'Fire'}
            </Button>
            <Button onClick={() => { setForm(EMPTY); setOutput(null) }}>Clear</Button>
          </div>
          {output && (
            <pre
              className={`max-h-48 overflow-auto rounded-lg border p-3 font-mono text-xs whitespace-pre-wrap ${
                output.error ? 'border-red-500/30 bg-red-500/10' : 'border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950'
              }`}
            >
              {output.text}
            </pre>
          )}
        </Card>

        <Card className="grid gap-3">
          <CardTitle className="mb-0!">Find an app's screens</CardTitle>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void findScreens()
            }}
          >
            <Combobox value={lookup} onChange={setLookup} options={packages} placeholder="Package name" icon={<Package size={14} />} className="flex-1" aria-label="Package name" />
            <Button disabled={!lookup.trim()}>
              <Search size={16} /> Find
            </Button>
          </form>
          {screens.length > 0 && (
            <ul className="max-h-48 divide-y divide-zinc-200 overflow-auto rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {screens.map((c) => (
                <li key={c}>
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, target: 'activity', component: c }))}
                    className="w-full cursor-pointer truncate px-3 py-1.5 text-left font-mono text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    title="Use this component"
                  >
                    {c}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <CardTitle className="mb-0! flex items-center gap-2">
            <History size={15} /> History
          </CardTitle>
          {history.length > 0 && (
            <Button variant="ghost" onClick={() => setHistory([])} title="Clear history">
              <Trash2 size={14} />
            </Button>
          )}
        </div>
        {history.length === 0 ? (
          <p className="py-3 text-sm text-zinc-500">Intents you fire are kept here.</p>
        ) : (
          <ul className="max-h-[32rem] divide-y divide-zinc-200 overflow-auto dark:divide-zinc-800">
            {history.map((e) => (
              <li key={e.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setForm(e.form)}
                  className="min-w-0 flex-1 cursor-pointer py-2 text-left"
                  title="Load into the form"
                >
                  <div className="truncate text-sm">{summary(e.form)}</div>
                  <div className="text-xs text-zinc-500">
                    {TARGETS.find((t) => t.value === e.form.target)?.label} · {new Date(e.at).toLocaleTimeString()}
                  </div>
                </button>
                <Button variant="ghost" onClick={() => setHistory((all) => all.filter((x) => x.id !== e.id))} title="Remove">
                  <X size={14} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
