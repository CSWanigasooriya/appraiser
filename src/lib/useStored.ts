import { useCallback, useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()
const cache = new Map<string, { raw: string | null; value: unknown }>()

function read<T>(key: string, fallback: T, valid: (v: unknown) => v is T): T {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(key)
  } catch {
    // storage can be unavailable; behave as if nothing is saved
  }
  const hit = cache.get(key)
  if (hit && hit.raw === raw) return hit.value as T
  let value = fallback
  try {
    const parsed: unknown = raw === null ? undefined : JSON.parse(raw)
    if (valid(parsed)) value = parsed
  } catch {
    // corrupt entry: fall back
  }
  cache.set(key, { raw, value })
  return value
}

/**
 * A value kept in localStorage that every component using the same key sees
 * update at once (and other windows too). `valid` guards against stale or
 * hand-edited data.
 */
export function useStored<T>(key: string, fallback: T, valid: (v: unknown) => v is T) {
  const subscribe = useCallback((notify: () => void) => {
    listeners.add(notify)
    window.addEventListener('storage', notify)
    return () => {
      listeners.delete(notify)
      window.removeEventListener('storage', notify)
    }
  }, [])
  const value = useSyncExternalStore(subscribe, () => read(key, fallback, valid))

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved = typeof next === 'function' ? (next as (prev: T) => T)(read(key, fallback, valid)) : next
      try {
        localStorage.setItem(key, JSON.stringify(resolved))
      } catch {
        // not worth failing over; the in-memory value below still updates this session
      }
      cache.set(key, { raw: JSON.stringify(resolved), value: resolved })
      listeners.forEach((l) => l())
    },
    [key, fallback, valid],
  )
  return [value, set] as const
}

export const isArrayOf =
  <T>(item: (v: unknown) => v is T) =>
  (v: unknown): v is T[] =>
    Array.isArray(v) && v.every(item)
