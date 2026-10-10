import { useEffect, useRef, useState } from 'react'
import { appIcon } from '../../lib/adb'

const cache = new Map<string, string | null>()

// Each icon is a few adb round trips; keep the number in flight small.
const MAX_CONCURRENT = 4
let active = 0
const queue: (() => void)[] = []

function schedule<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = () => {
      active++
      task()
        .then(resolve, reject)
        .finally(() => {
          active--
          queue.shift()?.()
        })
    }
    if (active < MAX_CONCURRENT) start()
    else queue.push(start)
  })
}

export function AppIcon({ serial, pkg, apkPath }: { serial: string; pkg: string; apkPath: string | null }) {
  // The APK path changes on update, so a new version gets a fresh icon.
  const key = `${serial}/${pkg}/${apkPath}`
  const ref = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string | null>(cache.get(key) ?? null)

  useEffect(() => {
    if (cache.has(key) || !apkPath) return
    const el = ref.current
    if (!el) return
    let cancelled = false
    // Only fetch icons for rows that are actually on screen.
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      schedule(() => appIcon(serial, pkg, apkPath))
        .then((icon) => cache.set(key, icon))
        .catch(() => cache.set(key, null))
        .finally(() => !cancelled && setSrc(cache.get(key) ?? null))
    })
    observer.observe(el)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [key, serial, pkg, apkPath])

  return (
    <div
      ref={ref}
      className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-100 text-sm font-semibold text-zinc-500 dark:bg-zinc-800"
    >
      {src ? (
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        (pkg.split('.').pop() ?? pkg).charAt(0).toUpperCase()
      )}
    </div>
  )
}
