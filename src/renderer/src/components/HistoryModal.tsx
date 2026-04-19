import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  History,
  HardDrive,
  ArrowDownToLine,
  ArrowUpFromLine,
  RotateCcw,
  Plus,
  ShoppingCart,
  CalendarClock,
  FileInput,
  Settings,
  CreditCard,
} from 'lucide-react'
import type { ChangeLogEntry, BackupMeta } from '../types'

interface Props {
  changeLog: ChangeLogEntry[]
  onClose: () => void
  onRestored: () => void
}

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  transaction: <ShoppingCart className="h-3.5 w-3.5" />,
  obligation: <CalendarClock className="h-3.5 w-3.5" />,
  klarna: <CreditCard className="h-3.5 w-3.5" />,
  import: <FileInput className="h-3.5 w-3.5" />,
  system: <Settings className="h-3.5 w-3.5" />,
}

const CATEGORY_COLOR: Record<string, string> = {
  transaction: 'text-blue-400 bg-blue-950/50',
  obligation: 'text-indigo-400 bg-indigo-950/50',
  klarna: 'text-purple-400 bg-purple-950/50',
  import: 'text-green-400 bg-green-950/50',
  system: 'text-neutral-400 bg-neutral-800/50',
}

function formatTs(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function HistoryModal({ changeLog, onClose, onRestored }: Props): React.JSX.Element {
  const [tab, setTab] = useState<'history' | 'backups'>('history')
  const [backups, setBackups] = useState<BackupMeta[]>([])
  const [loadingBackups, setLoadingBackups] = useState(false)
  const [creatingBackup, setCreatingBackup] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  const showStatus = (msg: string): void => {
    setStatusMsg(msg)
    setTimeout(() => setStatusMsg(null), 3000)
  }

  const loadBackups = useCallback(async () => {
    setLoadingBackups(true)
    const list = (await window.api.backup.list()) as BackupMeta[]
    setBackups(list)
    setLoadingBackups(false)
  }, [])

  useEffect(() => {
    if (tab === 'backups') loadBackups()
  }, [tab, loadBackups])

  const handleCreate = async (): Promise<void> => {
    setCreatingBackup(true)
    await window.api.backup.create()
    await loadBackups()
    setCreatingBackup(false)
    showStatus('Бэкап создан')
  }

  const handleRestore = async (filename: string): Promise<void> => {
    setRestoringId(filename)
    const result = await window.api.backup.restore(filename)
    setRestoringId(null)
    if (result.success) {
      showStatus('Восстановлено — перезагрузка данных...')
      onRestored()
    }
  }

  const handleExport = async (): Promise<void> => {
    const result = await window.api.backup.exportToFile()
    if (result.success) showStatus('Экспорт сохранён')
  }

  const handleImport = async (): Promise<void> => {
    const result = await window.api.backup.importFromFile()
    if (result.success) {
      showStatus('Импорт успешен — перезагрузка данных...')
      onRestored()
    }
  }

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
      />

      {/* Panel — slides up from bottom-left */}
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.97 }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        className="fixed bottom-12 left-3 z-50 w-[420px] max-h-[540px] flex flex-col rounded-xl border border-neutral-700 bg-[#141414] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3 shrink-0">
          <div className="flex gap-1">
            <button
              onClick={() => setTab('history')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                tab === 'history'
                  ? 'bg-neutral-800 text-neutral-100'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              <History className="h-3.5 w-3.5" />
              История
            </button>
            <button
              onClick={() => setTab('backups')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                tab === 'backups'
                  ? 'bg-neutral-800 text-neutral-100'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              <HardDrive className="h-3.5 w-3.5" />
              Бэкапы
            </button>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Status message */}
        <AnimatePresence>
          {statusMsg && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-green-950/50 border-b border-green-900/40 px-4 py-2 text-xs text-green-400 shrink-0"
            >
              {statusMsg}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'history' && (
            <div>
              {changeLog.length === 0 ? (
                <div className="py-12 text-center text-xs text-neutral-600">
                  Нет записей
                </div>
              ) : (
                <div className="divide-y divide-neutral-800/60">
                  {changeLog.map((entry) => (
                    <div key={entry.id} className="flex items-start gap-3 px-4 py-2.5">
                      <div className={`mt-0.5 shrink-0 rounded p-1 ${CATEGORY_COLOR[entry.category] ?? 'text-neutral-400 bg-neutral-800/50'}`}>
                        {CATEGORY_ICON[entry.category] ?? <Settings className="h-3.5 w-3.5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs text-neutral-200">{entry.description}</p>
                        <p className="mt-0.5 text-[10px] text-neutral-600">{formatTs(entry.timestamp)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'backups' && (
            <div>
              {/* Actions */}
              <div className="flex gap-2 border-b border-neutral-800 px-4 py-3 shrink-0">
                <button
                  onClick={handleCreate}
                  disabled={creatingBackup}
                  className="flex items-center gap-1.5 rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700 disabled:opacity-50 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {creatingBackup ? 'Создаётся...' : 'Создать'}
                </button>
                <button
                  onClick={handleExport}
                  className="flex items-center gap-1.5 rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700 transition-colors"
                >
                  <ArrowDownToLine className="h-3.5 w-3.5" />
                  Экспорт
                </button>
                <button
                  onClick={handleImport}
                  className="flex items-center gap-1.5 rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700 transition-colors"
                >
                  <ArrowUpFromLine className="h-3.5 w-3.5" />
                  Импорт
                </button>
              </div>

              {loadingBackups ? (
                <div className="py-12 text-center text-xs text-neutral-600">Загрузка...</div>
              ) : backups.length === 0 ? (
                <div className="py-12 text-center text-xs text-neutral-600">
                  Нет бэкапов
                  <p className="mt-1 text-neutral-700">Автобэкап каждые 30 мин</p>
                </div>
              ) : (
                <div className="divide-y divide-neutral-800/60">
                  {backups.map((b) => (
                    <div key={b.filename} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="text-xs text-neutral-200">{formatTs(b.timestamp)}</p>
                        <p className="mt-0.5 text-[10px] text-neutral-600">
                          {b.transactionCount} транзакций · {b.obligationCount} обязательств · {formatSize(b.size)}
                        </p>
                      </div>
                      <button
                        onClick={() => handleRestore(b.filename)}
                        disabled={restoringId === b.filename}
                        title="Восстановить"
                        className="shrink-0 rounded p-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-amber-400 disabled:opacity-50 transition-colors"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </>
  )
}
