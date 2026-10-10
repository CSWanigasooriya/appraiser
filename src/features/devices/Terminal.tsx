import { Bookmark, History, Package, Terminal as TerminalIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { listApps, runShell } from '../../lib/adb'
import { Listbox } from '../../components/ui/Listbox'
import { HighlightedCommand, HighlightedOutput } from './highlight'
import { suggest, wantsPackages, type Suggestion, type SuggestionKind } from './completions'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/toast'
import { newId, useSnippets } from '../automation/store'

interface Entry {
  command: string
  output: string
}

const HISTORY_KEY = 'shell-history'
const HISTORY_LIMIT = 200

const kindIcon: Record<SuggestionKind, typeof History> = {
  history: History,
  command: TerminalIcon,
  package: Package,
}

function loadHistory(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    return Array.isArray(saved) ? saved.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function saveHistory(history: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
  } catch {
    // history is a convenience; ignore storage failures
  }
}

export function Terminal({ serial }: { serial: string }) {
  const toast = useToast()
  const [snippets, setSnippets] = useSnippets()
  const [command, setCommand] = useState('')
  const [history, setHistory] = useState<Entry[]>([])
  const [running, setRunning] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  // Commands run before, most recent first, for suggestions and Up/Down recall.
  const [recent, setRecent] = useState<string[]>(loadHistory)
  const [packages, setPackages] = useState<string[]>([])
  const packagesRequested = useRef(false)
  const [active, setActive] = useState(-1)
  const [dismissed, setDismissed] = useState(false)
  const recallIndex = useRef(-1)

  const suggestions = useMemo(() => suggest(command, { history: recent, packages }), [command, recent, packages])
  const open = suggestions.length > 0 && !dismissed

  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [history])

  // Package names are only fetched once a command actually asks for one.
  useEffect(() => {
    if (packagesRequested.current || !wantsPackages(command)) return
    packagesRequested.current = true
    listApps(serial, true)
      .then((apps) => setPackages(apps.map((a) => a.package)))
      .catch(() => {
        packagesRequested.current = false
      })
  }, [command, serial])

  const edit = (value: string) => {
    setCommand(value)
    setActive(-1)
    setDismissed(false)
    recallIndex.current = -1
  }

  const syncScroll = () => setScrollLeft(inputRef.current?.scrollLeft ?? 0)

  const accept = (s: Suggestion) => {
    setCommand(s.text)
    setActive(-1)
    setDismissed(false)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const down = e.key === 'ArrowDown'
        const n = suggestions.length
        // From "nothing highlighted", Down picks the first item and Up the last; otherwise wrap around.
        setActive((i) => (i === -1 ? (down ? 0 : n - 1) : (i + (down ? 1 : -1) + n) % n))
      } else if (e.key === 'Tab') {
        e.preventDefault()
        accept(suggestions[Math.max(active, 0)])
      } else if (e.key === 'Enter' && active >= 0) {
        e.preventDefault()
        accept(suggestions[active])
      } else if (e.key === 'Escape') {
        setDismissed(true)
      }
      return
    }
    // Like a normal shell: Up/Down walk through earlier commands.
    if (e.key === 'ArrowUp' && recent.length > 0) {
      e.preventDefault()
      recallIndex.current = Math.min(recallIndex.current + 1, recent.length - 1)
      setCommand(recent[recallIndex.current])
      setDismissed(true)
    } else if (e.key === 'ArrowDown' && recallIndex.current >= 0) {
      e.preventDefault()
      recallIndex.current -= 1
      setCommand(recallIndex.current >= 0 ? recent[recallIndex.current] : '')
      setDismissed(true)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cmd = command.trim()
    if (!cmd || running) return
    edit('')
    const next = [cmd, ...recent.filter((c) => c !== cmd)].slice(0, HISTORY_LIMIT)
    setRecent(next)
    saveHistory(next)
    setRunning(true)
    let output: string
    try {
      output = await runShell(serial, cmd)
    } catch (err) {
      output = String(err)
    }
    setHistory((h) => [...h, { command: cmd, output }])
    setRunning(false)
  }

  return (
    <div className="flex min-h-64 flex-1 flex-col gap-3">
      <div className="min-h-0 flex-1 overflow-auto rounded-xl bg-zinc-950 p-4 font-mono text-xs text-zinc-200">
        {history.length === 0 && (
          <p className="text-zinc-500">Run a command on the device, e.g. pm list packages</p>
        )}
        {history.map((h, i) => (
          <div key={i} className="mb-3">
            <div>
              <span className="text-emerald-400">$ </span>
              <HighlightedCommand command={h.command} />
            </div>
            <HighlightedOutput text={h.output} />
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form onSubmit={submit} className="flex gap-2">
        <div className="relative flex-1">
          {open && (
            <Listbox
              variant="terminal"
              placement="top"
              mono
              active={active}
              onPick={(i) => accept(suggestions[i])}
              items={suggestions.map((s) => {
                const Icon = kindIcon[s.kind]
                return { key: s.text, label: s.label, hint: s.kind, icon: <Icon size={13} /> }
              })}
              footer="Tab to accept · ↑↓ to choose · Esc to close"
            />
          )}
          <div className="relative rounded-lg border border-zinc-700 bg-zinc-950 text-sm focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/30">
            {/* Colours are drawn here, behind a transparent input that keeps the caret, selection and typing. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden px-3 py-1.5 font-mono whitespace-pre text-zinc-100"
            >
              <span className="inline-block" style={{ transform: `translateX(${-scrollLeft}px)` }}>
                <HighlightedCommand command={command} />
              </span>
            </div>
            <input
              ref={inputRef}
              value={command}
              onChange={(e) => {
                edit(e.target.value)
                requestAnimationFrame(syncScroll)
              }}
              onKeyDown={onKeyDown}
              onKeyUp={syncScroll}
              onClick={syncScroll}
              onScroll={syncScroll}
              placeholder="Enter a shell command"
              className="relative w-full bg-transparent px-3 py-1.5 font-mono text-transparent caret-zinc-100 outline-none selection:bg-blue-500/40 placeholder:text-zinc-500"
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              role="combobox"
              aria-expanded={open}
              aria-autocomplete="list"
            />
          </div>
        </div>
        <Button
          type="button"
          disabled={!command.trim() || snippets.some((s) => s.command === command.trim())}
          onClick={() => {
            const cmd = command.trim()
            setSnippets((all) => [...all, { id: newId(), name: cmd, command: cmd }])
            toast('Saved. Find it in the Automation tab.')
          }}
          title="Save this command"
        >
          <Bookmark size={16} />
        </Button>
        <Button variant="primary" disabled={running || !command.trim()}>
          {running ? 'Running...' : 'Run'}
        </Button>
      </form>
    </div>
  )
}
