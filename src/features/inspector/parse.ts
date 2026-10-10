/** Turns uiautomator's XML dump into a tree of screen elements. */

export interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

export interface UiNode {
  /** Position in document order, unique within one dump. */
  id: number
  depth: number
  className: string
  resourceId: string
  text: string
  description: string
  packageName: string
  bounds: Bounds
  flags: string[]
  parent: UiNode | null
  children: UiNode[]
  /** Which child of its parent this is, counting only siblings of the same class. */
  classIndex: number
}

export interface Hierarchy {
  roots: UiNode[]
  /** Every node, in document order. */
  nodes: UiNode[]
  width: number
  height: number
}

const FLAGS = ['clickable', 'long-clickable', 'scrollable', 'focusable', 'checkable', 'checked', 'selected', 'password'] as const

function parseBounds(value: string | null): Bounds {
  const m = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(value ?? '')
  return m
    ? { left: +m[1], top: +m[2], right: +m[3], bottom: +m[4] }
    : { left: 0, top: 0, right: 0, bottom: 0 }
}

export function parseHierarchy(xml: string): Hierarchy {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  if (doc.querySelector('parsererror') || !doc.documentElement) throw new Error('The screen dump could not be read')

  const nodes: UiNode[] = []
  const build = (el: Element, parent: UiNode | null, depth: number, classIndex: number): UiNode => {
    const attr = (name: string) => el.getAttribute(name) ?? ''
    const node: UiNode = {
      id: nodes.length,
      depth,
      className: attr('class'),
      resourceId: attr('resource-id'),
      text: attr('text'),
      description: attr('content-desc'),
      packageName: attr('package'),
      bounds: parseBounds(el.getAttribute('bounds')),
      flags: FLAGS.filter((f) => attr(f) === 'true'),
      parent,
      children: [],
      classIndex,
    }
    nodes.push(node)
    const seen = new Map<string, number>()
    for (const child of Array.from(el.children).filter((c) => c.tagName === 'node')) {
      const cls = child.getAttribute('class') ?? ''
      const index = (seen.get(cls) ?? 0) + 1
      seen.set(cls, index)
      node.children.push(build(child, node, depth + 1, index))
    }
    return node
  }

  // Top-level nodes may sit directly under <hierarchy> or inside per-window wrappers.
  const roots = Array.from(doc.querySelectorAll('node'))
    .filter((el) => el.parentElement?.tagName !== 'node')
    .map((el, i) => build(el, null, 0, i + 1))
  const width = Math.max(0, ...nodes.map((n) => n.bounds.right))
  const height = Math.max(0, ...nodes.map((n) => n.bounds.bottom))
  return { roots, nodes, width, height }
}

const area = (b: Bounds) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top)

/** The smallest element under a point (later siblings, drawn on top, win ties). */
export function nodeAt(nodes: UiNode[], x: number, y: number): UiNode | null {
  let best: UiNode | null = null
  for (const n of nodes) {
    const b = n.bounds
    if (x < b.left || x >= b.right || y < b.top || y >= b.bottom) continue
    if (!best || area(b) <= area(best.bounds)) best = n
  }
  return best
}

export const centerOf = (b: Bounds) => ({ x: Math.round((b.left + b.right) / 2), y: Math.round((b.top + b.bottom) / 2) })

export function xpathOf(node: UiNode): string {
  const parts: string[] = []
  for (let n: UiNode | null = node; n; n = n.parent) parts.unshift(`${n.className || 'node'}[${n.classIndex}]`)
  return `//${parts.join('/')}`
}

/** A short label for a tree row: the most telling thing the element says about itself. */
export function labelOf(node: UiNode): string {
  const cls = node.className.split('.').pop() || 'node'
  const id = node.resourceId.split('/').pop()
  const what = node.text || node.description || id
  return what ? `${cls} "${what}"` : cls
}

export function matches(node: UiNode, query: string): boolean {
  const q = query.toLowerCase()
  return [node.className, node.resourceId, node.text, node.description].some((s) => s.toLowerCase().includes(q))
}
