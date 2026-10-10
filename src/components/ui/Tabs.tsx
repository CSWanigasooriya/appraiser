import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from './cn'

export interface TabItem<T extends string> {
  id: T
  label: string
  icon?: ReactNode
}

interface Props<T extends string> {
  tabs: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  /** `underline` is the page-level bar; `pill` is a quieter bar for sections inside a tab. */
  variant?: 'underline' | 'pill'
}

const edge =
  'absolute inset-y-0 z-10 flex w-8 cursor-pointer items-center text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'

export function Tabs<T extends string>({ tabs, value, onChange, variant = 'underline' }: Props<T>) {
  const scroller = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState({ left: false, right: false })

  const measure = useCallback(() => {
    const el = scroller.current
    if (!el) return
    setMore({ left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 })
  }, [])

  // Show the arrows only when some tabs are out of view, and keep them current as the window resizes.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure, tabs.length])

  // Bring the selected tab into view (e.g. after clicking a half-hidden one).
  useEffect(() => {
    scroller.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [value])

  const scrollBy = (dir: -1 | 1) => {
    const el = scroller.current
    el?.scrollBy({ left: dir * el.clientWidth * 0.6, behavior: 'smooth' })
  }

  const pill = variant === 'pill'

  return (
    <div className={cn('relative', !pill && 'border-b border-zinc-200 dark:border-zinc-800')}>
      {more.left && (
        <button
          type="button"
          aria-label="Show earlier tabs"
          onClick={() => scrollBy(-1)}
          className={cn(edge, 'left-0 justify-start bg-gradient-to-r from-white from-60% to-transparent dark:from-zinc-950')}
        >
          <ChevronLeft size={16} />
        </button>
      )}
      <div
        ref={scroller}
        role="tablist"
        onScroll={measure}
        className={cn(
          'flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          pill ? 'gap-1.5 pb-0.5' : 'gap-1',
        )}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === value}
            onClick={() => onChange(t.id)}
            className={cn(
              'flex flex-none cursor-pointer items-center gap-2 text-sm font-medium transition-colors',
              pill
                ? cn(
                    'rounded-lg px-3 py-1.5',
                    t.id === value
                      ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
                      : 'text-zinc-500 hover:bg-zinc-200/70 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
                  )
                : cn(
                    '-mb-px border-b-2 px-3 py-2',
                    t.id === value
                      ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                      : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100',
                  ),
            )}
          >
            {t.icon}
            <span className="max-sm:sr-only">{t.label}</span>
          </button>
        ))}
      </div>
      {more.right && (
        <button
          type="button"
          aria-label="Show more tabs"
          onClick={() => scrollBy(1)}
          className={cn(edge, 'right-0 justify-end bg-gradient-to-l from-white from-60% to-transparent dark:from-zinc-950')}
        >
          <ChevronRight size={16} />
        </button>
      )}
    </div>
  )
}
