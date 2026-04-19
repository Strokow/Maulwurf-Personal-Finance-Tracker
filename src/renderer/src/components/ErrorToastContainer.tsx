import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, AlertTriangle, BrainCircuit, ShieldAlert, Cpu, Bug } from 'lucide-react'
import { onErrorToast } from '../services/errorToastBus'
import { playNotificationSound } from '../utils/playNotificationSound'

interface Toast {
  id: string
  message: string
  category: string
  createdAt: number
}

const MAX_VISIBLE = 4
const AUTO_DISMISS_MS = 10000

const categoryConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  js_exception: {
    icon: <Bug className="h-4 w-4" />,
    color: 'border-red-800/60 bg-red-950/80',
    label: 'Ошибка JS',
  },
  ollama_error: {
    icon: <BrainCircuit className="h-4 w-4" />,
    color: 'border-purple-800/60 bg-purple-950/80',
    label: 'Ollama',
  },
  validation_error: {
    icon: <ShieldAlert className="h-4 w-4" />,
    color: 'border-orange-800/60 bg-orange-950/80',
    label: 'Валидация',
  },
  ipc_error: {
    icon: <Cpu className="h-4 w-4" />,
    color: 'border-red-800/60 bg-red-950/80',
    label: 'IPC',
  },
}

const defaultConfig = {
  icon: <AlertTriangle className="h-4 w-4" />,
  color: 'border-neutral-700 bg-neutral-900/90',
  label: 'Ошибка',
}

export function ErrorToastContainer(): React.JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  useEffect(() => {
    const unsub = onErrorToast((message, category) => {
      const toast: Toast = {
        id: crypto.randomUUID(),
        message,
        category,
        createdAt: Date.now(),
      }
      setToasts((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), toast])
      playNotificationSound()
    })
    return unsub
  }, [])

  // Auto-dismiss
  useEffect(() => {
    if (toasts.length === 0) return
    const interval = setInterval(() => {
      const now = Date.now()
      setToasts((prev) => prev.filter((t) => now - t.createdAt < AUTO_DISMISS_MS))
    }, 1000)
    return () => clearInterval(interval)
  }, [toasts.length])

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col-reverse gap-2 max-w-sm pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => {
          const cfg = categoryConfig[toast.category] ?? defaultConfig
          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 80, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 80, scale: 0.95 }}
              transition={{ type: 'spring', damping: 20, stiffness: 300 }}
              className={`pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3 py-2.5 shadow-lg backdrop-blur-sm ${cfg.color}`}
            >
              <span className="mt-0.5 shrink-0 text-neutral-300">{cfg.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                  {cfg.label}
                </p>
                <p className="mt-0.5 text-xs leading-snug text-neutral-200 line-clamp-3">
                  {toast.message}
                </p>
              </div>
              <button
                onClick={() => dismiss(toast.id)}
                className="shrink-0 rounded p-0.5 text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
