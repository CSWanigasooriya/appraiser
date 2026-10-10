import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { cn } from './cn'

type Kind = 'success' | 'error'
interface Toast {
  id: number
  text: string
  kind: Kind
}

const ToastContext = createContext<(text: string, kind?: Kind) => void>(() => {})
export const useToast = () => useContext(ToastContext)

let nextId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const show = useCallback((text: string, kind: Kind = 'success') => {
    const id = nextId++
    setToasts((t) => [...t, { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4000)
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 grid max-w-sm gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex items-start gap-2 rounded-lg border bg-white p-3 text-sm shadow-lg dark:bg-zinc-900',
              t.kind === 'error'
                ? 'border-red-500/40 text-red-700 dark:text-red-400'
                : 'border-zinc-200 dark:border-zinc-700',
            )}
          >
            {t.kind === 'error' ? (
              <AlertCircle size={16} className="mt-0.5 flex-none" />
            ) : (
              <CheckCircle2 size={16} className="mt-0.5 flex-none text-green-600" />
            )}
            <span className="break-words">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
