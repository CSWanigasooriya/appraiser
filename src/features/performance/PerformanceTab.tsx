import { Activity, Package, Play, Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Combobox } from '../../components/ui/Combobox'
import { listApps } from '../../lib/adb'
import { Chart } from './Chart'
import { INTERVAL_MS, MAX_POINTS, usePerf, type PerfPoint } from './usePerf'

const fixed = (n: number, digits = 0) => n.toFixed(digits)

function stats(values: (number | null)[], format: (n: number) => string): string {
  const v = values.filter((n): n is number => n != null)
  if (v.length === 0) return ' '
  const avg = v.reduce((a, b) => a + b, 0) / v.length
  return `avg ${format(avg)} · peak ${format(Math.max(...v))}`
}

/** Live charts of CPU, memory, battery and frame rate for the whole phone or one app. */
export function PerformanceTab({ serial, active }: { serial: string; active: boolean }) {
  const [running, setRunning] = useState(false)
  const [input, setInput] = useState('')
  // The app being watched is fixed when monitoring starts.
  const [watching, setWatching] = useState<string | null>(null)
  const [packages, setPackages] = useState<string[]>([])

  const { points, error, reset } = usePerf(serial, watching, running && active)

  // Package names are only fetched once the tab is first used.
  useEffect(() => {
    if (!active || packages.length > 0) return
    listApps(serial, true)
      .then((apps) => setPackages(apps.map((a) => a.package)))
      .catch(() => {})
  }, [active, serial, packages.length])

  const col = (pick: (p: PerfPoint) => number | null) => points.map(pick)
  const last = points[points.length - 1]
  const appMode = watching !== null
  const missing = running && appMode && last && last.appCpu === null

  // Battery drain per hour, from the first and last readings. A short window gives a meaningless rate.
  const first = points[0]
  const hours = first && last ? (last.at - first.at) / 3_600_000 : 0
  const drain = hours > 0.03 && first.battery != null && last?.battery != null ? Math.max(0, (first.battery - last.battery) / hours) : null

  const toggle = () => {
    if (running) return setRunning(false)
    const pkg = input.trim()
    setWatching(pkg || null)
    reset()
    setRunning(true)
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-center gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
          <Activity size={22} />
        </div>
        <div className="min-w-0 flex-1 basis-40">
          <h3 className="text-base font-semibold">Performance monitor</h3>
          <p className="text-xs text-zinc-500">
            Updates every {INTERVAL_MS / 1000} s and keeps the last {(MAX_POINTS * INTERVAL_MS) / 60000} minutes
          </p>
        </div>
        <Combobox
          value={input}
          onChange={setInput}
          options={packages}
          placeholder="Whole phone, or an app's package"
          icon={<Package size={14} />}
          className="w-72 max-w-full"
          aria-label="App to monitor"
        />
        <Button variant={running ? 'secondary' : 'primary'} onClick={toggle}>
          {running ? <Square size={14} /> : <Play size={16} />} {running ? 'Stop' : 'Start'}
        </Button>
      </Card>

      {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm">{error}</p>}
      {missing && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          {watching} isn't running. Open it on the phone and its numbers will appear.
        </p>
      )}

      {!running && points.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-500">
          Press Start to chart the phone's CPU, memory, battery and temperature. Name an app to also see its own CPU,
          memory and frame rate.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Chart
            title="CPU, whole phone"
            value={last ? `${fixed(last.cpu)}%` : '-'}
            detail={stats(col((p) => p.cpu), (n) => `${fixed(n)}%`)}
            values={col((p) => p.cpu)}
            max={100}
            slots={MAX_POINTS}
          />
          <Chart
            title="Memory in use"
            value={last ? `${fixed(last.memUsedMb)} MB` : '-'}
            detail={last ? `${fixed(last.memPercent)}% of RAM` : ' '}
            values={col((p) => p.memPercent)}
            max={100}
            slots={MAX_POINTS}
            color="text-violet-600 dark:text-violet-400"
          />
          {appMode && (
            <>
              <Chart
                title={`CPU, ${watching}`}
                value={last?.appCpu != null ? `${fixed(last.appCpu, 1)}%` : '-'}
                detail={stats(col((p) => p.appCpu), (n) => `${fixed(n, 1)}%`)}
                values={col((p) => p.appCpu)}
                slots={MAX_POINTS}
                color="text-emerald-600 dark:text-emerald-400"
              />
              <Chart
                title={`Memory, ${watching}`}
                value={last?.appMemMb != null ? `${fixed(last.appMemMb)} MB` : '-'}
                detail={stats(col((p) => p.appMemMb), (n) => `${fixed(n)} MB`)}
                values={col((p) => p.appMemMb)}
                slots={MAX_POINTS}
                color="text-amber-600 dark:text-amber-400"
              />
              <Chart
                title="Frame rate"
                value={last?.fps != null ? `${fixed(last.fps)} fps` : '-'}
                detail={last?.jank != null ? `${fixed(last.jank)}% of frames were slow` : 'Draws only while the app is changing'}
                values={col((p) => p.fps)}
                max={120}
                slots={MAX_POINTS}
                color="text-sky-600 dark:text-sky-400"
              />
            </>
          )}
          <Chart
            title="Battery"
            value={last?.battery != null ? `${last.battery}%` : '-'}
            detail={drain != null ? `draining about ${fixed(drain, 1)}% per hour` : 'Drain shows after a couple of minutes'}
            values={col((p) => p.battery)}
            max={100}
            slots={MAX_POINTS}
            color="text-green-600 dark:text-green-400"
          />
          <Chart
            title="Battery temperature"
            value={last?.temp != null ? `${fixed(last.temp, 1)} °C` : '-'}
            detail={stats(col((p) => p.temp), (n) => `${fixed(n, 1)} °C`)}
            values={col((p) => p.temp)}
            slots={MAX_POINTS}
            color="text-red-600 dark:text-red-400"
          />
        </div>
      )}
    </div>
  )
}
