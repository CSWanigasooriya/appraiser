import { useCallback, useEffect, useRef, useState } from 'react'
import { perfSample, type PerfSample } from '../../lib/adb'

export interface PerfPoint {
  /** When this reading was taken (ms since epoch). */
  at: number
  /** Percent of all CPU capacity in use. */
  cpu: number
  /** Percent of RAM in use. */
  memPercent: number
  memUsedMb: number
  appCpu: number | null
  appMemMb: number | null
  fps: number | null
  /** Percent of frames in this interval that were slow. */
  jank: number | null
  battery: number | null
  temp: number | null
}

/** How many points to keep (one every `INTERVAL_MS`). */
export const MAX_POINTS = 90
export const INTERVAL_MS = 2000

const percent = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0)

/** Turns two cumulative samples into the rates between them. */
export function between(prev: PerfSample, cur: PerfSample): PerfPoint {
  const dTotal = cur.cpu_total - prev.cpu_total
  const dIdle = cur.cpu_idle - prev.cpu_idle
  const seconds = cur.uptime - prev.uptime
  const a = prev.app
  const b = cur.app
  const sameApp = a && b && a.pid === b.pid

  let fps: number | null = null
  let jank: number | null = null
  if (sameApp && a.frames != null && b.frames != null && seconds > 0) {
    const frames = b.frames - a.frames
    fps = Math.max(0, frames / seconds)
    jank = b.janky_frames != null && a.janky_frames != null && frames > 0 ? percent(b.janky_frames - a.janky_frames, frames) : 0
  }

  return {
    at: Date.now(),
    cpu: percent(dTotal - dIdle, dTotal),
    memPercent: percent(cur.mem_total_kb - cur.mem_available_kb, cur.mem_total_kb),
    memUsedMb: (cur.mem_total_kb - cur.mem_available_kb) / 1024,
    appCpu: sameApp ? percent(b.cpu_ticks - a.cpu_ticks, dTotal) : null,
    appMemMb: b?.pss_kb != null ? b.pss_kb / 1024 : null,
    fps,
    jank,
    battery: cur.battery_level,
    temp: cur.battery_temp,
  }
}

/** Polls the phone while `running`, keeping the last few minutes of readings. */
export function usePerf(serial: string, pkg: string | null, running: boolean) {
  const [points, setPoints] = useState<PerfPoint[]>([])
  const [error, setError] = useState<string | null>(null)
  const prev = useRef<PerfSample | null>(null)

  /** Forget the old readings; call this when starting a new run. */
  const reset = useCallback(() => {
    prev.current = null
    setPoints([])
    setError(null)
  }, [])

  useEffect(() => {
    if (!running) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    const tick = async () => {
      try {
        const sample = await perfSample(serial, pkg)
        if (cancelled) return
        setError(null)
        if (prev.current) {
          const point = between(prev.current, sample)
          setPoints((all) => [...all, point].slice(-MAX_POINTS))
        }
        prev.current = sample
      } catch (e) {
        if (!cancelled) setError(String(e))
      }
      if (!cancelled) timer = setTimeout(tick, INTERVAL_MS)
    }
    void tick()
    return () => {
      cancelled = true
      clearTimeout(timer)
      // Counters from before a pause would give one wild reading afterwards.
      prev.current = null
    }
  }, [serial, pkg, running])

  return { points, error, reset }
}
