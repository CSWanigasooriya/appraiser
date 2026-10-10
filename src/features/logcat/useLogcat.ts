import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clearLogcat, startLogcat, stopLogcat, type LogMessage } from '../../lib/adb'
import { compileFilter, parseLine, type Filter, type LogLine } from './parse'

export type LogStatus = 'idle' | 'streaming' | 'error'

/** Lines kept in memory; the oldest are dropped beyond this. */
const KEEP = 100_000
/** Trim in chunks so we don't shift the array on every batch. */
const TRIM_SLACK = 20_000

interface Snapshot {
  /** The filtered lines. The same array is reused between updates, so compare `version`, not identity. */
  lines: LogLine[]
  version: number
  total: number
  errors: number
}

/** Streams a device's log into a bounded buffer and keeps a filtered view of it. */
export function useLogcat(serial: string, filter: Filter) {
  const all = useRef<LogLine[]>([])
  const view = useRef<LogLine[]>([])
  const nextId = useRef(0)
  const errors = useRef(0)
  const frame = useRef<number | null>(null)
  const paused = useRef(false)
  const live = useRef(false)

  const matcher = useMemo(() => compileFilter(filter), [filter])
  const matcherRef = useRef(matcher)

  const [snapshot, setSnapshot] = useState<Snapshot>({ lines: [], version: 0, total: 0, errors: 0 })
  // Streaming starts as soon as the tab opens, so that is the initial state.
  const [status, setStatus] = useState<LogStatus>('streaming')
  const [error, setError] = useState<string | null>(null)
  const [pausedState, setPausedState] = useState(false)

  const publish = useCallback(() => {
    frame.current = null
    setSnapshot((s) => ({ lines: view.current, version: s.version + 1, total: all.current.length, errors: errors.current }))
  }, [])

  // At most one UI update per animation frame, however fast lines arrive.
  const schedule = useCallback(() => {
    if (paused.current || frame.current !== null) return
    frame.current = requestAnimationFrame(publish)
  }, [publish])

  const ingest = useCallback(
    (raw: string[]) => {
      const match = matcherRef.current
      for (const text of raw) {
        const line = parseLine(text, nextId.current++)
        all.current.push(line)
        if (line.level === 'E' || line.level === 'F') errors.current++
        if (match(line)) view.current.push(line)
      }
      if (all.current.length > KEEP + TRIM_SLACK) {
        const dropped = all.current.splice(0, all.current.length - KEEP)
        errors.current -= dropped.filter((l) => l.level === 'E' || l.level === 'F').length
        const firstId = all.current[0].id
        const cut = view.current.findIndex((l) => l.id >= firstId)
        view.current.splice(0, cut === -1 ? view.current.length : cut)
      }
      schedule()
    },
    [schedule],
  )

  // Re-filter everything we already have when the filter changes.
  useEffect(() => {
    matcherRef.current = matcher
    view.current = all.current.filter(matcher)
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    publish()
  }, [matcher, publish])

  const stop = useCallback(() => {
    live.current = false
    stopLogcat(serial).catch(() => {})
    setStatus('idle')
  }, [serial])

  // Bumped by `start` to (re)open the stream.
  const [attempt, setAttempt] = useState(0)

  const start = useCallback(() => {
    setError(null)
    setStatus('streaming')
    setAttempt((n) => n + 1)
  }, [])

  /** Empties the buffer and, best-effort, the phone's own log buffer. */
  const clear = useCallback(() => {
    all.current = []
    view.current = []
    errors.current = 0
    clearLogcat(serial).catch(() => {})
    publish()
  }, [serial, publish])

  const setPaused = useCallback(
    (value: boolean) => {
      paused.current = value
      setPausedState(value)
      if (!value) publish()
    },
    [publish],
  )

  // The stream lives as long as this effect: it opens on mount (and on each `start`)
  // and closes on cleanup, when the tab goes away or the stream is restarted.
  useEffect(() => {
    live.current = true
    const onMessage = (m: LogMessage) => {
      if (!live.current) return
      if (m.kind === 'lines') {
        ingest(m.lines)
      } else {
        live.current = false
        setError(m.reason)
        setStatus('error')
      }
    }
    startLogcat(serial, onMessage).catch((e) => {
      live.current = false
      setError(String(e))
      setStatus('error')
    })
    return () => {
      live.current = false
      stopLogcat(serial).catch(() => {})
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [serial, attempt, ingest])

  return { snapshot, status, error, paused: pausedState, setPaused, start, stop, clear }
}
