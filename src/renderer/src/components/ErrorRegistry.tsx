import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bug,
  BrainCircuit,
  ShieldAlert,
  Cpu,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Copy
} from 'lucide-react'
import type { ErrorRecord, ErrorCategory } from '../types'

interface ErrorRegistryProps {
  errors: ErrorRecord[]
  onResolve: (id: string) => void
  onClearResolved: () => void
}

const categoryIcons: Record<ErrorCategory, React.ReactNode> = {
  js_exception: <Bug className="h-3.5 w-3.5" />,
  ollama_error: <BrainCircuit className="h-3.5 w-3.5" />,
  validation_error: <ShieldAlert className="h-3.5 w-3.5" />,
  ipc_error: <Cpu className="h-3.5 w-3.5" />,
}

const categoryLabels: Record<ErrorCategory, string> = {
  js_exception: 'JS',
  ollama_error: 'Ollama',
  validation_error: 'Валидация',
  ipc_error: 'IPC',
}

const categoryColors: Record<ErrorCategory, string> = {
  js_exception: 'bg-blue-900/50 text-blue-300',
  ollama_error: 'bg-purple-900/50 text-purple-300',
  validation_error: 'bg-orange-900/50 text-orange-300',
  ipc_error: 'bg-red-900/50 text-red-300',
}

export function ErrorRegistry({
  errors,
  onResolve,
  onClearResolved,
}: ErrorRegistryProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<ErrorCategory | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'resolved' | 'unresolved'>('unresolved')
  const [dateFilter, setDateFilter] = useState<'today' | 'week' | 'all'>('all')

  const filtered = useMemo(() => {
    const now = Date.now()
    const dayMs = 86400000
    const weekMs = 7 * dayMs

    return errors.filter((e) => {
      if (categoryFilter !== 'all' && e.category !== categoryFilter) return false
      if (statusFilter === 'resolved' && !e.resolved) return false
      if (statusFilter === 'unresolved' && e.resolved) return false
      if (dateFilter === 'today') {
        return now - new Date(e.timestamp).getTime() < dayMs
      }
      if (dateFilter === 'week') {
        return now - new Date(e.timestamp).getTime() < weekMs
      }
      return true
    })
  }, [errors, categoryFilter, statusFilter, dateFilter])

  const unresolvedCount = errors.filter((e) => !e.resolved).length

  const handleCopy = (e: ErrorRecord) => {
    const text = `[${new Date(e.timestamp).toLocaleString('ru-RU')}] ${e.category.toUpperCase()}
Page: ${e.context.page} | Action: ${e.context.action || 'N/A'}
Breadcrumbs: ${e.context.breadcrumbs.join(' → ')}
Message: ${e.message}
Stack: ${e.stack || 'N/A'}`
    navigator.clipboard.writeText(text)
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-neutral-200">
          Реестр ошибок{' '}
          {unresolvedCount > 0 && (
            <span className="ml-2 text-xs bg-red-900/50 text-red-300 px-2 py-0.5 rounded-full">
              {unresolvedCount}
            </span>
          )}
        </h2>
        <button
          onClick={onClearResolved}
          className="text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
        >
          Очистить решённые
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        <div className="flex gap-1">
          {(['all', 'js_exception', 'ollama_error', 'validation_error', 'ipc_error'] as const).map(
            (cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-2 py-0.5 text-xs rounded transition-colors ${
                  categoryFilter === cat
                    ? 'bg-neutral-700 text-neutral-200'
                    : 'bg-neutral-800 text-neutral-500 hover:text-neutral-300'
                }`}
              >
                {cat === 'all' ? 'Все' : categoryLabels[cat]}
              </button>
            )
          )}
        </div>
        <div className="flex gap-1">
          {(['all', 'unresolved', 'resolved'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                statusFilter === status
                  ? 'bg-neutral-700 text-neutral-200'
                  : 'bg-neutral-800 text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {status === 'all' ? 'Все' : status === 'unresolved' ? 'Нерешённые' : 'Решённые'}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {(['today', 'week', 'all'] as const).map((date) => (
            <button
              key={date}
              onClick={() => setDateFilter(date)}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                dateFilter === date
                  ? 'bg-neutral-700 text-neutral-200'
                  : 'bg-neutral-800 text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {date === 'today' ? 'Сегодня' : date === 'week' ? '7 дней' : 'Всё'}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="space-y-2">
        {errors.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-4xl mb-3">✅</div>
            <p className="text-base font-medium text-neutral-300">Всё в порядке</p>
            <p className="text-sm text-neutral-500 mt-1">Ошибок нет</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-neutral-400 text-sm py-8 text-center">
            Нет ошибок по выбранным фильтрам
          </div>
        ) : (
          filtered.map((e) => (
            <motion.div
              key={e.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`rounded-lg border ${
                e.resolved ? 'border-neutral-800 bg-neutral-900/50' : 'border-red-900/30 bg-red-950/20'
              }`}
            >
              <div
                className="flex items-center justify-between p-2 cursor-pointer"
                onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`px-1.5 py-0.5 rounded text-xs flex items-center gap-1 ${
                      categoryColors[e.category]
                    }`}
                  >
                    {categoryIcons[e.category]}
                    {categoryLabels[e.category]}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {new Date(e.timestamp).toLocaleString('ru-RU', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <span className="text-sm text-neutral-300 truncate max-w-md">
                    {e.message.slice(0, 80)}
                    {e.message.length > 80 ? '...' : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {!e.resolved && (
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation()
                        onResolve(e.id)
                      }}
                      className="p-1 text-neutral-500 hover:text-green-400 transition-colors"
                      title="Отметить решённой"
                    >
                      <CheckCircle className="h-4 w-4" />
                    </button>
                  )}
                  {expandedId === e.id ? (
                    <ChevronUp className="h-4 w-4 text-neutral-500" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-neutral-500" />
                  )}
                </div>
              </div>

              <AnimatePresence>
                {expandedId === e.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-neutral-800 p-3 space-y-2">
                      <div>
                        <p className="text-xs text-neutral-500 mb-1">Полное сообщение:</p>
                        <p className="text-sm text-neutral-300">{e.message}</p>
                      </div>
                      {e.stack && (
                        <div>
                          <p className="text-xs text-neutral-500 mb-1">Stack trace:</p>
                          <pre className="text-xs text-neutral-400 bg-neutral-900 rounded p-2 max-h-48 overflow-auto font-mono">
                            {e.stack}
                          </pre>
                        </div>
                      )}
                      <div>
                        <p className="text-xs text-neutral-500 mb-1">Breadcrumbs:</p>
                        <ol className="text-xs text-neutral-400 list-decimal list-inside space-y-0.5">
                          {e.context.breadcrumbs.map((b, i) => (
                            <li key={i}>{b}</li>
                          ))}
                        </ol>
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-neutral-500">
                          Страница: {e.context.page}{' '}
                          {e.context.action && `| Действие: ${e.context.action}`}
                        </p>
                        <button
                          onClick={() => handleCopy(e)}
                          className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Скопировать для разработчика
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))
        )}
      </div>
    </div>
  )
}
