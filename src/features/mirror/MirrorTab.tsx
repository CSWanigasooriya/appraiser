import type { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { Activity, ExternalLink, Maximize2, MonitorPlay, PictureInPicture2, Radio, Smartphone, Square } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Badge, type Tone } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { InfoRow } from '../../components/ui/InfoRow'
import { useToast } from '../../components/ui/toast'
import { BLANK_HINT } from './blankHint'
import { MirrorCapture } from './MirrorCapture'
import { MirrorControls } from './MirrorControls'
import { MirrorScreen } from './MirrorScreen'
import { findMirrorWindow, openMirrorWindow } from './popout'
import { useCapture } from './useCapture'
import { useMirror, type MirrorStatus } from './useMirror'

interface Props {
  serial: string
  /** Shown as the title of the detached window. */
  title: string
  /** False while another tab is showing: the stream is stopped to save the phone's battery and USB/Wi-Fi bandwidth. */
  active: boolean
}

const statusTone: Record<MirrorStatus, Tone> = { idle: 'zinc', starting: 'amber', live: 'green', error: 'red' }
const statusLabel: Record<MirrorStatus, string> = {
  idle: 'Stopped',
  starting: 'Starting',
  live: 'Live',
  error: 'Error',
}

export function MirrorTab({ serial, title, active }: Props) {
  const toast = useToast()
  const mirror = useMirror(serial)
  const { canvasRef, status, error, waiting, size, fps, notice, blank, muted, setMuted, sendInput, start, stop } = mirror
  const capture = useCapture(title, mirror)
  // The detached window, while it is open. Only one session per phone can run,
  // so the tab stays idle while the mirror lives in the window.
  const [detached, setDetached] = useState<WebviewWindow | null>(null)

  useEffect(() => {
    if (!active) stop()
  }, [active, stop])

  const watch = useCallback((win: WebviewWindow) => {
    setDetached(win)
    void win.once('tauri://destroyed', () => setDetached((cur) => (cur === win ? null : cur)))
  }, [])

  // Re-attach if the window was opened before this tab mounted (e.g. after switching devices).
  useEffect(() => {
    void findMirrorWindow(serial).then((win) => win && watch(win))
  }, [serial, watch])

  const popOut = async () => {
    stop()
    try {
      watch(await openMirrorWindow(serial, `${title} - Mirror`))
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const running = status === 'starting' || status === 'live'
  const live = status === 'live'

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[auto_minmax(0,1fr)]">
      <Card className="flex items-center justify-center p-3 lg:min-w-0">
        <MirrorScreen
          canvasRef={canvasRef}
          live={live}
          sendInput={sendInput}
          className="h-auto max-h-[min(70vh,640px)] w-auto max-w-full rounded-xl"
        />
        {!live && (
          <div className="flex h-[min(70vh,640px)] w-[calc(min(70vh,640px)*9/19)] shrink-0 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-300 text-zinc-400 dark:border-zinc-700">
            <Smartphone size={32} />
            <p className="px-6 text-center text-xs">
              {detached
                ? 'Mirroring in a separate window'
                : status === 'starting'
                  ? 'Connecting to the phone...'
                  : 'The phone screen appears here'}
            </p>
          </div>
        )}
      </Card>

      <Card className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
            <MonitorPlay size={22} />
          </div>
          <div className="min-w-0 flex-1 basis-40">
            <h3 className="text-base font-semibold">Screen mirror</h3>
            <p className="text-xs text-zinc-500">Live view of this phone's display</p>
          </div>
          <Button onClick={detached ? () => void detached.close() : popOut} title="Show the mirror in its own window">
            {detached ? <ExternalLink size={16} /> : <PictureInPicture2 size={16} />}
            {detached ? 'Bring back' : 'Pop out'}
          </Button>
          {running ? (
            <Button onClick={stop}>
              <Square size={14} /> Stop
            </Button>
          ) : (
            <Button variant="primary" disabled={detached !== null} onClick={start}>
              <MonitorPlay size={16} /> Start
            </Button>
          )}
        </div>

        {status === 'error' && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm">{error}</p>
        )}
        {notice && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">{notice}</p>
        )}
        {blank && live && (
          <p className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm">{BLANK_HINT}</p>
        )}
        {waiting && status === 'starting' && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            Waiting for the first frame. If nothing appears, turn on and unlock the phone screen: Android sends no
            video while it is off.
          </p>
        )}

        <dl className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <InfoRow
            icon={<Radio size={15} />}
            label="Status"
            value={
              detached ? <Badge tone="blue">Separate window</Badge> : <Badge tone={statusTone[status]}>{statusLabel[status]}</Badge>
            }
          />
          <InfoRow
            icon={<Maximize2 size={15} />}
            label="Resolution"
            value={live && size ? `${size.width} × ${size.height}` : '-'}
          />
          <InfoRow icon={<Activity size={15} />} label="Frame rate" value={live ? `${fps} fps` : '-'} />
        </dl>

        <MirrorControls live={live} muted={muted} setMuted={setMuted} sendInput={sendInput} />
        <MirrorCapture
          live={live}
          capture={capture}
          sendInput={sendInput}
          getClipboard={mirror.getClipboard}
          canvasRef={canvasRef}
          macroRecording={mirror.macroRecording}
          startMacroRecording={mirror.startMacroRecording}
          stopMacroRecording={mirror.stopMacroRecording}
        />

        <p className="text-xs text-zinc-500">
          Click and drag on the screen to touch and swipe, scroll with the wheel, and type with the screen focused. While
          mirroring, the phone's own audio plays on this computer instead. Recordings go to your Videos folder and screenshots to Pictures, in an Appraiser folder. Mirroring stops automatically when you leave
          this tab, unless it is popped out. A still screen sends few frames, so the frame rate drops when nothing moves.
        </p>
      </Card>
    </div>
  )
}
