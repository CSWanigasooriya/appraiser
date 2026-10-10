import type { ReactNode } from 'react'
import { cn } from './cn'

export interface TabItem<T extends string> {
  id: T
  label: string
  icon?: ReactNode
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: TabItem<T>[]
  value: T
  onChange: (id: T) => void
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            '-mb-px flex flex-none cursor-pointer items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            t.id === value
              ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
              : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100',
          )}
        >
          {t.icon}
          <span className="max-sm:sr-only">{t.label}</span>
        </button>
      ))}
    </div>
  )
}
