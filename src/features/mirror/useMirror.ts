import { useCallback, useEffect, useRef, useState } from 'react'
import { mirrorInput, startMirror, stopMirror, type MirrorInput } from '../../lib/adb'

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
}

const FRAME_US = 16_667

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
  source.start(s.audioTime)
  s.audioTime += buffer.duration
}

const SAMPLE_RATE = 48000
/** Audio is scheduled this far ahead of playback to absorb network jitter. */
const AUDIO_LEAD = 0.06
/** Beyond this much queued audio we drop packets rather than lag further behind. */
const AUDIO_MAX_QUEUE = 0.4

const supported = typeof VideoDecoder !== 'undefined'

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
  const [muted, setMutedState] = useState(false)
  const mutedRef = useRef(false)

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
  }, [serial, teardown])

  const fail = useCallback(
    (message: string) => {
      teardown()
      stopMirror(serial).catch(() => {})
      setError(message)
      setStatus('error')
      setWaiting(false)
      setFps(0)
    },
    [serial, teardown],
  )

  const start = useCallback(async () => {
    if (!supported) {
      fail('This system webview does not support video decoding (WebCodecs).')
      return
    }
    teardown()
    const s: Session = { decoder: null, configKey: '', needKey: true, timestamp: 0, waitTimer: null, fpsTimer: null, frames: 0, audio: null, gain: null, audioTime: 0 }
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
    s.fpsTimer = setInterval(() => {
      setFps(s.frames)
      s.frames = 0
    }, 1000)

    const draw = (frame: VideoFrame) => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (canvas && ctx && session.current === s) {
        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth
          canvas.height = frame.displayHeight
          setSize({ width: frame.displayWidth, height: frame.displayHeight })
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
      if (session.current) mirrorInput(serial, input).catch(() => {})
    },
    [serial],
  )

  // Stop streaming when the component goes away.
  useEffect(() => () => void (session.current && stop()), [stop])

  return { canvasRef, status, error, waiting, size, fps, notice, muted, setMuted, sendInput, start, stop }
}
