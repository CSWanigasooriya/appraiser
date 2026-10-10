import { Bug, Check, FolderOpen } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { InfoRow } from '../../components/ui/InfoRow'
import { useToast } from '../../components/ui/toast'
import { captureDiagnostics, type Capture } from '../../lib/adb'
import { stamp } from '../../lib/format'

/** One click to collect a bug report, crash and ANR reports and the log into a folder. */
export function BugReport({ serial }: { serial: string }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Capture | null>(null)

  const capture = async () => {
    setBusy(true)
    setResult(null)
    try {
      const done = await captureDiagnostics(serial, stamp())
      setResult(done)
      toast(`Saved to ${done.dir}`)
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4">
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
            <Bug size={22} />
          </div>
          <div className="min-w-0 flex-1 basis-40">
            <h3 className="text-base font-semibold">Capture a bug report</h3>
            <p className="text-xs text-zinc-500">
              Saves the full Android bug report, crash and ANR reports, and the current log to a new folder in Downloads.
            </p>
          </div>
          <Button variant="primary" disabled={busy} onClick={() => void capture()}>
            <FolderOpen size={16} /> {busy ? 'Collecting...' : 'Capture'}
          </Button>
        </div>
        {busy && (
          <p className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm">
            Collecting everything. The full bug report takes a minute or two, and the phone may feel sluggish meanwhile.
          </p>
        )}
      </Card>

      {result && (
        <Card className="flex flex-col gap-3">
          <dl className="text-sm">
            <InfoRow label="Folder" value={result.dir} mono copyable />
          </dl>
          <ul className="grid gap-1 text-sm">
            {result.files.map((f) => (
              <li key={f} className="flex items-center gap-2">
                <Check size={14} className="text-green-600" /> {f}
              </li>
            ))}
          </ul>
          {result.skipped.length > 0 && (
            <ul className="grid gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              {result.skipped.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}
