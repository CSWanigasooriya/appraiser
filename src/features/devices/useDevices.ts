import { useEffect, useState } from 'react'
import { listDevices, onDevicesChanged, type Device } from '../../lib/adb'

export function useDevices() {
  const [devices, setDevices] = useState<Device[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listDevices()
      .then(setDevices)
      .catch((e) => setError(String(e)))

    const unlisten = onDevicesChanged((r) => {
      if ('devices' in r) {
        setDevices(r.devices)
        setError(null)
      } else {
        setError(r.error)
      }
    })
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  return { devices, error }
}
