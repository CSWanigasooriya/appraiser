import type { MacroStep } from '../../lib/adb'
import { isArrayOf, useStored } from '../../lib/useStored'

export interface Snippet {
  id: string
  name: string
  command: string
}

export interface Macro {
  id: string
  name: string
  steps: MacroStep[]
  /** Recorded with the phone turned sideways. */
  landscape: boolean
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

const isSnippet = (v: unknown): v is Snippet =>
  isObject(v) && typeof v.id === 'string' && typeof v.name === 'string' && typeof v.command === 'string'

const isMacro = (v: unknown): v is Macro =>
  isObject(v) &&
  typeof v.id === 'string' &&
  typeof v.name === 'string' &&
  typeof v.landscape === 'boolean' &&
  Array.isArray(v.steps) &&
  v.steps.every((s) => isObject(s) && typeof s.kind === 'string')

const NONE: never[] = []
const isSnippets = isArrayOf(isSnippet)
const isMacros = isArrayOf(isMacro)

export const newId = () => crypto.randomUUID()

export const useSnippets = () => useStored<Snippet[]>('snippets', NONE, isSnippets)
export const useMacros = () => useStored<Macro[]>('macros', NONE, isMacros)

/** One line describing what a step does. */
export function describeStep(step: MacroStep): string {
  const pct = (f: number) => `${Math.round(f * 100)}%`
  switch (step.kind) {
    case 'tap':
      return `Tap at ${pct(step.x)}, ${pct(step.y)}`
    case 'swipe':
      return `Swipe ${pct(step.x1)}, ${pct(step.y1)} to ${pct(step.x2)}, ${pct(step.y2)} (${step.duration_ms} ms)`
    case 'key':
      return `Press key ${step.keycode}`
    case 'text':
      return `Type "${step.text}"`
    case 'wait':
      return `Wait ${(step.ms / 1000).toFixed(1)} s`
    case 'shell':
      return `Run: ${step.command}`
  }
}
