import { getCurrentWebview } from '@tauri-apps/api/webview'
import { useEffect, useRef, useState } from 'react'

/**
 * Receives files dragged onto the window from the OS (as real paths).
 * Listens only while `active`: every tab stays mounted, so without this
 * a drop would be handled by all of them at once.
 */
export function useFileDrop(active: boolean, onDrop: (paths: string[]) => void) {
  const [dragOver, setDragOver] = useState(false)
  const latest = useRef(onDrop)

  useEffect(() => {
    latest.current = onDrop
  })

  useEffect(() => {
    if (!active) return
    const unlisten = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === 'drop') {
        setDragOver(false)
        latest.current(e.payload.paths)
      } else {
        setDragOver(e.payload.type === 'over' || e.payload.type === 'enter')
      }
    })
    return () => {
      void unlisten.then((fn) => fn())
      setDragOver(false)
    }
  }, [active])

  return dragOver
}
