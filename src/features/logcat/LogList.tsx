import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cn } from '../../components/ui/cn'
import type { Level, LogLine } from './parse'

/** Text line height and the row's vertical padding, in px (text-xs / leading-4, py-0.5). */
const LINE = 16
const PAD = 4
const ROW = LINE + PAD
/** Rows rendered beyond the visible ones, so fast scrolling doesn't flash blank. */
const OVERSCAN = 8
/** Width taken by the time, level and tag columns, their gaps and the row's side padding. */
const FIXED_COLUMNS = 112 + 12 + 160 + 3 * 8 + 24

const LEVEL_TEXT: Record<Level, string> = {
  V: 'text-zinc-500',
  D: 'text-sky-300',
  I: 'text-emerald-400',
  W: 'text-amber-300',
  E: 'text-red-400',
  F: 'text-red-500 font-semibold',
}

const MESSAGE_TEXT: Record<Level, string> = {
  V: 'text-zinc-400',
  D: 'text-zinc-200',
  I: 'text-zinc-200',
  W: 'text-amber-200',
  E: 'text-red-300',
  F: 'text-red-300',
}

const TAG_COLORS = ['text-teal-300', 'text-cyan-300', 'text-violet-300', 'text-fuchsia-300', 'text-lime-300', 'text-orange-300', 'text-sky-300', 'text-pink-300']

/** A stable colour per tag, so one component's lines are easy to follow. */
function tagColor(tag: string) {
  let h = 0
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) | 0
  return TAG_COLORS[Math.abs(h) % TAG_COLORS.length]
}

interface Props {
  lines: LogLine[]
  /** Changes whenever `lines` was updated in place. */
  version: number
  /** Wrap long messages onto several rows instead of scrolling sideways. */
  wrap: boolean
  /** Keep the newest line in view as lines arrive. */
  follow: boolean
  onFollowChange: (follow: boolean) => void
  selectedId: number | null
  onSelect: (line: LogLine) => void
}

/**
 * A virtualized list: only the rows on screen are in the DOM, so 100k lines
 * stay smooth. Wrapped rows have a computed height (the font is monospace, so
 * the number of wrapped lines follows from the message length), which keeps
 * virtualization exact.
 */
export function LogList({ lines, version, wrap, follow, onFollowChange, selectedId, onSelect }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [size, setSize] = useState({ width: 800, height: 400 })
  const [charWidth, setCharWidth] = useState(7.2)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Measure one monospace character (and again once web fonts are ready).
  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const ctx = document.createElement('canvas').getContext('2d')
      if (!ctx) return
      ctx.font = getComputedStyle(el).font
      const w = ctx.measureText('x'.repeat(100)).width / 100
      if (w > 0) setCharWidth(w)
    }
    measure()
    void document.fonts?.ready.then(measure)
  }, [])

  const charsPerLine = Math.max(8, Math.floor((size.width - FIXED_COLUMNS - 2) / charWidth))

  // Top edge of every row (and the total height at the end) when wrapping.
  // `version` is the signal that `lines` changed in place.
  const offsets = useMemo(() => {
    if (!wrap) return null
    const out = new Float64Array(lines.length + 1)
    for (let i = 0; i < lines.length; i++) {
      const rows = Math.max(1, Math.ceil(lines[i].message.length / charsPerLine))
      out[i + 1] = out[i] + rows * LINE + PAD
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrap, lines, version, charsPerLine])

  const total = offsets ? offsets[lines.length] : lines.length * ROW

  // Stick to the newest line while following.
  useLayoutEffect(() => {
    const el = box.current
    if (follow && el) el.scrollTop = el.scrollHeight
  }, [follow, version, total])

  const onScroll = () => {
    const el = box.current
    if (!el) return
    setScrollTop(el.scrollTop)
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < ROW
    if (atBottom !== follow) onFollowChange(atBottom)
  }

  // Which rows are on screen.
  let first: number
  let last: number
  if (offsets) {
    first = rowAt(offsets, scrollTop)
    last = Math.min(lines.length, rowAt(offsets, scrollTop + size.height) + 1)
  } else {
    first = Math.floor(scrollTop / ROW)
    last = Math.min(lines.length, Math.ceil((scrollTop + size.height) / ROW))
  }
  first = Math.max(0, first - OVERSCAN)
  last = Math.min(lines.length, last + OVERSCAN)
  const top = offsets ? offsets[first] : first * ROW

  return (
    <div
      ref={box}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-auto rounded-xl bg-zinc-950 font-mono text-xs leading-4"
    >
      <div style={{ height: total }} className={cn('relative', !wrap && 'w-max min-w-full')}>
        <div style={{ transform: `translateY(${top}px)` }} className={cn(!wrap && 'w-max min-w-full')}>
          {lines.slice(first, last).map((l) => {
            const rows = offsets ? Math.max(1, Math.ceil(l.message.length / charsPerLine)) : 1
            return (
              <div
                key={l.id}
                onClick={() => onSelect(l)}
                style={wrap ? { height: rows * LINE + PAD } : { height: ROW }}
                className={cn(
                  'flex cursor-pointer gap-2 px-3 py-0.5 hover:bg-zinc-900',
                  wrap ? 'items-start overflow-hidden' : 'items-center whitespace-pre',
                  l.id === selectedId && 'bg-blue-500/20 hover:bg-blue-500/20',
                )}
              >
                <span className="w-28 flex-none text-zinc-500">{l.time.slice(6)}</span>
                <span className={cn('w-3 flex-none text-center', LEVEL_TEXT[l.level])}>{l.level}</span>
                <span className={cn('w-40 flex-none truncate', tagColor(l.tag))} title={l.tag}>
                  {l.tag}
                </span>
                <span className={cn(MESSAGE_TEXT[l.level], wrap && 'min-w-0 flex-1 break-all whitespace-pre-wrap')}>
                  {l.message}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** Index of the row containing vertical position `y` (binary search over row tops). */
function rowAt(offsets: Float64Array, y: number): number {
  let lo = 0
  let hi = offsets.length - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offsets[mid] <= y) lo = mid
    else hi = mid - 1
  }
  return Math.max(0, lo)
}
