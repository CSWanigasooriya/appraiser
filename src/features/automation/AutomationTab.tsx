import { ChevronDown, ChevronRight, Clapperboard, Copy, Play, Plus, Square, Terminal as TerminalIcon, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card, CardTitle } from '../../components/ui/Card'
import { Field, Input } from '../../components/ui/Input'
import { Select, type SelectOption } from '../../components/ui/Select'
import { Tooltip } from '../../components/ui/Tooltip'
import { useToast } from '../../components/ui/toast'
import { runMacro, runShell, stopMacro, type MacroStep } from '../../lib/adb'
import { HighlightedCommand, HighlightedOutput } from '../devices/highlight'
import { describeStep, newId, useMacros, useSnippets, type Macro } from './store'

type NewStep = 'wait' | 'shell' | 'text'
const NEW_STEPS: SelectOption<NewStep>[] = [
  { value: 'wait', label: 'Wait (ms)' },
  { value: 'shell', label: 'Shell command' },
  { value: 'text', label: 'Type text' },
]

const seconds = (steps: MacroStep[]) =>
  steps.reduce((t, s) => t + (s.kind === 'wait' ? s.ms : s.kind === 'swipe' ? s.duration_ms : 0), 0) / 1000

/** Saved shell commands and recorded tap-and-swipe macros. */
export function AutomationTab({ serial }: { serial: string }) {
  return (
    <div className="grid gap-4">
      <Snippets serial={serial} />
      <Macros serial={serial} />
    </div>
  )
}

function Snippets({ serial }: { serial: string }) {
  const toast = useToast()
  const [snippets, setSnippets] = useSnippets()
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [running, setRunning] = useState<string | null>(null)
  const [result, setResult] = useState<{ id: string; command: string; output: string } | null>(null)

  const run = async (id: string, cmd: string) => {
    setRunning(id)
    let output: string
    try {
      output = await runShell(serial, cmd)
    } catch (e) {
      output = String(e)
    }
    setResult({ id, command: cmd, output })
    setRunning(null)
  }

  const add = () => {
    const cmd = command.trim()
    if (!cmd) return
    setSnippets((all) => [...all, { id: newId(), name: name.trim() || cmd, command: cmd }])
    setName('')
    setCommand('')
  }

  return (
    <Card className="grid gap-3">
      <CardTitle className="mb-0!">Saved commands</CardTitle>
      {snippets.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Save shell commands you run often. You can also save one from the Shell tab with its bookmark button.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {snippets.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2">
              <TerminalIcon size={15} className="flex-none text-zinc-400" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{s.name}</div>
                {s.name !== s.command && <div className="truncate font-mono text-xs text-zinc-500">{s.command}</div>}
              </div>
              <Tooltip label="Run">
                <Button variant="ghost" disabled={running !== null} onClick={() => void run(s.id, s.command)}>
                  <Play size={15} />
                </Button>
              </Tooltip>
              <Tooltip label="Copy command">
                <Button
                  variant="ghost"
                  onClick={() =>
                    void navigator.clipboard.writeText(s.command).then(
                      () => toast('Copied'),
                      () => toast('Could not copy', 'error'),
                    )
                  }
                >
                  <Copy size={15} />
                </Button>
              </Tooltip>
              <Tooltip label="Delete">
                <Button variant="ghost" onClick={() => setSnippets((all) => all.filter((x) => x.id !== s.id))}>
                  <Trash2 size={15} />
                </Button>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}

      {result && (
        <div className="max-h-64 overflow-auto rounded-xl bg-zinc-950 p-4 font-mono text-xs text-zinc-200">
          <div>
            <span className="text-emerald-400">$ </span>
            <HighlightedCommand command={result.command} />
          </div>
          <HighlightedOutput text={result.output} />
        </div>
      )}

      <form
        className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Command">
          <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="dumpsys battery" spellCheck={false} className="font-mono" />
        </Field>
        <Button variant="primary" disabled={!command.trim()}>
          <Plus size={16} /> Save
        </Button>
      </form>
    </Card>
  )
}

function Macros({ serial }: { serial: string }) {
  const toast = useToast()
  const [macros, setMacros] = useMacros()
  const [playing, setPlaying] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [repeat, setRepeat] = useState('1')

  const play = async (macro: Macro) => {
    const times = Math.min(Math.max(Math.round(Number(repeat)) || 1, 1), 99)
    const steps: MacroStep[] = []
    for (let i = 0; i < times; i++) {
      if (i > 0) steps.push({ kind: 'wait', ms: 500 })
      steps.push(...macro.steps)
    }
    setPlaying(macro.id)
    try {
      await runMacro(serial, steps, macro.landscape)
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setPlaying(null)
    }
  }

  const edit = (id: string, change: (m: Macro) => Macro) =>
    setMacros((all) => all.map((m) => (m.id === id ? change(m) : m)))

  return (
    <Card className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="mb-0!">Macros</CardTitle>
        <label className="flex items-center gap-2 text-sm text-zinc-500">
          Repeat
          <Input className="w-16" inputMode="numeric" value={repeat} onChange={(e) => setRepeat(e.target.value)} aria-label="Times to repeat" />
        </label>
      </div>
      {macros.length === 0 ? (
        <div className="flex items-start gap-3 text-sm text-zinc-500">
          <Clapperboard size={18} className="mt-0.5 flex-none" />
          <p>
            Record one from the Mirror tab: start mirroring, press Record macro, then tap, swipe and type on the screen.
            Positions are saved relative to the screen, so a macro also works on a phone with a different resolution.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {macros.map((m) => {
            const expanded = open === m.id
            return (
              <li key={m.id}>
                <div className="flex items-center gap-3 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : m.id)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                    aria-expanded={expanded}
                  >
                    {expanded ? <ChevronDown size={15} className="flex-none text-zinc-400" /> : <ChevronRight size={15} className="flex-none text-zinc-400" />}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{m.name}</div>
                      <div className="text-xs text-zinc-500">
                        {m.steps.length} steps · about {Math.max(1, Math.round(seconds(m.steps)))} s
                      </div>
                    </div>
                  </button>
                  {m.landscape && <Badge tone="blue">landscape</Badge>}
                  {playing === m.id ? (
                    <Button onClick={() => void stopMacro(serial)}>
                      <Square size={14} /> Stop
                    </Button>
                  ) : (
                    <Button variant="primary" disabled={playing !== null || m.steps.length === 0} onClick={() => void play(m)}>
                      <Play size={15} /> Play
                    </Button>
                  )}
                  <Tooltip label="Delete">
                    <Button variant="ghost" disabled={playing === m.id} onClick={() => setMacros((all) => all.filter((x) => x.id !== m.id))}>
                      <Trash2 size={15} />
                    </Button>
                  </Tooltip>
                </div>
                {expanded && (
                  <MacroSteps
                    macro={m}
                    onRename={(name) => edit(m.id, (x) => ({ ...x, name }))}
                    onSteps={(steps) => edit(m.id, (x) => ({ ...x, steps }))}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function MacroSteps({ macro, onRename, onSteps }: { macro: Macro; onRename: (name: string) => void; onSteps: (steps: MacroStep[]) => void }) {
  const [kind, setKind] = useState<NewStep>('wait')
  const [value, setValue] = useState('')

  const add = () => {
    const v = value.trim()
    if (!v) return
    let step: MacroStep
    if (kind === 'wait') step = { kind: 'wait', ms: Math.min(Math.max(Number(v) || 0, 0), 60_000) }
    else if (kind === 'shell') step = { kind: 'shell', command: v }
    else step = { kind: 'text', text: v }
    onSteps([...macro.steps, step])
    setValue('')
  }

  return (
    <div className="grid gap-3 border-t border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950/40">
      <Field label="Name">
        <Input value={macro.name} onChange={(e) => onRename(e.target.value)} />
      </Field>
      <ol className="max-h-64 overflow-auto rounded-lg border border-zinc-200 bg-white text-sm dark:border-zinc-800 dark:bg-zinc-900">
        {macro.steps.map((s, i) => (
          <li key={i} className="flex items-center gap-2 border-b border-zinc-100 px-3 py-1 last:border-b-0 dark:border-zinc-800">
            <span className="w-8 flex-none text-xs text-zinc-400">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">{describeStep(s)}</span>
            <Button variant="ghost" className="px-1.5" onClick={() => onSteps(macro.steps.filter((_, j) => j !== i))} title="Remove step">
              <X size={14} />
            </Button>
          </li>
        ))}
        {macro.steps.length === 0 && <li className="px-3 py-2 text-zinc-500">No steps.</li>}
      </ol>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <Select className="w-44" aria-label="Step type" value={kind} options={NEW_STEPS} onChange={setKind} />
        <Input className="w-48 flex-1" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === 'wait' ? '1000' : kind === 'shell' ? 'am start ...' : 'text to type'} aria-label="Step value" spellCheck={false} />
        <Button disabled={!value.trim()}>
          <Plus size={16} /> Add step
        </Button>
      </form>
    </div>
  )
}
