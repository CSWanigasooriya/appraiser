import { ArrowLeft, Circle, Layers, Power, Volume2, VolumeX } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '../../components/ui/Button'
import type { MirrorInput } from '../../lib/adb'
import { KEY } from './keys'

interface Props {
  live: boolean
  muted: boolean
  setMuted: (muted: boolean) => void
  sendInput: (input: MirrorInput) => void
  /** Show the sound toggle as an icon only. */
  compact?: boolean
  /** Extra controls placed at the end of the row. */
  children?: ReactNode
}

/** Android navigation, volume and power buttons, plus the computer-audio mute toggle. */
export function MirrorControls({ live, muted, setMuted, sendInput, compact, children }: Props) {
  const press = (keycode: number) => sendInput({ kind: 'key', keycode })

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled={!live} onClick={() => press(KEY.back)} title="Back">
        <ArrowLeft size={16} />
      </Button>
      <Button disabled={!live} onClick={() => press(KEY.home)} title="Home">
        <Circle size={16} />
      </Button>
      <Button disabled={!live} onClick={() => press(KEY.recents)} title="Recent apps">
        <Layers size={16} />
      </Button>
      <div className="mx-1 h-6 w-px bg-zinc-200 dark:bg-zinc-800" />
      <Button disabled={!live} onClick={() => press(KEY.volumeDown)} title="Volume down">
        <Volume2 size={16} className="opacity-60" />
      </Button>
      <Button disabled={!live} onClick={() => press(KEY.volumeUp)} title="Volume up">
        <Volume2 size={16} />
      </Button>
      <Button disabled={!live} onClick={() => press(KEY.power)} title="Power / lock screen">
        <Power size={16} />
      </Button>
      <div className="flex-1" />
      <Button onClick={() => setMuted(!muted)} title={muted ? 'Unmute computer audio' : 'Mute computer audio'}>
        {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        {!compact && (muted ? 'Muted' : 'Sound on')}
      </Button>
      {children}
    </div>
  )
}
