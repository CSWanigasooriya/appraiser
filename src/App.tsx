import { Smartphone } from 'lucide-react'
import { useState } from 'react'
import { Button } from './components/ui/Button'
import { ToastProvider } from './components/ui/toast'
import { DeviceView } from './features/devices/DeviceView'
import { Sidebar } from './features/devices/Sidebar'
import { useDevices } from './features/devices/useDevices'
import { AddDeviceDialog } from './features/wireless/AddDeviceDialog'

export default function App() {
  const { devices, error } = useDevices()
  const [selected, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  // Fall back to the first device so something useful is always on screen.
  const device = devices.find((d) => d.serial === selected) ?? devices[0]

  return (
    <ToastProvider>
      <div className="flex h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <Sidebar
          devices={devices}
          error={error}
          selected={device?.serial ?? null}
          onSelect={setSelected}
          onAdd={() => setAdding(true)}
        />
        <main className="flex-1 overflow-y-auto">
          {device ? (
            <DeviceView key={device.serial} device={device} />
          ) : (
            <div className="grid h-full place-items-center p-6 text-center">
              <div className="grid justify-items-center gap-3">
                <Smartphone size={40} className="text-zinc-400" />
                <h2 className="text-lg font-semibold">No device connected</h2>
                <p className="max-w-xs text-sm text-zinc-500">
                  Plug in a phone with USB debugging enabled, start an emulator, or connect over
                  Wi-Fi.
                </p>
                <Button variant="primary" onClick={() => setAdding(true)}>
                  Add device
                </Button>
              </div>
            </div>
          )}
        </main>
        <AddDeviceDialog open={adding} onClose={() => setAdding(false)} />
      </div>
    </ToastProvider>
  )
}
