/** Android `KEYCODE_*` values for the buttons and keys we forward. */
export const KEY = { back: 4, home: 3, recents: 187, power: 26, volumeUp: 24, volumeDown: 25 }

/** Browser `KeyboardEvent.key` values that map to a keycode (other single characters are typed as text). */
export const KEYBOARD_KEYS: Record<string, number> = {
  Enter: 66,
  Backspace: 67,
  Tab: 61,
  Delete: 112,
  Escape: KEY.back,
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22,
  Home: 122,
  End: 123,
  PageUp: 92,
  PageDown: 93,
}

export interface Point {
  x: number
  y: number
  width: number
  height: number
}

/** Maps a pointer position on the canvas to video pixels. */
export function toVideo(canvas: HTMLCanvasElement, clientX: number, clientY: number): Point {
  const r = canvas.getBoundingClientRect()
  const clamp = (v: number) => Math.min(Math.max(v, 0), 1)
  return {
    x: Math.round(clamp((clientX - r.left) / r.width) * (canvas.width - 1)),
    y: Math.round(clamp((clientY - r.top) / r.height) * (canvas.height - 1)),
    width: canvas.width,
    height: canvas.height,
  }
}
