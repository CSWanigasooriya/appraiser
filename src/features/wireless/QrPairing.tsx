import { useEffect, useState } from 'react'
import { cancelQrPairing, finishQrPairing, startQrPairing, type QrSession } from '../../lib/adb'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/toast'

export function QrPairing({ onDone }: { onDone: () => void }) {
  const toast = useToast()
  const [session, setSession] = useState<QrSession | null>(null)

  // Stop waiting for a scan if the dialog is closed.
  useEffect(
    () => () => {
      void cancelQrPairing()
    },
    [],
  )

  const start = async () => {
    try {
      const s = await startQrPairing()
      setSession(s)
      await finishQrPairing(s.name, s.password)
      toast('Paired. The device should appear shortly.')
      onDone()
    } catch (e) {
      const text = String(e)
      if (text !== 'Cancelled') toast(text, 'error')
    } finally {
      setSession(null)
    }
  }

  return (
    <div className="grid justify-items-center gap-4 text-center">
      <p className="text-sm text-zinc-500">
        On the phone open Developer options, Wireless debugging, then Pair device with QR code.
        Android 11 or newer.
      </p>
      {session ? (
        <>
          <img
            className="size-56 rounded-lg"
            alt="Pairing QR code"
            src={`data:image/svg+xml;utf8,${encodeURIComponent(session.svg)}`}
          />
          <p className="text-sm text-zinc-500">Waiting for the phone to scan...</p>
          <Button
            onClick={() => {
              cancelQrPairing()
              setSession(null)
            }}
          >
            Cancel
          </Button>
        </>
      ) : (
        <Button variant="primary" onClick={start}>
          Show QR code
        </Button>
      )}
    </div>
  )
}
