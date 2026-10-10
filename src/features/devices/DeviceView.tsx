import {
  Activity,
  Battery,
  FolderOpen,
  LayoutDashboard,
  MonitorPlay,
  Package,
  ScanSearch,
  ScrollText,
  SquareTerminal,
  Usb,
  Wifi,
  Workflow,
  Wrench,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { deviceInfo, isWireless, type Device, type DeviceInfo } from '../../lib/adb'
import { Badge } from '../../components/ui/Badge'
import { Tabs } from '../../components/ui/Tabs'
import { useToast } from '../../components/ui/toast'
import { AppsTab } from '../apps/AppsTab'
import { AutomationTab } from '../automation/AutomationTab'
import { FilesTab } from '../files/FilesTab'
import { InspectorTab } from '../inspector/InspectorTab'
import { LogcatTab } from '../logcat/LogcatTab'
import { MirrorTab } from '../mirror/MirrorTab'
import { PerformanceTab } from '../performance/PerformanceTab'
import { ToolsTab } from '../tools/ToolsTab'
import { Overview } from './Overview'
import { Terminal } from './Terminal'

type Tab = 'overview' | 'apps' | 'files' | 'mirror' | 'inspector' | 'perf' | 'logs' | 'terminal' | 'automation' | 'tools'

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
    <div className={`mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6 ${tab === 'logs' ? 'h-full' : 'min-h-full'}`}>
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
              { id: 'files', label: 'Files', icon: <FolderOpen size={16} /> },
              { id: 'mirror', label: 'Mirror', icon: <MonitorPlay size={16} /> },
              { id: 'inspector', label: 'Inspector', icon: <ScanSearch size={16} /> },
              { id: 'perf', label: 'Performance', icon: <Activity size={16} /> },
              { id: 'logs', label: 'Logs', icon: <ScrollText size={16} /> },
              { id: 'terminal', label: 'Shell', icon: <SquareTerminal size={16} /> },
              { id: 'automation', label: 'Automation', icon: <Workflow size={16} /> },
              { id: 'tools', label: 'Tools', icon: <Wrench size={16} /> },
            ]}
          />
          <div hidden={tab !== 'overview'}>
            <Overview device={device} info={info} wireless={wireless} />
          </div>
          {visited.has('apps') && (
            <div hidden={tab !== 'apps'}>
              <AppsTab serial={device.serial} active={tab === 'apps'} />
            </div>
          )}
          {visited.has('files') && (
            <div className={tab === 'files' ? '' : 'hidden'}>
              <FilesTab serial={device.serial} active={tab === 'files'} />
            </div>
          )}
          {visited.has('mirror') && (
            <div className={tab === 'mirror' ? '' : 'hidden'}>
              <MirrorTab serial={device.serial} title={device.model ?? device.serial} active={tab === 'mirror'} />
            </div>
          )}
          {visited.has('inspector') && (
            <div className={tab === 'inspector' ? '' : 'hidden'}>
              <InspectorTab serial={device.serial} active={tab === 'inspector'} />
            </div>
          )}
          {visited.has('perf') && (
            <div className={tab === 'perf' ? '' : 'hidden'}>
              <PerformanceTab serial={device.serial} active={tab === 'perf'} />
            </div>
          )}
          {visited.has('logs') && (
            <div className={tab === 'logs' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
              <LogcatTab serial={device.serial} />
            </div>
          )}
          {visited.has('terminal') && (
            <div className={tab === 'terminal' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
              <Terminal serial={device.serial} />
            </div>
          )}
          {visited.has('automation') && (
            <div className={tab === 'automation' ? '' : 'hidden'}>
              <AutomationTab serial={device.serial} />
            </div>
          )}
          {visited.has('tools') && (
            <div className={tab === 'tools' ? '' : 'hidden'}>
              <ToolsTab serial={device.serial} active={tab === 'tools'} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
