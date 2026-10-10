import { ChevronDown, ChevronRight, Copy, Crosshair, RefreshCw, ScanSearch, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card, CardTitle } from '../../components/ui/Card'
import { cn } from '../../components/ui/cn'
import { InfoRow } from '../../components/ui/InfoRow'
import { Input } from '../../components/ui/Input'
import { useToast } from '../../components/ui/toast'
import { BLANK_HINT } from '../mirror/blankHint'
import { dumpUi, runShell, screenshot } from '../../lib/adb'
import { centerOf, labelOf, matches, nodeAt, parseHierarchy, xpathOf, type Hierarchy, type UiNode } from './parse'

/** True when the screenshot is (nearly) all black: the screen is off, or Android is hiding protected content. */
function useDarkImage(image: string | null): boolean {
  const [result, setResult] = useState<{ image: string; dark: boolean } | null>(null)
  useEffect(() => {
    if (!image) return
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 24
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(img, 0, 0, 24, 24)
      const { data } = ctx.getImageData(0, 0, 24, 24)
      let sum = 0
      for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3
      setResult({ image, dark: sum / (data.length / 4) < 3 })
    }
    img.src = `data:image/png;base64,${image}`
  }, [image])
  return result?.image === image && result.dark
}

interface Snapshot {
  image: string
  hierarchy: Hierarchy
}

/** A frozen picture of the phone's screen, with every element's id, text, bounds and class. */
export function InspectorTab({ serial, active }: { serial: string; active: boolean }) {
  const toast = useToast()
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<UiNode | null>(null)
  const [hover, setHover] = useState<UiNode | null>(null)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const requested = useRef(false)

  const capture = async () => {
    setLoading(true)
    setError(null)
    try {
      // The dump and the picture are taken together so they describe the same moment.
      const [image, xml] = await Promise.all([screenshot(serial), dumpUi(serial)])
      setSnapshot({ image, hierarchy: parseHierarchy(xml) })
      setSelected(null)
      setHover(null)
      setCollapsed(new Set())
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  // Take the first snapshot when the tab is first opened.
  useEffect(() => {
    if (active && !requested.current) {
      requested.current = true
      void capture()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const point = (e: MouseEvent<HTMLDivElement>) => {
    if (!snapshot) return null
    const r = e.currentTarget.getBoundingClientRect()
    const { width, height } = snapshot.hierarchy
    return nodeAt(snapshot.hierarchy.nodes, ((e.clientX - r.left) / r.width) * width, ((e.clientY - r.top) / r.height) * height)
  }

  const select = (node: UiNode | null) => {
    setSelected(node)
    if (!node) return
    // Open the tree down to the element.
    const open = new Set(collapsed)
    for (let p = node.parent; p; p = p.parent) open.delete(p.id)
    setCollapsed(open)
  }

  const copy = (text: string, what: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => toast(`Copied ${what}`))
      .catch(() => toast('Could not copy', 'error'))

  const tap = async (node: UiNode) => {
    const { x, y } = centerOf(node.bounds)
    try {
      await runShell(serial, `input tap ${x} ${y}`)
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const rows = useMemo(() => {
    if (!snapshot) return []
    const out: UiNode[] = []
    const q = query.trim()
    const walk = (n: UiNode) => {
      out.push(n)
      if (!collapsed.has(n.id) || q) n.children.forEach(walk)
    }
    snapshot.hierarchy.roots.forEach(walk)
    return q ? out.filter((n) => matches(n, q)) : out
  }, [snapshot, collapsed, query])

  const toggle = (id: number) =>
    setCollapsed((c) => {
      const next = new Set(c)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const box = (n: UiNode, tone: 'hover' | 'selected') => {
    const { width, height } = snapshot!.hierarchy
    const b = n.bounds
    return (
      <div
        key={`${tone}-${n.id}`}
        className={cn(
          'pointer-events-none absolute border-2',
          tone === 'selected' ? 'border-blue-500 bg-blue-500/20' : 'border-emerald-400 bg-emerald-400/15',
        )}
        style={{
          left: `${(b.left / width) * 100}%`,
          top: `${(b.top / height) * 100}%`,
          width: `${((b.right - b.left) / width) * 100}%`,
          height: `${((b.bottom - b.top) / height) * 100}%`,
        }}
      />
    )
  }

  const dark = useDarkImage(snapshot?.image ?? null)

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[auto_minmax(0,1fr)]">
      <Card className="flex min-h-64 min-w-0 flex-col items-center justify-center gap-2 p-3">
        {snapshot ? (
          <div
            className="relative cursor-crosshair"
            onMouseMove={(e) => setHover(point(e))}
            onMouseLeave={() => setHover(null)}
            onClick={(e) => select(point(e))}
          >
            <img
              src={`data:image/png;base64,${snapshot.image}`}
              alt="Device screen"
              draggable={false}
              className="block h-auto max-h-[min(70vh,640px)] w-auto max-w-full rounded-lg select-none"
            />
            {hover && hover !== selected && box(hover, 'hover')}
            {selected && box(selected, 'selected')}
          </div>
        ) : null}
        {snapshot && (
          <p className="h-5 w-0 min-w-full truncate text-xs text-zinc-500">{hover ? labelOf(hover) : ' '}</p>
        )}
        {snapshot ? null : (
          <div className="flex flex-col items-center gap-3 p-8 text-center text-zinc-400">
            <ScanSearch size={32} className={loading ? 'animate-pulse' : ''} />
            <p className="max-w-56 text-xs">
              {loading ? 'Reading the screen...' : (error ?? 'Capture the screen to inspect its elements')}
            </p>
          </div>
        )}
      </Card>

      <div className="flex min-w-0 flex-col gap-4">
        <Card className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
              <ScanSearch size={22} />
            </div>
            <div className="min-w-0 flex-1 basis-40">
              <h3 className="text-base font-semibold">UI inspector</h3>
              <p className="text-xs text-zinc-500">
                {snapshot ? `${snapshot.hierarchy.nodes.length} elements` : 'Click an element to see what it is'}
              </p>
            </div>
            <Button variant="primary" disabled={loading} onClick={() => void capture()}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> {snapshot ? 'Refresh' : 'Capture'}
            </Button>
          </div>
          {error && snapshot && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm">{error}</p>
          )}

          {dark && (
            <p className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm">{BLANK_HINT}</p>
          )}
          {selected ? (
            <>
              <dl className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                <InfoRow label="Class" value={selected.className || '-'} mono copyable />
                <InfoRow label="Resource id" value={selected.resourceId || '-'} mono copyable />
                <InfoRow label="Text" value={selected.text || '-'} copyable />
                <InfoRow label="Description" value={selected.description || '-'} copyable />
                <InfoRow label="Package" value={selected.packageName || '-'} mono />
                <InfoRow
                  label="Bounds"
                  mono
                  value={`${selected.bounds.left}, ${selected.bounds.top} to ${selected.bounds.right}, ${selected.bounds.bottom}`}
                />
                <InfoRow
                  label="Size"
                  mono
                  value={`${selected.bounds.right - selected.bounds.left} × ${selected.bounds.bottom - selected.bounds.top}`}
                />
              </dl>
              {selected.flags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selected.flags.map((f) => (
                    <Badge key={f} tone="blue">
                      {f}
                    </Badge>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void tap(selected)}>
                  <Crosshair size={16} /> Tap it
                </Button>
                <Button onClick={() => void copy(xpathOf(selected), 'XPath')}>
                  <Copy size={16} /> XPath
                </Button>
                {selected.resourceId && (
                  <Button onClick={() => void copy(selected.resourceId, 'resource id')}>
                    <Copy size={16} /> Resource id
                  </Button>
                )}
              </div>
            </>
          ) : (
            snapshot && <p className="text-sm text-zinc-500">Click an element on the screen or in the tree.</p>
          )}
        </Card>

        {snapshot && (
          <Card>
            <CardTitle>Element tree</CardTitle>
            <div className="relative mb-3">
              <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-zinc-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find by text, id or class"
                className="pl-8"
              />
            </div>
            <div onMouseLeave={() => setHover(null)} className="max-h-96 overflow-auto rounded-xl border border-zinc-200 p-1 font-mono text-xs dark:border-zinc-800">
              {rows.map((n) => (
                <TreeRow
                  key={n.id}
                  node={n}
                  indent={query.trim() ? 0 : n.depth}
                  open={!collapsed.has(n.id)}
                  selected={selected?.id === n.id}
                  onToggle={() => toggle(n.id)}
                  onSelect={() => select(n)}
                  onHover={() => setHover(n)}
                />
              ))}
              {rows.length === 0 && <p className="px-2 py-2 text-zinc-500">No matches.</p>}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

function TreeRow({
  node,
  indent,
  open,
  selected,
  onToggle,
  onSelect,
  onHover,
}: {
  node: UiNode
  indent: number
  open: boolean
  selected: boolean
  onToggle: () => void
  onSelect: () => void
  onHover: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <div
      ref={ref}
      onMouseEnter={onHover}
      style={{ paddingLeft: indent * 12 }}
      className={cn(
        'flex cursor-pointer items-center gap-1 rounded-lg py-1 pr-2',
        selected ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800',
      )}
      onClick={onSelect}
    >
      {node.children.length > 0 ? (
        <button
          type="button"
          aria-label={open ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          className="flex-none cursor-pointer text-zinc-400"
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
      ) : (
        <span className="w-[13px] flex-none" />
      )}
      <span className="truncate">
        <span className={selected ? '' : 'text-zinc-500'}>{node.className.split('.').pop() || 'node'}</span>
        {labelOf(node).slice((node.className.split('.').pop() || 'node').length)}
      </span>
    </div>
  )
}
