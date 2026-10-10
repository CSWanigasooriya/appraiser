/** Syntax highlighting for the shell: echoed commands, the live input, and command output. */

import { memo, type ReactNode } from 'react'
import {
  C,
  ERROR_RE,
  LEVEL_CLASS,
  LOGCAT_RE,
  MAX_LINE,
  MAX_LINES,
  WARN_RE,
  tokenizeCommand,
  tokenizeOutput,
  type Token,
} from './highlightTokens'

const render = (tokens: Token[]): ReactNode[] =>
  tokens.map((t, i) => (t.cls ? <span key={i} className={t.cls}>{t.text}</span> : t.text))

/** A command line with syntax colours. */
export function HighlightedCommand({ command }: { command: string }) {
  return <>{render(tokenizeCommand(command))}</>
}

function Line({ text }: { text: string }) {
  if (text.length > MAX_LINE) return <div>{text}</div>

  const log = LOGCAT_RE.exec(text)
  if (log) {
    const [, time, ids, level, gap, tag, colon, message] = log
    return (
      <div className={level === 'E' || level === 'F' ? C.error : undefined}>
        <span className={C.dim}>{time}{ids}</span>
        <span className={LEVEL_CLASS[level]}>{level}</span>
        {gap}
        <span className="text-teal-300">{tag}</span>
        <span className={C.dim}>{colon}</span>
        {render(tokenizeOutput(message))}
      </div>
    )
  }

  const tint = ERROR_RE.test(text) ? C.error : WARN_RE.test(text) ? C.warn : undefined
  // Section headers like "Packages:" or "Display Power:" read better dimmed-bright.
  const header = /^[A-Z][\w ()/-]{2,40}:\s*$/.test(text)
  return (
    <div className={tint ?? (header ? 'font-semibold text-zinc-100' : undefined)}>
      {tint ? text : render(tokenizeOutput(text))}
    </div>
  )
}

/** Command output with syntax colours (logcat levels, key=value, paths, errors...). */
export const HighlightedOutput = memo(function HighlightedOutput({ text }: { text: string }) {
  const lines = text.split('\n')
  if (lines.length > MAX_LINES) return <pre className="whitespace-pre-wrap">{text}</pre>
  return (
    <pre className="whitespace-pre-wrap">
      {lines.map((line, i) => (
        <Line key={i} text={line} />
      ))}
    </pre>
  )
})
