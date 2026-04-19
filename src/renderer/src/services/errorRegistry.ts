import { ErrorRecord, ErrorCategory } from '../types'
import { emitErrorToast } from './errorToastBus'

let _breadcrumbs: string[] = []
let _currentPage = 'dashboard'
let _storeRef: {
  addError: (e: ErrorRecord) => void
  getBreadcrumbs: () => string[]
} | null = null

export function initErrorRegistry(store: typeof _storeRef) {
  _storeRef = store
  _breadcrumbs = store?.getBreadcrumbs() ?? []
}

export function setCurrentPage(page: string) {
  _currentPage = page
  pushBreadcrumb(`Открыта страница: ${page}`)
}

export function pushBreadcrumb(action: string) {
  _breadcrumbs = [..._breadcrumbs.slice(-4), action]
}

export function captureError(
  error: unknown,
  category: ErrorCategory,
  action?: string
): ErrorRecord {
  const record: ErrorRecord = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    category,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    context: { page: _currentPage, action, breadcrumbs: [..._breadcrumbs] },
    resolved: false,
  }
  _storeRef?.addError(record)
  emitErrorToast(record.message, record.category)
  return record
}

export function installGlobalErrorHandlers(store: typeof _storeRef) {
  initErrorRegistry(store)
  window.addEventListener('error', (e) => {
    captureError(e.error ?? e.message, 'js_exception', 'unhandled window error')
  })
  window.addEventListener('unhandledrejection', (e) => {
    captureError(e.reason, 'js_exception', 'unhandled promise rejection')
  })
}
