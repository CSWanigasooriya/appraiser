import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    setPos({ x: r.left + r.width / 2, y: r.top })
  }

  return (
    <span
      className="inline-flex"
      onMouseEnter={(e) => show(e.currentTarget)}
      onMouseLeave={() => setPos(null)}
      onFocus={(e) => show(e.currentTarget)}
      onBlur={() => setPos(null)}
      onClick={() => setPos(null)}
    >
      {children}
      {pos &&
        createPortal(
          <div
            role="tooltip"
            style={{ left: pos.x, top: pos.y - 6 }}
            className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium whitespace-nowrap text-zinc-900 shadow-md dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
            {label}
          </div>,
          document.body,
        )}
    </span>
  )
}
