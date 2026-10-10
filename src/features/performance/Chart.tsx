import { useId } from 'react'
import { Card } from '../../components/ui/Card'

interface Props {
  title: string
  /** Latest value, formatted. */
  value: string
  /** Smaller line under the value (average, peak...). */
  detail?: string
  values: (number | null)[]
  /** Top of the scale. Defaults to the highest value seen. */
  max?: number
  /** How many slots the chart spans, so a short series starts at the left. */
  slots: number
  /** Tailwind text colour class that sets the line colour. */
  color?: string
}

const W = 300
const H = 80

/** A small line chart with a filled area. */
export function Chart({ title, value, detail, values, max, slots, color = 'text-blue-600 dark:text-blue-400' }: Props) {
  const gradient = useId()
  const top = max ?? Math.max(1, ...values.map((v) => v ?? 0)) * 1.15
  const step = W / Math.max(1, slots - 1)
  const xy = values.map((v, i) => (v == null ? null : [i * step, H - (Math.min(v, top) / top) * H] as const))

  // Gaps (null readings) split the line into separate runs.
  const runs: (readonly [number, number])[][] = [[]]
  for (const p of xy) {
    if (p) runs[runs.length - 1].push(p)
    else if (runs[runs.length - 1].length) runs.push([])
  }
  const lines = runs.filter((r) => r.length > 1)

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">{title}</h3>
        <span className="text-lg font-semibold tabular-nums">{value}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={`h-20 w-full ${color}`} role="img" aria-label={`${title} over time`}>
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.25" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1="0"
            x2={W}
            y1={H * f}
            y2={H * f}
            className="stroke-zinc-200 dark:stroke-zinc-800"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {lines.map((run, i) => {
          const path = run.map(([x, y], j) => `${j ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
          return (
            <g key={i}>
              <path d={`${path} L${run[run.length - 1][0]} ${H} L${run[0][0]} ${H} Z`} fill={`url(#${gradient})`} />
              <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </g>
          )
        })}
      </svg>
      <div className="flex justify-between text-xs text-zinc-500">
        <span>{detail ?? ' '}</span>
        <span>{max != null ? `scale 0-${max}` : ''}</span>
      </div>
    </Card>
  )
}
