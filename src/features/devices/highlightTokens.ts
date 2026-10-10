/**
 * Pure tokenizers for the shell's syntax highlighting. Every character of the
 * input ends up in some token (whitespace included), so the live-input overlay
 * lines up exactly with the real input.
 */

// Colours are chosen for the terminal's always-dark background.
export const C = {
  program: 'text-sky-300 font-semibold',
  flag: 'text-violet-300',
  string: 'text-emerald-300',
  number: 'text-amber-300',
  operator: 'text-pink-400',
  variable: 'text-fuchsia-300',
  path: 'text-cyan-300',
  key: 'text-sky-300',
  keyword: 'text-fuchsia-300',
  url: 'text-blue-400 underline',
  dim: 'text-zinc-500',
  error: 'text-red-400',
  warn: 'text-amber-300',
  package: 'text-teal-300',
}

export interface Token {
  text: string
  cls?: string
}

// ---- Commands --------------------------------------------------------------

const COMMAND_RE =
  /(\s+)|("(?:[^"\\]|\\.)*"?|'[^']*'?)|(&&|\|\||[|;&<>]+)|(\$\w+|\$\{[^}]*\})|([^\s"'|;&<>$]+)/g

const looksLikePath = (w: string) => /^(~|\.{0,2})\/|\w\/\w/.test(w)
const looksLikePackage = (w: string) => /^[a-z][\w]*(\.[\w]+){2,}$/i.test(w)

/** Splits a command line into coloured tokens, covering every character. */
export function tokenizeCommand(cmd: string): Token[] {
  const tokens: Token[] = []
  let atStart = true // next word is a program name
  for (const m of cmd.matchAll(COMMAND_RE)) {
    const [text, space, str, op, variable, word] = m
    if (space) {
      tokens.push({ text })
    } else if (str) {
      tokens.push({ text, cls: C.string })
      atStart = false
    } else if (op) {
      tokens.push({ text, cls: C.operator })
      atStart = true
    } else if (variable) {
      tokens.push({ text, cls: C.variable })
      atStart = false
    } else if (word) {
      let cls: string | undefined
      if (atStart) cls = C.program
      else if (/^--?[A-Za-z][\w-]*(=.*)?$/.test(word)) cls = C.flag
      else if (/^-?\d+(\.\d+)?$/.test(word)) cls = C.number
      else if (/^[A-Z][A-Z0-9_]{3,}$/.test(word)) cls = C.keyword // KEYCODE_HOME, ...
      else if (looksLikePath(word)) cls = C.path
      else if (looksLikePackage(word)) cls = C.package
      tokens.push({ text, cls })
      atStart = false
    } else {
      tokens.push({ text })
    }
  }
  return tokens
}

// ---- Output ----------------------------------------------------------------

const OUTPUT_RE = new RegExp(
  [
    String.raw`(https?:\/\/[^\s)>\]]+)`, // 1 url
    String.raw`("(?:[^"\\\n]|\\.)*"|'[^'\n]*')`, // 2 string
    String.raw`(\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b)`, // 3 ip
    String.raw`(\b0x[0-9a-fA-F]+\b)`, // 4 hex
    String.raw`((?:~|\.{1,2})?\/[\w.@+~-]+(?:\/[\w.@+~-]*)*)`, // 5 path
    String.raw`(\b[A-Za-z_][\w.-]*(?==))`, // 6 key before =
    String.raw`(\b(?:true|false|null|none|enabled|disabled)\b)`, // 7 keyword
    String.raw`((?<![\w.])-?\d+(?:\.\d+)?(?![\w.]))`, // 8 number
    String.raw`(\bpackage:)`, // 9 package: prefix
  ].join('|'),
  'g',
)

const OUTPUT_CLASSES = [undefined, C.url, C.string, C.number, C.number, C.path, C.key, C.keyword, C.number, C.dim]

export const LOGCAT_RE = /^(\d\d-\d\d\s+\d\d:\d\d:\d\d\.\d+)(\s+\d+\s+\d+\s+)([VDIWEFA])(\s+)(.+?)(\s*:\s)(.*)$/

export const LEVEL_CLASS: Record<string, string> = {
  V: 'text-zinc-500',
  D: 'text-sky-300',
  I: 'text-emerald-400',
  W: 'text-amber-300',
  E: 'text-red-400',
  F: 'text-red-500 font-semibold',
  A: 'text-red-500 font-semibold',
}

export const ERROR_RE = /\b(exception|error|fatal|denied|not found|failed|failure|no such file|unknown command|inaccessible|not allowed|aborted)\b/i
export const WARN_RE = /\b(warning|warn|deprecated)\b/i

/** Lines longer than this are left plain: highlighting them costs more than it helps. */
export const MAX_LINE = 1000
/** Outputs with more lines than this are shown plain, to keep the UI responsive. */
export const MAX_LINES = 2500

export function tokenizeOutput(line: string): Token[] {
  const tokens: Token[] = []
  let last = 0
  for (const m of line.matchAll(OUTPUT_RE)) {
    if (m.index > last) tokens.push({ text: line.slice(last, m.index) })
    const group = m.findIndex((g, i) => i > 0 && g !== undefined)
    tokens.push({ text: m[0], cls: OUTPUT_CLASSES[group] })
    last = m.index + m[0].length
  }
  if (last < line.length) tokens.push({ text: line.slice(last) })
  return tokens
}

