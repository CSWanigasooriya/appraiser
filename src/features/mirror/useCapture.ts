import { useCallback, useEffect, useRef, useState } from 'react'
import { saveMedia } from '../../lib/adb'
import { copyPng, fileSafe, stamp } from '../../lib/format'
import { useToast } from '../../components/ui/toast'
import type { MirrorStatus } from './useMirror'

const RECORDING_TYPES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

const recordingType = () =>
  typeof MediaRecorder === 'undefined' ? undefined : RECORDING_TYPES.find((t) => MediaRecorder.isTypeSupported(t))

interface Source {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  status: MirrorStatus
  captureStream: () => MediaStream | null
  releaseStream: () => void
}

const canvasPng = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The screen is empty'))), 'image/png'),
  )

/** Screenshots and screen recordings of the mirror, saved on this computer. */
export function useCapture(name: string, { canvasRef, status, captureStream, releaseStream }: Source) {
  const toast = useToast()
  const base = fileSafe(name)
  const recorder = useRef<MediaRecorder | null>(null)
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)

  const screenshot = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas || canvas.width === 0) return
    try {
      const png = await canvasPng(canvas)
      const path = await saveMedia('screenshot', `${base}-${stamp()}.png`, await png.arrayBuffer())
      toast(`Saved to ${path}`)
    } catch (e) {
      toast(String(e), 'error')
    }
  }, [canvasRef, base, toast])

  const copyScreenshot = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas || canvas.width === 0) return
    try {
      await copyPng(await canvasPng(canvas))
      toast('Screenshot copied')
    } catch (e) {
      toast(String(e), 'error')
    }
  }, [canvasRef, toast])

  const stopRecording = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }, [])

  const startRecording = useCallback(() => {
    const type = recordingType()
    const stream = captureStream()
    if (!stream || !type) {
      toast('This system webview cannot record video.', 'error')
      return
    }
    const chunks: Blob[] = []
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 })
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data)
    rec.onstop = () => {
      recorder.current = null
      releaseStream()
      stream.getTracks().forEach((t) => t.stop())
      setRecording(false)
      const ext = type.startsWith('video/mp4') ? 'mp4' : 'webm'
      void new Blob(chunks, { type })
        .arrayBuffer()
        .then((data) => saveMedia('recording', `${base}-${stamp()}.${ext}`, data))
        .then((path) => toast(`Recording saved to ${path}`))
        .catch((e) => toast(String(e), 'error'))
    }
    recorder.current = rec
    rec.start(1000)
    setSeconds(0)
    setRecording(true)
  }, [captureStream, releaseStream, base, toast])

  useEffect(() => {
    if (!recording) return
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [recording])

  // A recording ends with the stream: save what there is.
  useEffect(() => {
    if (status !== 'live') stopRecording()
  }, [status, stopRecording])
  useEffect(() => stopRecording, [stopRecording])

  return { screenshot, copyScreenshot, recording, seconds, startRecording, stopRecording }
}
