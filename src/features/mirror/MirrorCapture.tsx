import { Camera, ClipboardCopy, ClipboardPaste, ClipboardType, Clapperboard, Copy, Square, Video } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { cn } from '../../components/ui/cn'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import { useToast } from '../../components/ui/toast'
import type { MirrorInput } from '../../lib/adb'
import { newId, useMacros } from '../automation/store'
import type { useCapture } from './useCapture'
import type { MacroResult } from './useMirror'

interface Props {
  live: boolean
  capture: ReturnType<typeof useCapture>
  sendInput: (input: MirrorInput) => void
  getClipboard: () => Promise<string>
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  macroRecording: boolean
  startMacroRecording: () => void
  stopMacroRecording: () => MacroResult
  /** Icon-only buttons, for the narrow detached window. */
  compact?: boolean
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/** Screenshot, recording, clipboard and macro-recording buttons for the mirror. */
export function MirrorCapture({
  live,
  capture,
  sendInput,
  getClipboard,
  canvasRef,
  macroRecording,
  startMacroRecording,
  stopMacroRecording,
  compact,
}: Props) {
  const toast = useToast()
  const [, setMacros] = useMacros()
  const [sync, setSync] = useState(false)
  const [naming, setNaming] = useState<MacroResult | null>(null)
  const [macroName, setMacroName] = useState('')
  const lastSynced = useRef('')

  const pasteToPhone = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text) return toast('Your clipboard has no text', 'error')
      sendInput({ kind: 'clipboard', text, paste: true })
    } catch {
      toast('Could not read your clipboard', 'error')
    }
  }

  const copyFromPhone = async () => {
    try {
      const text = await getClipboard()
      if (!text) return toast('The phone clipboard is empty', 'error')
      await navigator.clipboard.writeText(text)
      toast('Copied the phone clipboard')
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'error')
    }
  }

  // Sync: your clipboard goes to the phone when you click into the screen, and the phone's comes back when you leave it.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!sync || !live || !canvas) return
    const onFocus = () => {
      navigator.clipboard
        .readText()
        .then((text) => {
          if (text && text !== lastSynced.current) {
            lastSynced.current = text
            sendInput({ kind: 'clipboard', text, paste: false })
          }
        })
        .catch(() => {})
    }
    const onBlur = () => {
      getClipboard()
        .then((text) => {
          if (text && text !== lastSynced.current) {
            lastSynced.current = text
            return navigator.clipboard.writeText(text)
          }
        })
        .catch(() => {})
    }
    canvas.addEventListener('focus', onFocus)
    canvas.addEventListener('blur', onBlur)
    return () => {
      canvas.removeEventListener('focus', onFocus)
      canvas.removeEventListener('blur', onBlur)
    }
  }, [sync, live, canvasRef, sendInput, getClipboard])

  const finishMacro = () => {
    const result = stopMacroRecording()
    if (result.steps.length === 0) return toast('Nothing was recorded', 'error')
    setMacroName('')
    setNaming(result)
  }

  const saveMacro = () => {
    if (!naming) return
    const name = macroName.trim() || `Macro ${new Date().toLocaleTimeString()}`
    setMacros((all) => [...all, { id: newId(), name, steps: naming.steps, landscape: naming.landscape }])
    setNaming(null)
    toast(`Saved "${name}" in Automation`)
  }

  const label = (text: string) => !compact && text

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled={!live} onClick={() => void capture.screenshot()} title="Save a screenshot">
        <Camera size={16} /> {label('Screenshot')}
      </Button>
      <Button disabled={!live} onClick={() => void capture.copyScreenshot()} title="Copy a screenshot">
        <Copy size={16} />
      </Button>
      {capture.recording ? (
        <Button variant="danger" onClick={capture.stopRecording} title="Stop recording">
          <Square size={14} /> {clock(capture.seconds)}
        </Button>
      ) : (
        <Button disabled={!live} onClick={capture.startRecording} title="Record the screen with sound">
          <Video size={16} /> {label('Record')}
        </Button>
      )}
      <div className="mx-1 h-6 w-px bg-zinc-200 dark:bg-zinc-800" />
      <Button disabled={!live} onClick={() => void pasteToPhone()} title="Paste your clipboard text into the phone">
        <ClipboardPaste size={16} /> {label('Paste')}
      </Button>
      <Button disabled={!live} onClick={() => void copyFromPhone()} title="Copy the phone's clipboard to this computer">
        <ClipboardCopy size={16} />
      </Button>
      <Button
        disabled={!live}
        onClick={() => setSync((s) => !s)}
        aria-pressed={sync}
        title="Keep both clipboards in sync while using the screen"
        className={cn(sync && 'border-blue-500 text-blue-600 dark:border-blue-400 dark:text-blue-400')}
      >
        <ClipboardType size={16} /> {label(sync ? 'Sync on' : 'Sync')}
      </Button>
      <div className="mx-1 h-6 w-px bg-zinc-200 dark:bg-zinc-800" />
      {macroRecording ? (
        <Button variant="danger" onClick={finishMacro} title="Stop recording the macro">
          <Square size={14} /> {label('Stop macro')}
        </Button>
      ) : (
        <Button disabled={!live} onClick={startMacroRecording} title="Record your taps, swipes and typing as a macro">
          <Clapperboard size={16} /> {label('Record macro')}
        </Button>
      )}

      <Dialog open={naming !== null} onClose={() => setNaming(null)} title="Save macro">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            saveMacro()
          }}
          className="grid gap-4"
        >
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Recorded {naming?.steps.length} steps. Replay it any time from the Automation tab.
          </p>
          <Input value={macroName} onChange={(e) => setMacroName(e.target.value)} placeholder="Macro name" autoFocus />
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setNaming(null)}>
              Discard
            </Button>
            <Button variant="primary">Save</Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
