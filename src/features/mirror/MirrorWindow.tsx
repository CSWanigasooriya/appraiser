import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window'
import { MonitorPlay, Pin, PinOff, Smartphone } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { MirrorControls } from './MirrorControls'
import { MirrorScreen } from './MirrorScreen'
import { useMirror } from './useMirror'

/** Height of the control bar, for sizing the window to the phone's aspect ratio. */
const BAR_HEIGHT = 64
const WINDOW_WIDTH = 380

/** The mirror on its own, shown in a detached window. Starts on open and stops on close. */
export function MirrorWindow({ serial }: { serial: string }) {
  const { canvasRef, status, error, notice, size, muted, setMuted, sendInput, start } = useMirror(serial)
  const [pinned, setPinned] = useState(false)
  const resized = useRef(false)

  useEffect(() => {
    void start()
  }, [start])

  // Fit the window to the phone's shape once, when the first frame shows its size.
  useEffect(() => {
    if (!size || resized.current) return
    resized.current = true
    const height = Math.round((WINDOW_WIDTH * size.height) / size.width) + BAR_HEIGHT
    getCurrentWindow()
      .setSize(new LogicalSize(WINDOW_WIDTH, height))
      .catch(() => {})
  }, [size])

  const togglePin = () => {
    const next = !pinned
    getCurrentWindow()
      .setAlwaysOnTop(next)
      .then(() => setPinned(next))
      .catch(() => {})
  }

  const live = status === 'live'

  return (
    <div className="flex h-screen flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
        <MirrorScreen
          canvasRef={canvasRef}
          live={live}
          sendInput={sendInput}
          className="h-auto max-h-full w-auto max-w-full"
        />
        {!live && (
          <div className="flex max-w-xs flex-col items-center gap-3 p-6 text-center text-zinc-400">
            <Smartphone size={32} />
            <p className="text-sm">
              {status === 'error' ? error : status === 'starting' ? 'Connecting to the phone...' : 'Mirroring stopped'}
            </p>
            {(status === 'error' || status === 'idle') && (
              <Button variant="primary" onClick={() => void start()}>
                <MonitorPlay size={16} /> Start
              </Button>
            )}
          </div>
        )}
        {notice && (
          <p className="absolute inset-x-2 top-2 rounded-lg bg-amber-500/90 p-2 text-center text-xs text-black">{notice}</p>
        )}
      </div>

      <div className="border-t border-zinc-200 p-2 dark:border-zinc-800" style={{ minHeight: BAR_HEIGHT }}>
        <MirrorControls live={live} muted={muted} setMuted={setMuted} sendInput={sendInput} compact>
          <Button onClick={togglePin} title={pinned ? 'Stop keeping on top' : 'Keep on top of other windows'}>
            {pinned ? <PinOff size={16} /> : <Pin size={16} />}
          </Button>
        </MirrorControls>
      </div>
    </div>
  )
}
