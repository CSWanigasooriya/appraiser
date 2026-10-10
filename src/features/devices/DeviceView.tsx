import { Battery, LayoutDashboard, Package, SquareTerminal, Usb, Wifi } from 'lucide-react'
import { useEffect, useState } from 'react'
import { deviceInfo, isWireless, type Device, type DeviceInfo } from '../../lib/adb'
import { Badge } from '../../components/ui/Badge'
import { Tabs } from '../../components/ui/Tabs'
import { useToast } from '../../components/ui/toast'
import { AppsTab } from '../apps/AppsTab'
import { Overview } from './Overview'
import { Terminal } from './Terminal'

type Tab = 'overview' | 'apps' | 'terminal'

export function DeviceView({ device }: { device: Device }) {
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('overview')
  // Tabs mount on first visit and stay mounted (hidden), so switching back
  // keeps their state instead of reloading apps or clearing the shell.
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set<Tab>(['overview']))
  const selectTab = (t: Tab) => {
    setTab(t)
    setVisited((v) => (v.has(t) ? v : new Set(v).add(t)))
  }
  const [info, setInfo] = useState<DeviceInfo | null>(null)
  const ready = device.state === 'online'
  const wireless = isWireless(device.serial)

  useEffect(() => {
    if (!ready) return
    deviceInfo(device.serial)
      .then(setInfo)
      .catch((e) => toast(String(e), 'error'))
  }, [device.serial, ready, toast])

  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col gap-5 p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">{device.model ?? device.serial}</h2>
        <Badge tone={ready ? 'green' : 'amber'}>{device.state}</Badge>
        <Badge tone="blue">
          {wireless ? <Wifi size={12} /> : <Usb size={12} />}
          {wireless ? 'Wi-Fi' : 'USB'}
        </Badge>
        {info?.battery_level != null && (
          <Badge>
            <Battery size={12} /> {info.battery_level}%
          </Badge>
        )}
      </header>

      {!ready ? (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          This device is {device.state}.{' '}
          {device.state === 'unauthorized' &&
            'Accept the "Allow USB debugging" prompt on the phone.'}
        </p>
      ) : (
        <>
          <Tabs
            value={tab}
            onChange={selectTab}
            tabs={[
              { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={16} /> },
              { id: 'apps', label: 'Apps', icon: <Package size={16} /> },
              { id: 'terminal', label: 'Shell', icon: <SquareTerminal size={16} /> },
            ]}
          />
          <div hidden={tab !== 'overview'}>
            <Overview device={device} info={info} wireless={wireless} />
          </div>
          {visited.has('apps') && (
            <div hidden={tab !== 'apps'}>
              <AppsTab serial={device.serial} />
            </div>
          )}
          {visited.has('terminal') && (
            <div hidden={tab !== 'terminal'}>
              <Terminal serial={device.serial} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
