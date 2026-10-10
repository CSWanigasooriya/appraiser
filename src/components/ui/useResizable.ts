import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

interface Options {
  /** localStorage key used to remember the width between runs. */
  storageKey: string
  initial: number
  min: number
  max: number
}

const clampTo = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)

function load({ storageKey, initial, min, max }: Options) {
  try {
    const saved = Number(localStorage.getItem(storageKey))
    if (saved) return clampTo(saved, min, max)
  } catch {
    // storage may be unavailable; fall back to the default
  }
  return initial
}

/** A width the user can drag (or arrow-key) to change, remembered across runs. */
export function useResizable(options: Options) {
  const { storageKey, initial, min, max } = options
  const [width, setWidthState] = useState(() => load(options))
  const [dragging, setDragging] = useState(false)
  const start = useRef({ x: 0, width: 0 })

  const setWidth = useCallback(
    (value: number, persist = true) => {
      const next = clampTo(value, min, max)
      setWidthState(next)
      if (!persist) return
      try {
        localStorage.setItem(storageKey, String(next))
      } catch {
        // not worth failing the resize over
      }
    },
    [storageKey, min, max],
  )

  const handleProps = {
    role: 'separator' as const,
    'aria-orientation': 'vertical' as const,
    'aria-valuenow': width,
    'aria-valuemin': min,
    'aria-valuemax': max,
    tabIndex: 0,
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      start.current = { x: e.clientX, width }
      setDragging(true)
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (dragging) setWidth(start.current.width + e.clientX - start.current.x, false)
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      if (!dragging) return
      setDragging(false)
      setWidth(start.current.width + e.clientX - start.current.x)
    },
    onDoubleClick: () => setWidth(initial),
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === 'ArrowLeft') setWidth(width - 16)
      else if (e.key === 'ArrowRight') setWidth(width + 16)
      else return
      e.preventDefault()
    },
  }

  return { width, dragging, handleProps }
}
