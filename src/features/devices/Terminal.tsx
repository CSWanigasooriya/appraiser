import { useEffect, useRef, useState } from 'react'
import { runShell } from '../../lib/adb'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'

interface Entry {
  command: string
  output: string
}

export function Terminal({ serial }: { serial: string }) {
  const [command, setCommand] = useState('')
  const [history, setHistory] = useState<Entry[]>([])
  const [running, setRunning] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [history])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cmd = command.trim()
    if (!cmd || running) return
    setCommand('')
    setRunning(true)
    let output: string
    try {
      output = await runShell(serial, cmd)
    } catch (err) {
      output = String(err)
    }
    setHistory((h) => [...h, { command: cmd, output }])
    setRunning(false)
  }

  return (
    <div className="flex min-h-64 flex-1 flex-col gap-3">
      <div className="min-h-0 flex-1 overflow-auto rounded-xl bg-zinc-950 p-4 font-mono text-xs text-zinc-200">
        {history.length === 0 && (
          <p className="text-zinc-500">Run a command on the device, e.g. pm list packages</p>
        )}
        {history.map((h, i) => (
          <div key={i} className="mb-3">
            <div className="text-green-400">$ {h.command}</div>
            <pre className="whitespace-pre-wrap">{h.output}</pre>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form onSubmit={submit} className="flex gap-2">
        <Input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="Enter a shell command"
          className="font-mono"
          autoFocus
        />
        <Button variant="primary" disabled={running || !command.trim()}>
          {running ? 'Running...' : 'Run'}
        </Button>
      </form>
    </div>
  )
}
