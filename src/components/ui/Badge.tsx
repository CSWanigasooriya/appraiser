import type { ReactNode } from 'react'
import { cn } from './cn'

export type Tone = 'green' | 'amber' | 'red' | 'zinc' | 'blue'

const tones: Record<Tone, string> = {
  green: 'bg-green-500/15 text-green-700 dark:text-green-400',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  red: 'bg-red-500/15 text-red-700 dark:text-red-400',
  blue: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  zinc: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
}

export function Badge({ tone = 'zinc', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        tones[tone],
      )}
    >
      {children}
    </span>
  )
}
