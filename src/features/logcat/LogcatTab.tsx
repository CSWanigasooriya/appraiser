import { ArrowDownToLine, Bug, Copy, HelpCircle, Package, Pause, Play, Regex, Search, Square, Trash2, WrapText, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { listApps, runShell } from '../../lib/adb'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { cn } from '../../components/ui/cn'
import { Input } from '../../components/ui/Input'
import { Combobox } from '../../components/ui/Combobox'
import { Select } from '../../components/ui/Select'
import { Tooltip } from '../../components/ui/Tooltip'
import { useToast } from '../../components/ui/toast'
import { LogList } from './LogList'
import { LEVELS, LEVEL_NAMES, pidsForPackage, validRegex, type Filter, type Level, type LogLine } from './parse'
import { useLogcat } from './useLogcat'

const sameSet = (a: ReadonlySet<number>, b: ReadonlySet<number>) => a.size === b.size && [...a].every((x) => b.has(x))

/** Process ids of an app, refreshed while it is selected (apps restart and get new ones). */
function usePackagePids(serial: string, pkg: string): Set<number> | null {
  const [pids, setPids] = useState<Set<number>>(new Set())
  useEffect(() => {
    if (!pkg) return
    let cancelled = false
    const poll = async () => {
      try {
        const next = pidsForPackage(await runShell(serial, 'ps -A -o PID,NAME'), pkg)
        if (!cancelled) setPids((prev) => (sameSet(prev, next) ? prev : next))
      } catch {
        // keep the last known pids
      }
    }
    void poll()
    const timer = setInterval(poll, 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [serial, pkg])
  return pkg ? pids : null
}

export function LogcatTab({ serial }: { serial: string }) {
  const toast = useToast()
  const [minLevel, setMinLevel] = useState<Level>('V')
  const [query, setQuery] = useState('')
  const [regex, setRegex] = useState(false)
  const [crashes, setCrashes] = useState(false)
  const [pkg, setPkg] = useState('')
  const [packages, setPackages] = useState<string[]>([])
  const [follow, setFollow] = useState(true)
  const [wrap, setWrap] = useState(false)
  // How many lines had been shown when following stopped, to count the new ones.
  const [anchor, setAnchor] = useState(0)
  const [selected, setSelected] = useState<LogLine | null>(null)

  const pkgValid = pkg === '' || /^[\w.]+$/.test(pkg)
  const pids = usePackagePids(serial, pkgValid ? pkg : '')
  const filter = useMemo<Filter>(() => ({ minLevel, query, regex, pids, crashes }), [minLevel, query, regex, pids, crashes])
  const { snapshot, status, error, paused, setPaused, start, stop, clear } = useLogcat(serial, filter)

  useEffect(() => {
    listApps(serial, true)
      .then((apps) => setPackages(apps.map((a) => a.package)))
      .catch(() => {})
  }, [serial])

  const regexOk = !regex || validRegex(query)
  const filtering = minLevel !== 'V' || query !== '' || pkg !== '' || crashes

  const changeFollow = (next: boolean) => {
    setFollow(next)
    if (!next) setAnchor(snapshot.lines.length)
  }
  const unseen = follow ? 0 : Math.max(0, snapshot.lines.length - anchor)

  const copyAll = () => {
    const text = snapshot.lines.map((l) => l.raw).join('\n')
    navigator.clipboard
      .writeText(text)
      .then(() => toast(`Copied ${snapshot.lines.length.toLocaleString()} lines`))
      .catch((e) => toast(String(e), 'error'))
  }

  const resetFilters = () => {
    setMinLevel('V')
    setQuery('')
    setRegex(false)
    setCrashes(false)
    setPkg('')
  }

  return (
    <div className="flex min-h-96 flex-1 flex-col gap-3">
      <div className="@container">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={minLevel}
          onChange={setMinLevel}
          options={LEVELS.map((l) => ({ value: l, label: `${l} ${LEVEL_NAMES[l]}+` }))}
          aria-label="Minimum level"
          className="w-32"
        />

        <Combobox
          value={pkg}
          onChange={(v) => setPkg(v.trim())}
          options={packages}
          placeholder="Filter by app"
          icon={<Package size={14} />}
          invalid={!pkgValid}
          aria-label="App"
          className="w-56 min-w-40"
        />

        <div className="relative min-w-48 flex-1">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-zinc-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={regex ? 'Regular expression' : 'Search logs'}
            spellCheck={false}
            className={cn('pr-16 pl-8', !regexOk && 'border-red-500')}
          />
          <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center">
            <Tooltip label="Tips: tag:Name filters by tag, -word excludes a word">
              <span className="cursor-help p-1 text-zinc-400">
                <HelpCircle size={14} />
              </span>
            </Tooltip>
            <Tooltip label={regex ? 'Regular expression: on' : 'Regular expression: off'}>
              <button
                type="button"
                onClick={() => setRegex((r) => !r)}
                aria-pressed={regex}
                className={cn(
                  'cursor-pointer rounded p-1',
                  regex ? 'bg-blue-500/20 text-blue-500' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200',
                )}
              >
                <Regex size={14} />
              </button>
            </Tooltip>
          </div>
        </div>

        <Tooltip label="Only crashes: fatal exceptions, ANRs, native signals">
          <Button variant={crashes ? 'primary' : 'secondary'} onClick={() => setCrashes((c) => !c)} aria-pressed={crashes} aria-label="Crashes">
            <Bug size={15} /> <span className="hidden @3xl:inline">Crashes</span>
          </Button>
        </Tooltip>
        {filtering && (
          <Tooltip label="Reset filters">
            <Button variant="ghost" onClick={resetFilters} aria-label="Reset filters">
              <X size={15} /> <span className="hidden @3xl:inline">Reset</span>
            </Button>
          </Tooltip>
        )}
      </div>
      </div>

      {pkg && pkgValid && pids?.size === 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">{pkg} isn't running right now. Its logs will appear when it starts.</p>
      )}
      {!regexOk && <p className="text-xs text-red-500">That isn't a valid regular expression.</p>}
      {status === 'error' && <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm">{error}</p>}

      <LogList
        lines={snapshot.lines}
        version={snapshot.version}
        wrap={wrap}
        follow={follow}
        onFollowChange={changeFollow}
        selectedId={selected?.id ?? null}
        onSelect={setSelected}
      />

      {selected && (
        <Card className="p-3 text-xs">
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-zinc-500">
            <Badge tone={selected.level === 'E' || selected.level === 'F' ? 'red' : selected.level === 'W' ? 'amber' : 'zinc'}>
              {LEVEL_NAMES[selected.level]}
            </Badge>
            <span className="font-mono">{selected.time}</span>
            <span>
              pid {selected.pid} · tid {selected.tid}
            </span>
            <span className="font-mono">{selected.tag}</span>
            <div className="flex-1" />
            <Tooltip label="Copy line">
              <Button
                variant="ghost"
                className="px-1.5 py-1"
                onClick={() => {
                  void navigator.clipboard.writeText(selected.raw)
                  toast('Line copied')
                }}
              >
                <Copy size={14} />
              </Button>
            </Tooltip>
            <Tooltip label="Close">
              <Button variant="ghost" className="px-1.5 py-1" onClick={() => setSelected(null)}>
                <X size={14} />
              </Button>
            </Tooltip>
          </div>
          <pre className="max-h-40 overflow-auto font-mono whitespace-pre-wrap">{selected.message}</pre>
        </Card>
      )}

      <div className="@container">
      <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-500">
        <Badge tone={status === 'streaming' ? (paused ? 'amber' : 'green') : status === 'error' ? 'red' : 'zinc'}>
          {status === 'streaming' ? (paused ? 'Paused' : 'Live') : status === 'error' ? 'Error' : 'Stopped'}
        </Badge>
        <span className="text-xs">
          {snapshot.lines.length.toLocaleString()} shown · {snapshot.total.toLocaleString()} total
        </span>
        {snapshot.errors > 0 && <Badge tone="red">{snapshot.errors.toLocaleString()} errors</Badge>}
        <div className="flex-1" />
        <Tooltip label="Wrap long lines">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
            <WrapText size={15} className="@3xl:hidden" />
            <span className="hidden @3xl:inline">Wrap lines</span>
          </label>
        </Tooltip>
        <Tooltip label="Keep the newest line in view">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={follow} onChange={(e) => changeFollow(e.target.checked)} />
            <ArrowDownToLine size={15} className="@3xl:hidden" />
            <span className="hidden @3xl:inline">Follow</span>
          </label>
        </Tooltip>
        {unseen > 0 && (
          <Button onClick={() => changeFollow(true)}>
            <ArrowDownToLine size={15} /> {unseen.toLocaleString()} new
          </Button>
        )}
        <Tooltip label={paused ? 'Resume updating the list' : 'Freeze the list; lines keep being captured'}>
          <Button onClick={() => setPaused(!paused)} disabled={status !== 'streaming'} aria-label={paused ? 'Resume' : 'Pause'}>
            {paused ? <Play size={15} /> : <Pause size={15} />} <span className="hidden @3xl:inline">{paused ? 'Resume' : 'Pause'}</span>
          </Button>
        </Tooltip>
        <Tooltip label="Copy the lines shown">
          <Button onClick={copyAll} disabled={snapshot.lines.length === 0} aria-label="Copy">
            <Copy size={15} /> <span className="hidden @3xl:inline">Copy</span>
          </Button>
        </Tooltip>
        <Tooltip label="Clear the view and the phone's log buffer">
          <Button onClick={clear} aria-label="Clear">
            <Trash2 size={15} /> <span className="hidden @3xl:inline">Clear</span>
          </Button>
        </Tooltip>
        {status === 'streaming' ? (
          <Tooltip label="Stop capturing">
            <Button onClick={stop} aria-label="Stop">
              <Square size={14} /> <span className="hidden @3xl:inline">Stop</span>
            </Button>
          </Tooltip>
        ) : (
          <Tooltip label="Start capturing">
            <Button variant="primary" onClick={start} aria-label="Start">
              <Play size={15} /> <span className="hidden @3xl:inline">Start</span>
            </Button>
          </Tooltip>
        )}
      </div>
      </div>
    </div>
  )
}
