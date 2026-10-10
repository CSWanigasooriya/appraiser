import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import type { MirrorInput } from '../../lib/adb'
import { KEYBOARD_KEYS, toVideo, type Point } from './keys'

interface Props {
  canvasRef: RefObject<HTMLCanvasElement | null>
  live: boolean
  sendInput: (input: MirrorInput) => void
  /** Sizing classes: the canvas keeps the phone's aspect ratio inside them. */
  className?: string
}

/** The phone's screen: a canvas that turns mouse and keyboard input into phone input. */
export function MirrorScreen({ canvasRef, live, sendInput, className = '' }: Props) {
  const pressed = useRef(false)
  const lastPoint = useRef<Point | null>(null)
  const moveFrame = useRef<number | null>(null)

  // Wheel needs a non-passive listener to stop the page scrolling under it.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!live || !canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = toVideo(canvas, e.clientX, e.clientY)
      sendInput({ kind: 'scroll', ...p, h: 0, v: Math.max(-5, Math.min(5, -e.deltaY / 40)) })
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [live, canvasRef, sendInput])

  const touch = (action: 0 | 1 | 2, p: Point) => sendInput({ kind: 'touch', action, ...p })

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    e.currentTarget.focus()
    e.currentTarget.setPointerCapture(e.pointerId)
    pressed.current = true
    lastPoint.current = toVideo(e.currentTarget, e.clientX, e.clientY)
    touch(0, lastPoint.current)
  }

  // Moves are coalesced to one per animation frame; a fast drag would
  // otherwise flood the phone with events.
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!pressed.current) return
    lastPoint.current = toVideo(e.currentTarget, e.clientX, e.clientY)
    if (moveFrame.current !== null) return
    moveFrame.current = requestAnimationFrame(() => {
      moveFrame.current = null
      if (pressed.current && lastPoint.current) touch(2, lastPoint.current)
    })
  }

  const release = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!pressed.current) return
    pressed.current = false
    if (moveFrame.current !== null) cancelAnimationFrame(moveFrame.current)
    moveFrame.current = null
    touch(1, toVideo(e.currentTarget, e.clientX, e.clientY))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const keycode = KEYBOARD_KEYS[e.key]
    if (keycode !== undefined) {
      e.preventDefault()
      sendInput({ kind: 'key', keycode })
    } else if (e.key.length === 1) {
      e.preventDefault()
      sendInput({ kind: 'text', text: e.key })
    }
  }

  return (
    <canvas
      ref={canvasRef}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={release}
      onPointerCancel={release}
      onKeyDown={onKeyDown}
      className={`touch-none cursor-pointer bg-black outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${live ? '' : 'hidden'} ${className}`}
    />
  )
}
