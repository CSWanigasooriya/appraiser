import { BatteryCharging, Bug, Globe, RotateCcw, Rocket, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Tabs } from '../../components/ui/Tabs'
import { useToast } from '../../components/ui/toast'
import { listForwards, removeForward, resetBattery, resetDevSettings, setProxy } from '../../lib/adb'
import { BatterySim } from './BatterySim'
import { BugReport } from './BugReport'
import { DeveloperSettings } from './DeveloperSettings'
import { IntentTester } from './IntentTester'
import { NetworkTools } from './NetworkTools'

type Section = 'intents' | 'developer' | 'network' | 'battery' | 'report'

/** Developer tools that don't need a screen of their own. */
export function ToolsTab({ serial, active }: { serial: string; active: boolean }) {
  const toast = useToast()
  const [section, setSection] = useState<Section>('intents')
  const [confirming, setConfirming] = useState(false)
  const [resetting, setResetting] = useState(false)
  // Changing this remounts the sections, so they re-read what the phone now has.
  const [version, setVersion] = useState(0)

  const resetAll = async () => {
    setConfirming(false)
    setResetting(true)
    const forwards = await listForwards(serial).catch(() => [])
    const steps = [
      resetDevSettings(serial),
      resetBattery(serial),
      setProxy(serial, null),
      ...forwards.map((f) => removeForward(serial, f.reverse, f.from)),
    ]
    const failed = (await Promise.allSettled(steps)).filter((r) => r.status === 'rejected')
    setResetting(false)
    setVersion((v) => v + 1)
    if (failed.length === 0) toast('Tools are back to their defaults')
    else toast(`Reset finished, but ${failed.length} step${failed.length === 1 ? '' : 's'} failed: ${String(failed[0].reason)}`, 'error')
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <Tabs
            value={section}
            onChange={setSection}
            variant="pill"
            tabs={[
              { id: 'intents', label: 'Intents', icon: <Rocket size={16} /> },
              { id: 'developer', label: 'Developer settings', icon: <SlidersHorizontal size={16} /> },
              { id: 'network', label: 'Network', icon: <Globe size={16} /> },
              { id: 'battery', label: 'Battery', icon: <BatteryCharging size={16} /> },
              { id: 'report', label: 'Bug report', icon: <Bug size={16} /> },
            ]}
          />
        </div>
        <Button disabled={resetting} onClick={() => setConfirming(true)} title="Put every tool back to its default">
          <RotateCcw size={16} /> <span className="max-sm:sr-only">{resetting ? 'Resetting...' : 'Reset to default'}</span>
        </Button>
      </div>
      {/* Sections load their data when shown, so only the open one (of an open tab) is mounted. */}
      {active && section === 'intents' && <IntentTester key={version} serial={serial} />}
      {active && section === 'developer' && <DeveloperSettings key={version} serial={serial} />}
      {active && section === 'network' && <NetworkTools key={version} serial={serial} />}
      {active && section === 'battery' && <BatterySim key={version} serial={serial} />}
      {section === 'report' && <BugReport serial={serial} />}

      <Dialog open={confirming} onClose={() => setConfirming(false)} title="Reset to default">
        <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">This puts the phone back to normal:</p>
        <ul className="mb-5 list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
          <li>Developer settings: overlays off, animations, font size, dark mode, density and resolution reset</li>
          <li>Battery: shows the real battery again</li>
          <li>Network: the proxy is cleared and every forwarded port is removed</li>
        </ul>
        <p className="mb-5 text-xs text-zinc-500">Wi-Fi, mobile data and airplane mode stay as they are.</p>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => void resetAll()}>
            Reset
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
