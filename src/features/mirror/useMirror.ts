import { useCallback, useEffect, useRef, useState } from 'react'
import { mirrorInput, startMirror, stopMirror, type MacroStep, type MirrorInput } from '../../lib/adb'

export type MirrorStatus = 'idle' | 'starting' | 'live' | 'error'

interface Session {
  decoder: VideoDecoder | null
  configKey: string
  needKey: boolean
  timestamp: number
  waitTimer: ReturnType<typeof setTimeout> | null
  fpsTimer: ReturnType<typeof setInterval> | null
  frames: number
  audio: AudioContext | null
  gain: GainNode | null
  audioTime: number
  /** Where audio is also sent while recording, so the recording has sound. */
  tap: MediaStreamAudioDestinationNode | null
}

const FRAME_US = 16_667

/** Average brightness (0-255) below which the picture counts as black. */
const BLACK_LEVEL = 3
/** Consecutive one-second checks that must be black before we call it blank. */
const BLACK_CHECKS = 2

/** Average brightness of a canvas, sampled from a tiny downscaled copy. */
function brightness(canvas: HTMLCanvasElement, probe: HTMLCanvasElement): number {
  const ctx = probe.getContext('2d', { willReadFrequently: true })
  if (!ctx) return 255
  ctx.drawImage(canvas, 0, 0, probe.width, probe.height)
  const { data } = ctx.getImageData(0, 0, probe.width, probe.height)
  let sum = 0
  for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3
  return sum / (data.length / 4)
}

/** Queues one chunk of 16-bit stereo PCM for playback. */
function playAudio(s: Session, pcm: Uint8Array) {
  const { audio, gain } = s
  if (!audio || !gain || audio.state === 'closed') return
  const frames = Math.floor(pcm.byteLength / 4)
  if (frames === 0) return
  const view = new DataView(pcm.buffer, pcm.byteOffset, frames * 4)
  const buffer = audio.createBuffer(2, frames, SAMPLE_RATE)
  const left = buffer.getChannelData(0)
  const right = buffer.getChannelData(1)
  for (let i = 0; i < frames; i++) {
    left[i] = view.getInt16(i * 4, true) / 32768
    right[i] = view.getInt16(i * 4 + 2, true) / 32768
  }
  const now = audio.currentTime
  if (s.audioTime < now + 0.01) s.audioTime = now + AUDIO_LEAD // underrun: re-sync
  if (s.audioTime > now + AUDIO_MAX_QUEUE) return // too far behind: drop
  const source = audio.createBufferSource()
  source.buffer = buffer
  source.connect(gain)
  if (s.tap) source.connect(s.tap)
  source.start(s.audioTime)
  s.audioTime += buffer.duration
}

const SAMPLE_RATE = 48000
/** Audio is scheduled this far ahead of playback to absorb network jitter. */
const AUDIO_LEAD = 0.06
/** Beyond this much queued audio we drop packets rather than lag further behind. */
const AUDIO_MAX_QUEUE = 0.4

const supported = typeof VideoDecoder !== 'undefined'

/** A recorded macro waits at most this long between two actions. */
const MACRO_MAX_GAP = 10_000
/** Pointer travel (as a fraction of the screen) below which a press is a tap, not a swipe. */
const TAP_SLOP = 0.02
const TAP_MAX_MS = 400
const MACRO_MAX_STEPS = 2000

interface MacroRecording {
  steps: MacroStep[]
  /** When the previous recorded action finished. */
  last: number
  down: { x: number; y: number; width: number; height: number; at: number } | null
}

/** Turns the inputs sent to the phone into replayable macro steps. */
function recordInput(rec: MacroRecording, input: MirrorInput, now: number) {
  if (rec.steps.length >= MACRO_MAX_STEPS) return
  const gap = () => {
    const g = Math.min(now - rec.last, MACRO_MAX_GAP)
    if (rec.last > 0 && g >= 50) rec.steps.push({ kind: 'wait', ms: Math.round(g) })
  }
  if (input.kind === 'touch') {
    if (input.action === 0) {
      rec.down = { x: input.x, y: input.y, width: input.width, height: input.height, at: now }
    } else if (input.action === 1 && rec.down) {
      const d = rec.down
      rec.down = null
      // The wait before an action runs from the last action's end to this one's start.
      const gapMs = Math.min(d.at - rec.last, MACRO_MAX_GAP)
      if (rec.last > 0 && gapMs >= 50) rec.steps.push({ kind: 'wait', ms: Math.round(gapMs) })
      const [x1, y1] = [d.x / d.width, d.y / d.height]
      const [x2, y2] = [input.x / input.width, input.y / input.height]
      const duration = now - d.at
      if (Math.hypot(x2 - x1, y2 - y1) < TAP_SLOP && duration < TAP_MAX_MS) {
        rec.steps.push({ kind: 'tap', x: x1, y: y1 })
      } else {
        rec.steps.push({ kind: 'swipe', x1, y1, x2, y2, duration_ms: Math.max(50, Math.round(duration)) })
      }
      rec.last = now
    }
  } else if (input.kind === 'key') {
    gap()
    rec.steps.push({ kind: 'key', keycode: input.keycode })
    rec.last = now
  } else if (input.kind === 'text') {
    const prev = rec.steps[rec.steps.length - 1]
    if (prev?.kind === 'text' && now - rec.last < 1500) prev.text += input.text
    else {
      gap()
      rec.steps.push({ kind: 'text', text: input.text })
    }
    rec.last = now
  }
}

export interface MacroResult {
  steps: MacroStep[]
  /** The phone was turned sideways while recording. */
  landscape: boolean
}

/** Decodes the device's H.264 stream (see `startMirror`) onto a canvas. */
export function useMirror(serial: string) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const session = useRef<Session | null>(null)
  const [status, setStatus] = useState<MirrorStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  // True when no frame arrived for a few seconds, usually a sleeping screen.
  const [waiting, setWaiting] = useState(false)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [fps, setFps] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  // The picture has been black for a while: usually Android hiding protected content.
  const [blank, setBlank] = useState(false)
  const [muted, setMutedState] = useState(false)
  const mutedRef = useRef(false)
  const macro = useRef<MacroRecording | null>(null)
  const [macroRecording, setMacroRecording] = useState(false)
  const clipboardWaiter = useRef<((text: string) => void) | null>(null)
  const sizeRef = useRef<{ width: number; height: number } | null>(null)

  const teardown = useCallback(() => {
    const s = session.current
    session.current = null
    if (!s) return
    if (s.waitTimer) clearTimeout(s.waitTimer)
    if (s.fpsTimer) clearInterval(s.fpsTimer)
    if (s.decoder && s.decoder.state !== 'closed') s.decoder.close()
    s.audio?.close().catch(() => {})
  }, [])

  const stop = useCallback(() => {
    teardown()
    stopMirror(serial).catch(() => {})
    setStatus('idle')
    setWaiting(false)
    setFps(0)
    setBlank(false)
    macro.current = null
    setMacroRecording(false)
  }, [serial, teardown])

  const fail = useCallback(
    (message: string) => {
      teardown()
      stopMirror(serial).catch(() => {})
      setError(message)
      setStatus('error')
      setWaiting(false)
      setFps(0)
      setBlank(false)
    },
    [serial, teardown],
  )

  const start = useCallback(async () => {
    if (!supported) {
      fail('This system webview does not support video decoding (WebCodecs).')
      return
    }
    teardown()
    const s: Session = { decoder: null, configKey: '', needKey: true, timestamp: 0, waitTimer: null, fpsTimer: null, frames: 0, audio: null, gain: null, audioTime: 0, tap: null }
    session.current = s
    setError(null)
    setNotice(null)
    setStatus('starting')
    setWaiting(false)
    s.waitTimer = setTimeout(() => session.current === s && setWaiting(true), 3000)
    // Created here, inside the click that started mirroring, so the browser allows sound.
    try {
      s.audio = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' })
      s.gain = s.audio.createGain()
      s.gain.gain.value = mutedRef.current ? 0 : 1
      s.gain.connect(s.audio.destination)
    } catch {
      s.audio = null
    }
    const probe = document.createElement('canvas')
    probe.width = probe.height = 16
    let blackChecks = 0
    s.fpsTimer = setInterval(() => {
      setFps(s.frames)
      s.frames = 0
      const canvas = canvasRef.current
      if (canvas && canvas.width > 0) {
        blackChecks = brightness(canvas, probe) < BLACK_LEVEL ? blackChecks + 1 : 0
        setBlank(blackChecks >= BLACK_CHECKS)
      }
    }, 1000)

    const draw = (frame: VideoFrame) => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (canvas && ctx && session.current === s) {
        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth
          canvas.height = frame.displayHeight
          sizeRef.current = { width: frame.displayWidth, height: frame.displayHeight }
          setSize(sizeRef.current)
        }
        ctx.drawImage(frame, 0, 0)
        s.frames++
        setStatus((cur) => (cur === 'starting' ? 'live' : cur))
        setWaiting(false)
      }
      frame.close()
    }

    const onMessage = (raw: ArrayBuffer) => {
      if (session.current !== s) return
      const msg = new Uint8Array(raw)
      switch (msg[0]) {
        case 0: {
          const codecLen = msg[1]
          const codec = new TextDecoder().decode(msg.subarray(2, 2 + codecLen))
          const description = msg.slice(2 + codecLen)
          const configKey = `${codec}:${description.join(',')}`
          if (configKey === s.configKey) return // same stream restarted
          s.configKey = configKey
          if (s.decoder && s.decoder.state !== 'closed') s.decoder.close()
          s.decoder = new VideoDecoder({
            output: draw,
            error: (e) => session.current === s && fail(String(e.message ?? e)),
          })
          s.decoder.configure({ codec, description, optimizeForLatency: true })
          s.needKey = true
          break
        }
        case 1: {
          const key = msg[1] === 1
          if (!s.decoder || s.decoder.state !== 'configured') return
          if (s.needKey && !key) return
          s.needKey = false
          s.timestamp += FRAME_US
          s.decoder.decode(
            new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: s.timestamp, data: msg.subarray(2) }),
          )
          break
        }
        case 2:
          fail(new TextDecoder().decode(msg.subarray(1)))
          break
        case 3:
          playAudio(s, msg.subarray(1))
          break
        case 4:
          setNotice(new TextDecoder().decode(msg.subarray(1)))
          break
        case 5:
          clipboardWaiter.current?.(new TextDecoder().decode(msg.subarray(1)))
          clipboardWaiter.current = null
          break
      }
    }

    try {
      await startMirror(serial, onMessage)
    } catch (e) {
      fail(String(e))
    }
  }, [serial, teardown, fail])

  const setMuted = useCallback((value: boolean) => {
    mutedRef.current = value
    setMutedState(value)
    const s = session.current
    if (s?.gain) s.gain.gain.value = value ? 0 : 1
  }, [])

  const sendInput = useCallback(
    (input: MirrorInput) => {
      if (!session.current) return
      if (macro.current) recordInput(macro.current, input, performance.now())
      mirrorInput(serial, input).catch(() => {})
    },
    [serial],
  )

  /** The phone's clipboard text. */
  const getClipboard = useCallback(
    () =>
      new Promise<string>((resolve, reject) => {
        if (!session.current) return reject(new Error('Mirroring is not running'))
        clipboardWaiter.current = resolve
        mirrorInput(serial, { kind: 'get_clipboard' }).catch(reject)
        setTimeout(() => {
          if (clipboardWaiter.current === resolve) {
            clipboardWaiter.current = null
            reject(new Error('The phone did not answer'))
          }
        }, 2000)
      }),
    [serial],
  )

  /** Video of the screen plus the phone's audio, for recording. Call `releaseStream` when done. */
  const captureStream = useCallback((): MediaStream | null => {
    const s = session.current
    const canvas = canvasRef.current
    if (!s || !canvas) return null
    const stream = canvas.captureStream()
    if (s.audio && !s.tap) {
      s.tap = s.audio.createMediaStreamDestination()
    }
    s.tap?.stream.getAudioTracks().forEach((t) => stream.addTrack(t))
    return stream
  }, [])

  const releaseStream = useCallback(() => {
    if (session.current) session.current.tap = null
  }, [])

  const startMacroRecording = useCallback(() => {
    macro.current = { steps: [], last: 0, down: null }
    setMacroRecording(true)
  }, [])

  const stopMacroRecording = useCallback((): MacroResult => {
    const steps = macro.current?.steps ?? []
    macro.current = null
    setMacroRecording(false)
    const size = sizeRef.current
    return { steps, landscape: size ? size.width > size.height : false }
  }, [])

  // Stop streaming when the component goes away.
  useEffect(() => () => void (session.current && stop()), [stop])

  return {
    canvasRef,
    status,
    error,
    waiting,
    size,
    fps,
    notice,
    blank,
    muted,
    setMuted,
    sendInput,
    start,
    stop,
    getClipboard,
    captureStream,
    releaseStream,
    macroRecording,
    startMacroRecording,
    stopMacroRecording,
  }
}
