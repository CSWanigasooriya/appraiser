import type { InputHTMLAttributes } from 'react'
import { cn } from './cn'

/** The look shared by text inputs and selects. */
export const fieldClass =
  'rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none placeholder:text-zinc-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:border-zinc-700 dark:bg-zinc-900'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  // An explicit width class replaces the full-width default.
  const sized = className && /(^|\s)w-/.test(className)
  return <input {...props} className={cn(!sized && 'w-full', fieldClass, className)} />
}

export function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      {children}
    </label>
  )
}
