/** Parsing and filtering of `logcat -v threadtime` lines. Pure, no React. */

export const LEVELS = ['V', 'D', 'I', 'W', 'E', 'F'] as const
export type Level = (typeof LEVELS)[number]

export const LEVEL_NAMES: Record<Level, string> = {
  V: 'Verbose',
  D: 'Debug',
  I: 'Info',
  W: 'Warn',
  E: 'Error',
  F: 'Fatal',
}

const RANK: Record<string, number> = { V: 0, D: 1, I: 2, W: 3, E: 4, F: 5, A: 5 }

export interface LogLine {
  /** Increases with arrival order; stable across filtering. */
  id: number
  time: string
  pid: number
  tid: number
  level: Level
  tag: string
  message: string
  raw: string
}

const LINE_RE = /^(\d\d-\d\d \d\d:\d\d:\d\d\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEFA])\s+(.*?)\s*:\s?(.*)$/

/** Parses one threadtime line. Anything else (e.g. buffer separators) becomes a verbose line. */
export function parseLine(raw: string, id: number): LogLine {
  const m = LINE_RE.exec(raw)
  if (!m) return { id, time: '', pid: 0, tid: 0, level: 'V', tag: '', message: raw, raw }
  return {
    id,
    time: m[1],
    pid: Number(m[2]),
    tid: Number(m[3]),
    level: m[4] === 'A' ? 'F' : (m[4] as Level),
    tag: m[5],
    message: m[6],
    raw,
  }
}

export interface Filter {
  /** Show this level and above. */
  minLevel: Level
  /** Free text. Space-separated terms must all match; `-term` excludes; `tag:Foo` matches the tag. */
  query: string
  /** Treat `query` as one regular expression instead. */
  regex: boolean
  /** Only lines from these process ids (the selected app), or all when null. */
  pids: ReadonlySet<number> | null
  /** Only crash-like lines: fatal exceptions, ANRs, native signals... */
  crashes: boolean
}

export const DEFAULT_FILTER: Filter = { minLevel: 'V', query: '', regex: false, pids: null, crashes: false }

const CRASH_RE =
  /FATAL EXCEPTION|ANR in|has died|Force finishing|am_crash|am_anr|\bsignal \d+ \(SIG|\b\w+(\.\w+)*(Exception|Error)\b:|Process: .+, PID:|Abort message|backtrace:/

/** Whether the regex in `query` is valid (an empty one counts as valid). */
export function validRegex(query: string): boolean {
  try {
    new RegExp(query)
    return true
  } catch {
    return false
  }
}

/** Builds a fast predicate for a filter; build it once, then call it per line. */
export function compileFilter(f: Filter): (line: LogLine) => boolean {
  const min = RANK[f.minLevel]
  const query = f.query.trim()

  let text: ((l: LogLine) => boolean) | null = null
  if (query) {
    if (f.regex) {
      try {
        const re = new RegExp(query, 'i')
        text = (l) => re.test(l.tag) || re.test(l.message)
      } catch {
        text = () => false // an invalid pattern matches nothing, so the mistake is visible
      }
    } else {
      const include: string[] = []
      const exclude: string[] = []
      const tags: string[] = []
      for (const term of query.toLowerCase().split(/\s+/)) {
        if (term.startsWith('tag:') && term.length > 4) tags.push(term.slice(4))
        else if (term.startsWith('-') && term.length > 1) exclude.push(term.slice(1))
        else include.push(term)
      }
      text = (l) => {
        const tag = l.tag.toLowerCase()
        const hay = `${tag} ${l.message.toLowerCase()}`
        return (
          tags.every((t) => tag.includes(t)) &&
          include.every((t) => hay.includes(t)) &&
          !exclude.some((t) => hay.includes(t))
        )
      }
    }
  }

  return (l) =>
    RANK[l.level] >= min &&
    (f.pids === null || f.pids.has(l.pid)) &&
    (!f.crashes || CRASH_RE.test(l.message) || CRASH_RE.test(l.tag)) &&
    (text === null || text(l))
}

/** Extracts package processes from `ps -A -o PID,NAME` output: pids of `pkg` and its `pkg:service` processes. */
export function pidsForPackage(psOutput: string, pkg: string): Set<number> {
  const pids = new Set<number>()
  for (const line of psOutput.split('\n')) {
    const m = /^\s*(\d+)\s+(\S+)\s*$/.exec(line)
    if (m && (m[2] === pkg || m[2].startsWith(`${pkg}:`))) pids.add(Number(m[1]))
  }
  return pids
}
