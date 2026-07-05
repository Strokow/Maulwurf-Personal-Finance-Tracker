import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  X,
  Lock,
  HardDrive,
  Info,
  Plus,
  ArrowDownToLine,
  ArrowUpFromLine,
  RotateCcw,
  AlertTriangle,
  Wrench,
} from 'lucide-react'
import type { BackupMeta } from '../types'

// Подставляется на сборке из package.json (renderer define в electron.vite.config.ts).
const APP_VERSION = __APP_VERSION__

interface PinStatus {
  enabled: boolean
  locked: boolean
  lockoutUntil: string | null
  attemptsLeft: number
}

interface Props {
  onClose: () => void
  onRestored: () => void
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

export function SettingsModal({ onClose, onRestored }: Props): React.JSX.Element {
  // ── PIN ────────────────────────────────────────────────
  const [pinStatus, setPinStatus] = useState<PinStatus | null>(null)
  const [pinMode, setPinMode] = useState<'none' | 'setup' | 'disable'>('none')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [currentPin, setCurrentPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [pinNotice, setPinNotice] = useState('')

  // ── Бекапы ─────────────────────────────────────────────
  const [backups, setBackups] = useState<BackupMeta[]>([])
  const [creatingBackup, setCreatingBackup] = useState(false)
  const [restoreConfirm, setRestoreConfirm] = useState<string | null>(null)
  const [backupNotice, setBackupNotice] = useState('')

  const refreshPinStatus = useCallback(async () => {
    const s = (await window.api.pin.status()) as PinStatus
    setPinStatus(s)
  }, [])

  const loadBackups = useCallback(async () => {
    const list = (await window.api.backup.list()) as BackupMeta[]
    setBackups(list)
  }, [])

  useEffect(() => {
    void refreshPinStatus()
    void loadBackups()
  }, [refreshPinStatus, loadBackups])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const resetPinForms = (): void => {
    setPinMode('none')
    setNewPin('')
    setConfirmPin('')
    setCurrentPin('')
    setPinError('')
  }

  const handleSetPin = async (): Promise<void> => {
    setPinError('')
    if (newPin.length !== 6) {
      setPinError('PIN должен содержать 6 цифр')
      return
    }
    if (newPin !== confirmPin) {
      setPinError('PIN не совпадает')
      return
    }
    await window.api.pin.set(newPin)
    resetPinForms()
    setPinNotice('PIN сохранён')
    setTimeout(() => setPinNotice(''), 3000)
    await refreshPinStatus()
  }

  const handleDisablePin = async (): Promise<void> => {
    setPinError('')
    const result = (await window.api.pin.disable(currentPin)) as { success: boolean }
    if (!result.success) {
      setPinError('Неверный PIN — отключить не удалось')
      return
    }
    resetPinForms()
    setPinNotice('PIN отключён')
    setTimeout(() => setPinNotice(''), 3000)
    await refreshPinStatus()
  }

  const handleCreateBackup = async (): Promise<void> => {
    setCreatingBackup(true)
    await window.api.backup.create()
    await loadBackups()
    setCreatingBackup(false)
    setBackupNotice('Бэкап создан')
    setTimeout(() => setBackupNotice(''), 3000)
  }

  const handleRestore = async (filename: string): Promise<void> => {
    const result = await window.api.backup.restore(filename)
    setRestoreConfirm(null)
    if (result.success) {
      setBackupNotice('Восстановлено — перезагрузка данных...')
      onRestored()
    }
  }

  const handleExport = async (): Promise<void> => {
    const result = await window.api.backup.exportToFile()
    if (result.success) {
      setBackupNotice('Экспорт сохранён')
      setTimeout(() => setBackupNotice(''), 3000)
    }
  }

  const handleImport = async (): Promise<void> => {
    const result = await window.api.backup.importFromFile()
    if (result.success) {
      setBackupNotice('Импорт успешен — перезагрузка данных...')
      onRestored()
    }
  }

  const inputCls =
    'w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none'
  const sectionCls = 'rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3'
  const smallBtn =
    'flex items-center gap-1.5 rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700 transition-colors'

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          transition={{ duration: 0.2 }}
          className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-neutral-800 bg-[#141414] p-6 shadow-2xl"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-neutral-100">Настройки</h2>
            <button
              onClick={onClose}
              title="Закрыть"
              className="rounded-md p-1 text-neutral-500 hover:text-neutral-300"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-4">
            {/* PIN */}
            <div className={sectionCls}>
              <h3 className="flex items-center gap-2 text-sm font-medium text-neutral-300">
                <Lock className="h-4 w-4" />
                Защита PIN-кодом
              </h3>
              <p className="text-xs text-neutral-500">
                {pinStatus?.enabled ? 'PIN включён — запрашивается при запуске.' : 'PIN отключён.'}
              </p>
              {pinNotice && <p className="text-xs text-green-400">{pinNotice}</p>}
              {pinMode === 'none' && (
                <div className="flex flex-wrap gap-2">
                  {pinStatus?.enabled ? (
                    <>
                      <button onClick={() => setPinMode('setup')} className={smallBtn}>
                        Сменить PIN
                      </button>
                      <button
                        onClick={() => setPinMode('disable')}
                        className="flex items-center gap-1.5 rounded-md bg-red-950/40 px-3 py-1.5 text-xs font-medium text-red-300 transition-colors hover:bg-red-900/50"
                      >
                        Отключить PIN
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setPinMode('setup')} className={smallBtn}>
                      Включить PIN
                    </button>
                  )}
                </div>
              )}
              {pinMode === 'setup' && (
                <div className="space-y-2">
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={newPin}
                    onChange={(e) => {
                      setNewPin(e.target.value.replace(/\D/g, ''))
                      setPinError('')
                    }}
                    placeholder="Новый PIN (6 цифр)"
                    autoFocus
                    className={inputCls}
                  />
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={confirmPin}
                    onChange={(e) => {
                      setConfirmPin(e.target.value.replace(/\D/g, ''))
                      setPinError('')
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleSetPin()
                    }}
                    placeholder="Подтвердите PIN"
                    className={inputCls}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => void handleSetPin()}
                      disabled={newPin.length !== 6 || confirmPin.length !== 6}
                      className="rounded-md bg-green-900/50 px-3 py-1.5 text-xs font-medium text-green-300 hover:bg-green-900 disabled:opacity-40"
                    >
                      Сохранить PIN
                    </button>
                    <button
                      onClick={resetPinForms}
                      className="rounded-md px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              )}
              {pinMode === 'disable' && (
                <div className="space-y-2">
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={currentPin}
                    onChange={(e) => {
                      setCurrentPin(e.target.value.replace(/\D/g, ''))
                      setPinError('')
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleDisablePin()
                    }}
                    placeholder="Текущий PIN"
                    autoFocus
                    className={inputCls}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => void handleDisablePin()}
                      disabled={currentPin.length !== 6}
                      className="rounded-md bg-red-900/50 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-900 disabled:opacity-40"
                    >
                      Отключить
                    </button>
                    <button
                      onClick={resetPinForms}
                      className="rounded-md px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              )}
              {pinError && (
                <p className="flex items-center gap-2 text-xs text-red-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {pinError}
                </p>
              )}
            </div>

            {/* Бекапы */}
            <div className={sectionCls}>
              <h3 className="flex items-center gap-2 text-sm font-medium text-neutral-300">
                <HardDrive className="h-4 w-4" />
                Бэкапы
              </h3>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => void handleCreateBackup()} disabled={creatingBackup} className={smallBtn}>
                  <Plus className="h-3.5 w-3.5" />
                  {creatingBackup ? 'Создаётся...' : 'Создать сейчас'}
                </button>
                <button onClick={() => void handleExport()} className={smallBtn}>
                  <ArrowDownToLine className="h-3.5 w-3.5" />
                  Экспорт в файл
                </button>
                <button onClick={() => void handleImport()} className={smallBtn}>
                  <ArrowUpFromLine className="h-3.5 w-3.5" />
                  Импорт из файла
                </button>
              </div>
              {backupNotice && <p className="text-xs text-green-400">{backupNotice}</p>}
              {backups.length === 0 ? (
                <p className="text-xs text-neutral-600">
                  Нет бэкапов · автобэкап каждые 30 минут
                </p>
              ) : (
                <div className="max-h-48 space-y-1.5 overflow-y-auto">
                  {backups.map((b) => (
                    <div
                      key={b.filename}
                      className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs"
                    >
                      <span className="flex-1 text-neutral-300">{formatTs(b.timestamp)}</span>
                      <span className="shrink-0 text-neutral-600">
                        {b.transactionCount} тр. · {b.obligationCount} об. · {formatSize(b.size)}
                      </span>
                      {restoreConfirm === b.filename ? (
                        <>
                          <span className="text-amber-400">Заменить текущие данные?</span>
                          <button
                            onClick={() => void handleRestore(b.filename)}
                            className="rounded bg-amber-900/50 px-2 py-0.5 text-amber-300 hover:bg-amber-900"
                          >
                            Да
                          </button>
                          <button
                            onClick={() => setRestoreConfirm(null)}
                            title="Отмена"
                            className="text-neutral-500 hover:text-neutral-300"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setRestoreConfirm(b.filename)}
                          className="flex items-center gap-1 rounded bg-neutral-800 px-2 py-0.5 text-neutral-300 hover:bg-neutral-700"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Восстановить
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* О программе */}
            <div className={sectionCls}>
              <h3 className="flex items-center gap-2 text-sm font-medium text-neutral-300">
                <Info className="h-4 w-4" />
                О программе
              </h3>
              <p className="text-xs text-neutral-500">
                Maulwurf · v{APP_VERSION} · все данные хранятся локально
              </p>
              <button onClick={() => void window.api.openDevTools()} className={smallBtn}>
                <Wrench className="h-3.5 w-3.5" />
                Открыть DevTools
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </>
  )
}
