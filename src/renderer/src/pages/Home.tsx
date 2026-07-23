import { useState, useEffect, useRef } from 'react'
import maulwurflogo from '../assets/maulwurflogo.png'
import { motion, AnimatePresence } from 'framer-motion'
import { CalendarClock, Plus, ArrowLeft, Bug, X, History, Settings } from 'lucide-react'
import type { Period, PeriodRange } from '../types'
import { useStore } from '../store/useStore'
import { Dashboard } from '../components/Dashboard'
import { TransactionForm } from '../components/TransactionForm'
import { ImportPaste } from '../components/ImportPaste'
import { ObligationsTab } from '../components/ObligationsTab'

import { ErrorRegistry } from '../components/ErrorRegistry'
import { ErrorToastContainer } from '../components/ErrorToastContainer'
import { NotificationToastContainer } from '../components/NotificationToastContainer'
import { HistoryModal } from '../components/HistoryModal'
import { SettingsModal } from '../components/SettingsModal'
import { installGlobalErrorHandlers, setCurrentPage } from '../services/errorRegistry'
import { evaluate as evaluateNotifications } from '../services/notificationEngine'
import { emitNotificationToast } from '../services/notificationToastBus'
import { formatLocalDate } from '../utils/financialEngine'


type Page = 'home' | 'form' | 'import' | 'obligations'

const pageVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 }
}

const pageTransition = { duration: 0.25, ease: [0.4, 0, 0.2, 1] }

export function Home(): React.JSX.Element {
  const {
    transactions,
    obligations,
    obligationMonths,
    importHistory,
    debtResolutions,
    ollamaSettings,
    accountBalances,
    financialSnapshot,
    undoHistory,
    redoStack,
    loading,
    addTransaction,
    updateTransactionComment,
    addManyTransactions,
    deleteTransaction,
    addObligation,
    updateObligation,
    deleteObligation,
    setObligationStatus,
    getObligationMonth,
    getObligationMonthsSnapshot,
    carryObligationDebt,
    setCarriedPaid,
    returnCarriedObligation,
    clearAllTransactions,
    addImportRecord,
    deleteTransactionBatch,
    addDebtResolution,
    deleteDebtResolution,
    updateOllamaSettings,
    updateAccountBalance,
    pushUndo,
    undo,
    redo,
    customSections,
    addCustomSection,
    deleteCustomSection,
    renameCustomSection,
    appSettings,
    saveAppSettings,
    priorityObligationIds,
    addPriorityObligation,
    removePriorityObligation,
    notificationsState,
    saveNotificationsState,
    errorRegistry,
    changeLog,
    addError,
    resolveError,
    clearResolvedErrors,
    getBreadcrumbs,
    refresh,
  } = useStore()
  const [page, setPage] = useState<Page>('home')
  const [errorDrawerOpen, setErrorDrawerOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [splashDone, setSplashDone] = useState(false)
  const [period, setPeriod] = useState<Period>('this_month')
  const [customRange, setCustomRange] = useState<PeriodRange>({
    from: formatLocalDate(new Date()),
    to: formatLocalDate(new Date())
  })

  // Install global error handlers once
  useEffect(() => {
    installGlobalErrorHandlers({ addError, getBreadcrumbs })
  }, [addError, getBreadcrumbs])

  // Track page for error breadcrumbs
  useEffect(() => {
    setCurrentPage(page)
  }, [page])

  // Dismiss splash once data loaded (min 1.4s for animation)
  useEffect(() => {
    if (!loading) {
      const t = setTimeout(() => setSplashDone(true), 1400)
      return () => clearTimeout(t)
    }
    return undefined
  }, [loading])

  // In-app уведомления (Фаза 8). Home монтируется только после PIN-unlock (App.tsx),
  // так что PIN-гейт соблюдён. Свежие данные читаем через ref (эффект не пересоздаёт
  // таймер на каждое изменение обязательств); дедуп в notificationsState не даёт спама.
  const notifDataRef = useRef({ financialSnapshot, obligations, obligationMonths, notificationsState, enabled: appSettings.notificationsEnabled })
  notifDataRef.current = { financialSnapshot, obligations, obligationMonths, notificationsState, enabled: appSettings.notificationsEnabled }
  useEffect(() => {
    if (loading) return undefined
    const run = (): void => {
      const d = notifDataRef.current
      if (!d.enabled) return
      const { notifications, nextState } = evaluateNotifications({
        snapshot: d.financialSnapshot,
        obligations: d.obligations,
        obligationMonths: d.obligationMonths,
        now: new Date(),
        state: d.notificationsState,
      })
      if (notifications.length > 0) {
        notifications.forEach(emitNotificationToast)
        void saveNotificationsState(nextState)
      }
    }
    run() // на старте (после unlock)
    // По интервалу — чтобы поймать переход через полночь / 1-е число при открытом окне.
    const interval = setInterval(run, 45 * 60 * 1000)
    return () => clearInterval(interval)
  }, [loading, saveNotificationsState])

  const unresolvedErrorCount = errorRegistry.filter((e) => !e.resolved).length

  if (!splashDone) {
    return (
      <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-[#0f0f0f]">
        <motion.img
          src={maulwurflogo}
          alt="Logo"
          className="h-40 w-40 object-contain"
          style={{ imageRendering: 'auto' }}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
        />
        <motion.div
          className="mt-8 flex gap-1.5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.3 }}
        >
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="block h-1.5 w-1.5 rounded-full bg-neutral-500"
              animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
              transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
            />
          ))}
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-neutral-200">
      <header className="border-b border-neutral-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
              <img
                src={maulwurflogo}
                alt="Maulwurf Logo"
                className="h-[70px] w-auto max-h-[70px]"
            />
          </div>
          <nav className="flex gap-1.5">
            <button
              onClick={() => setPage('obligations')}
              className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition-all duration-200 hover:-translate-y-px active:translate-y-px ${
                page === 'obligations'
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-600/25'
                  : 'border border-blue-500/25 text-blue-400 hover:border-blue-500/50 hover:bg-blue-950/30'
              }`}
            >
              <CalendarClock className="h-3.5 w-3.5" />
              Обязательства
            </button>

            <button
              onClick={() => setPage('form')}
              className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition-all duration-200 hover:-translate-y-px active:translate-y-px ${
                page === 'form'
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-600/25'
                  : 'border border-blue-500/25 text-blue-400 hover:border-blue-500/50 hover:bg-blue-950/30'
              }`}
            >
              <Plus className="h-4 w-4 stroke-[2.5]" />
              Новая запись
            </button>
            <div className="mx-1 w-px bg-neutral-800" />
            <button
              onClick={() => setPage('home')}
              className={`rounded-md px-3 py-1.5 text-sm transition-all duration-200 hover:-translate-y-px active:translate-y-px ${
                page === 'home'
                  ? 'bg-neutral-800 text-white'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
              }`}
            >
              Обзор
            </button>
            <div className="mx-1 w-px bg-neutral-800" />
            <button
              onClick={() => setSettingsOpen(true)}
              title="Настройки"
              className="rounded-md px-2.5 py-1.5 text-neutral-400 transition-all duration-200 hover:-translate-y-px hover:bg-neutral-800/50 hover:text-neutral-200 active:translate-y-px"
            >
              <Settings className="h-4 w-4" />
            </button>
          </nav>
        </div>
      </header>

      {page !== 'home' && (
        <button
          onClick={() => setPage('home')}
          className="ml-6 mt-2 inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
          title="Назад к обзору"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Назад
        </button>
      )}

      <main className="mx-auto max-w-5xl p-6">
        <AnimatePresence mode="wait">
          {page === 'home' && (
            <motion.div
              key="home"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={pageTransition}
            >
              <Dashboard
                transactions={transactions}
                debtResolutions={debtResolutions}
                period={period}
                customRange={customRange}
                onPeriodChange={setPeriod}
                onCustomRangeChange={setCustomRange}
                onDelete={deleteTransaction}
                onClearAll={clearAllTransactions}
                onAddDebtResolution={addDebtResolution}
                onDeleteDebtResolution={deleteDebtResolution}
                accountBalances={accountBalances}
                financialSnapshot={financialSnapshot}
                onUpdateBalance={updateAccountBalance}
                undoHistory={undoHistory}
                redoStack={redoStack}
                onUndo={undo}
                onRedo={redo}
                importHistory={importHistory}
                onNavigateToImport={() => setPage('import')}
                onAddTransaction={addTransaction}
                onUpdateComment={updateTransactionComment}
              />
            </motion.div>
          )}
          {page === 'form' && (
            <motion.div
              key="form"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={pageTransition}
            >
              <TransactionForm onSave={addTransaction} />
            </motion.div>
          )}
          {page === 'import' && (
            <motion.div
              key="import"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={pageTransition}
            >
              <ImportPaste
                onImport={addManyTransactions}
                onAddImportRecord={addImportRecord}
                onDeleteBatch={deleteTransactionBatch}
                importHistory={importHistory}
              />
            </motion.div>
          )}
          {page === 'obligations' && (
            <motion.div
              key="obligations"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={pageTransition}
            >
              <ObligationsTab
                obligations={obligations}
                obligationMonths={obligationMonths}
                undoHistory={undoHistory}
                redoStack={redoStack}
                customSections={customSections}
                onAdd={addObligation}
                onUpdate={updateObligation}
                onDelete={deleteObligation}
                onStatusChange={setObligationStatus}
                getMonthRecord={getObligationMonth}
                getObligationMonthsSnapshot={getObligationMonthsSnapshot}
                onUndo={undo}
                onRedo={redo}
                pushUndo={pushUndo}
                onAddSection={addCustomSection}
                onDeleteSection={deleteCustomSection}
                onRenameSection={renameCustomSection}
                onCarryDebt={carryObligationDebt}
                onSetCarriedPaid={setCarriedPaid}
                onReturnCarried={returnCarriedObligation}
                installmentLabel={appSettings.installmentLabel}
                onRenameInstallmentLabel={(label) => void saveAppSettings({ installmentLabel: label })}
                prioritySectionEnabled={appSettings.prioritySectionEnabled}
                onTogglePrioritySection={(enabled) => void saveAppSettings({ prioritySectionEnabled: enabled })}
                priorityObligationIds={priorityObligationIds}
                onAddPriority={(id) => void addPriorityObligation(id)}
                onRemovePriority={(id) => void removePriorityObligation(id)}
              />
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      {/* Footer history icon */}
      <button
        onClick={() => setHistoryOpen(true)}
        className="fixed bottom-3 left-20 z-40 flex items-center gap-1 rounded-full bg-neutral-900/80 border border-neutral-800 px-2.5 py-1.5 text-neutral-500 hover:text-neutral-300 hover:border-neutral-600 transition-colors backdrop-blur-sm"
        title="История и бэкапы"
      >
        <History className="h-3.5 w-3.5" />
        <span className="text-[10px]">{changeLog.length > 0 ? changeLog.length : ''}</span>
      </button>

      {/* Footer bug icon — error registry toggle */}
      <button
        onClick={() => setErrorDrawerOpen(true)}
        className="fixed bottom-3 left-3 z-40 flex items-center gap-1 rounded-full bg-neutral-900/80 border border-neutral-800 px-2.5 py-1.5 text-neutral-500 hover:text-neutral-300 hover:border-neutral-600 transition-colors backdrop-blur-sm"
        title="Реестр ошибок"
      >
        <Bug className="h-3.5 w-3.5" />
        {unresolvedErrorCount > 0 ? (
          <span className="min-w-[16px] rounded-full bg-red-900/70 px-1 text-center text-[10px] font-medium text-red-300">
            {unresolvedErrorCount}
          </span>
        ) : (
          <span className="min-w-[16px] rounded-full bg-green-900/70 px-1 text-center text-[10px] font-medium text-green-400">
            ✓
          </span>
        )}
      </button>

      {/* Error registry side drawer */}
      <AnimatePresence>
        {errorDrawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setErrorDrawerOpen(false)}
              className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg border-l border-neutral-800 bg-[#0f0f0f] shadow-2xl overflow-y-auto"
            >
              <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
                <span className="text-sm font-medium text-neutral-200">Реестр ошибок</span>
                <button
                  onClick={() => setErrorDrawerOpen(false)}
                  className="rounded p-1 text-neutral-500 hover:text-neutral-300"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ErrorRegistry
                errors={errorRegistry}
                onResolve={resolveError}
                onClearResolved={clearResolvedErrors}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* History & backups modal */}
      <AnimatePresence>
        {historyOpen && (
          <HistoryModal
            changeLog={changeLog}
            onClose={() => setHistoryOpen(false)}
            onRestored={async () => {
              await refresh()
              setHistoryOpen(false)
            }}
          />
        )}
      </AnimatePresence>

      {/* Settings modal */}
      <AnimatePresence>
        {settingsOpen && (
          <SettingsModal
            onClose={() => setSettingsOpen(false)}
            onRestored={async () => {
              await refresh()
              setSettingsOpen(false)
            }}
            notificationsEnabled={appSettings.notificationsEnabled}
            onToggleNotifications={(enabled) => void saveAppSettings({ notificationsEnabled: enabled })}
          />
        )}
      </AnimatePresence>

      {/* Error toast notifications (справа) */}
      <ErrorToastContainer />
      {/* In-app уведомления (слева, Фаза 8) */}
      <NotificationToastContainer />
    </div>
  )
}
