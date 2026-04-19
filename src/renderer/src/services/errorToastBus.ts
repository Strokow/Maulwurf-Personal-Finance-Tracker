// Simple event bus for error toasts — decouples captureError from React
type ToastListener = (message: string, category: string) => void

const listeners = new Set<ToastListener>()

export function onErrorToast(fn: ToastListener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function emitErrorToast(message: string, category: string): void {
  for (const fn of listeners) fn(message, category)
}
