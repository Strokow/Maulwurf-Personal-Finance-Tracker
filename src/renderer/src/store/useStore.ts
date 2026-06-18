import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  Transaction,
  TransactionPair,
  TransactionGroup,
  GroupStatus,
  AppData,
  Obligation,
  ObligationMonth,
  ObligationStatus,
  ImportRecord,
  DebtResolution,
  DebtResolutionType,
  OllamaSettings,
  AccountBalance,
  FinancialSnapshot,
  OllamaResult,
  FinancialBrainResult,
  HistoryEntry,
  ErrorRecord,
  PinSettings,
  AppDataExtended,
  ObligationSection,
  ChangeLogEntry,
  ChangeLogCategory,
} from '../types'
import { computeSnapshot, formatLocalDate } from '../utils/financialEngine'
import { sanitizeTransaction, sanitizeTransactions } from '../utils/sanitize'
import { pushHistory } from '../services/historyService'
import { captureError, pushBreadcrumb } from '../services/errorRegistry'

/**
 * Group related transactions (failed debit + refund + fee) using heuristics:
 * matching amount, similar description/chain, dates within ±3 days.
 * Also uses paymentGroupId when available.
 */
export function getTransactionGroups(transactions: Transaction[]): {
  groups: TransactionGroup[]
  ungrouped: Transaction[]
} {
  const assigned = new Set<string>()
  const groups: TransactionGroup[] = []

  // Phase 1: group by explicit paymentGroupId
  const byGroupId = new Map<string, Transaction[]>()
  for (const t of transactions) {
    if (t.paymentGroupId) {
      const list = byGroupId.get(t.paymentGroupId) ?? []
      list.push(t)
      byGroupId.set(t.paymentGroupId, list)
    }
  }
  for (const [gid, txs] of byGroupId) {
    const hasFailed = txs.length > 1 && txs.some((t) => t.type === 'failed_debit')
    const hasWieder = txs.some(
      (t) => t.sparkasseType === 'wiedergutschrift' ||
             t.description?.toLowerCase().includes('wiedergutschrift')
    )
    const hasFee = txs.some((t) => t.type === 'penalty')
    // Only group if it's a real Rücklastschrift chain: failed_debit + (Wiedergutschrift OR fee)
    if (hasFailed && (hasWieder || hasFee)) {
      for (const t of txs) assigned.add(t.id)
      groups.push(buildGroup(`pg-${gid}`, txs))
    }
    // Everything else (Revolut payments, plain income groups etc.) → ungrouped
  }

  // Phase 2: heuristic grouping on remaining transactions
  const remaining = transactions.filter((t) => !assigned.has(t.id))
  const failedDebits = remaining.filter((t) => t.type === 'failed_debit')
  const incomes = remaining.filter((t) => t.type === 'income')
  const penalties = remaining.filter((t) => t.type === 'penalty')

  for (const fd of failedDebits) {
    if (assigned.has(fd.id)) continue
    const fdDate = new Date(fd.date).getTime()
    const cluster: Transaction[] = [fd]
    const clusterIds: string[] = [fd.id]

    // Find matching wiedergutschrift: by sparkasseType OR description keyword (backward compat)
    let bestWieder: Transaction | null = null
    let bestDays = Infinity
    for (const w of incomes) {
      if (assigned.has(w.id)) continue
      const isWieder =
        w.sparkasseType === 'wiedergutschrift' ||
        !!(w.description?.toLowerCase().includes('wiedergutschrift'))
      if (!isWieder) continue
      const wDate = new Date(w.date).getTime()
      const days = Math.round((wDate - fdDate) / 86400000)
      if (days < 0 || days > 14) continue
      if (Math.abs(w.amount - fd.amount) > 0.5) continue
      if (days < bestDays) {
        bestDays = days
        bestWieder = w
      }
    }
    if (bestWieder) {
      cluster.push(bestWieder)
      clusterIds.push(bestWieder.id)
    }

    // Find matching entgelt (Sparkasse 1.50€ fee): must be explicitly a Sparkasse Entgelt
    let bestFee: Transaction | null = null
    let bestFeeDist = Infinity
    for (const e of penalties) {
      if (assigned.has(e.id)) continue
      const isEntgelt =
        e.sparkasseType === 'entgelt' ||
        !!(e.description?.toLowerCase().includes('entgelt')) ||
        !!(e.description?.toLowerCase().includes('rückgabe entgelt')) ||
        !!(e.description?.toLowerCase().includes('rucklastschrift'))
      if (!isEntgelt) continue
      const eDate = new Date(e.date).getTime()
      const dist = Math.abs(eDate - fdDate) / 86400000
      if (dist <= 3 && dist < bestFeeDist) {
        bestFeeDist = dist
        bestFee = e
      }
    }
    if (bestFee) {
      cluster.push(bestFee)
      clusterIds.push(bestFee.id)
    }

    // Only group if there are related transactions (Wiedergutschrift or fee found)
    // A lone failed_debit goes to ungrouped instead
    if (cluster.length > 1) {
      for (const id of clusterIds) assigned.add(id)
      groups.push(buildGroup(`h-${fd.id}`, cluster))
    }
  }

  const ungrouped = transactions.filter((t) => !assigned.has(t.id))
  return {
    groups: groups.sort((a, b) => {
      const aDate = a.transactions[0].date
      const bDate = b.transactions[0].date
      return bDate.localeCompare(aDate)
    }),
    ungrouped
  }
}

function buildGroup(id: string, txs: Transaction[]): TransactionGroup {
  const hasFailed = txs.some((t) => t.type === 'failed_debit')
  const hasRefund = txs.some(
    (t) =>
      t.type === 'income' &&
      (t.sparkasseType === 'wiedergutschrift' ||
        t.description?.toLowerCase().includes('wiedergutschrift'))
  )

  let status: GroupStatus = 'successful'
  if (hasFailed && hasRefund) status = 'refunded'
  else if (hasFailed) status = 'failed'

  // Label from the failed_debit or first transaction
  const primary = txs.find((t) => t.type === 'failed_debit') ?? txs[0]
  const label = primary.description ?? primary.source

  // Net effect: income positive, everything else negative
  const netEffect = txs.reduce((sum, t) => {
    if (t.type === 'income') return sum + t.amount
    return sum - t.amount
  }, 0)

  return {
    id,
    status,
    label,
    netEffect,
    transactions: txs.sort((a, b) => a.date.localeCompare(b.date))
  }
}

export function getPairedTransactions(transactions: Transaction[]): TransactionPair[] {
  const rueckItems = transactions.filter((t) => t.sparkasseType === 'ruecklastschrift')
  const wiederItems = transactions.filter((t) => t.sparkasseType === 'wiedergutschrift')
  const entgeltItems = transactions.filter((t) => t.sparkasseType === 'entgelt')

  const usedWieder = new Set<string>()
  const usedEntgelt = new Set<string>()

  const pairs: TransactionPair[] = []

  for (const rueck of rueckItems) {
    const rueckDate = new Date(rueck.date).getTime()
    const rueckChain = rueck.paymentChain ?? 'sparkasse_direct'

    // Match WIEDERGUTSCHRIFT: same chain, 1-5 days after, amount within €0.50
    let bestWieder: Transaction | null = null
    let bestWiederDays = Infinity

    for (const w of wiederItems) {
      if (usedWieder.has(w.id)) continue
      const wDate = new Date(w.date).getTime()
      const daysDiff = Math.round((wDate - rueckDate) / 86400000)
      if (daysDiff < 1 || daysDiff > 5) continue
      const wChain = w.paymentChain ?? 'sparkasse_direct'
      if (wChain !== rueckChain) continue
      if (Math.abs(w.amount - rueck.amount) > 0.5) continue
      if (daysDiff < bestWiederDays) {
        bestWiederDays = daysDiff
        bestWieder = w
      }
    }

    if (bestWieder) usedWieder.add(bestWieder.id)

    // Match ENTGELT: same source (Sparkasse), within 2 days, sparkasseType === 'entgelt'
    let bestEntgelt: Transaction | null = null
    let bestEntgeltDist = Infinity

    for (const e of entgeltItems) {
      if (usedEntgelt.has(e.id)) continue
      if (e.source !== 'Sparkasse') continue
      const eDate = new Date(e.date).getTime()
      const dist = Math.abs(eDate - rueckDate) / 86400000
      if (dist <= 2 && dist < bestEntgeltDist) {
        bestEntgeltDist = dist
        bestEntgelt = e
      }
    }

    if (bestEntgelt) usedEntgelt.add(bestEntgelt.id)

    pairs.push({
      ruecklastschrift: rueck,
      wiedergutschrift: bestWieder,
      entgelt: bestEntgelt,
      daysBetween: bestWieder ? Math.round(bestWiederDays) : null,
      totalCost: bestEntgelt?.amount ?? 0
    })
  }

  return pairs.sort((a, b) => b.ruecklastschrift.date.localeCompare(a.ruecklastschrift.date))
}

const defaultObligations: Omit<Obligation, 'id' | 'createdAt'>[] = [
  {
    name: 'Netflix',
    type: 'subscription',
    amount: null,
    approximateDay: null,
    billingChain: 'sparkasse_direct',
    source: 'Sparkasse',
    isActive: true
  },
  {
    name: 'Spotify',
    type: 'subscription',
    amount: null,
    approximateDay: null,
    billingChain: 'vodafone_contract',
    source: 'Sparkasse',
    isActive: true
  },
  {
    name: 'Apple',
    type: 'subscription',
    amount: null,
    approximateDay: null,
    billingChain: 'vodafone_contract',
    source: 'Sparkasse',
    isActive: true
  },
  {
    name: 'DVB Monatskarte',
    type: 'subscription',
    amount: 29.0,
    approximateDay: 1,
    billingChain: 'sparkasse_direct',
    source: 'Sparkasse',
    isActive: true
  },
  {
    name: 'Vodafone Vertrag',
    type: 'subscription',
    amount: null,
    approximateDay: null,
    billingChain: 'sparkasse_direct',
    source: 'Sparkasse',
    isActive: true
  },
  {
    name: 'PYUR Internet',
    type: 'subscription',
    amount: null,
    approximateDay: 2,
    billingChain: 'sparkasse_direct',
    source: 'Sparkasse',
    isActive: true
  },
  {
    name: 'Deutschlandticket',
    type: 'subscription',
    amount: 58.0,
    approximateDay: 1,
    billingChain: 'sparkasse_direct',
    source: 'Sparkasse',
    isActive: true
  },
  {
    name: 'PayPal',
    type: 'manual_payment',
    amount: null,
    approximateDay: null,
    billingChain: 'paypal',
    source: 'Sparkasse',
    isActive: true
  }
]

export interface UseStoreReturn {
  transactions: Transaction[]
  obligations: Obligation[]
  obligationMonths: ObligationMonth[]
  importHistory: ImportRecord[]
  debtResolutions: DebtResolution[]
  ollamaSettings: OllamaSettings
  accountBalances: AccountBalance[]
  financialSnapshot: FinancialSnapshot | null
  financialBrainCache: OllamaResult<FinancialBrainResult> | null
  undoHistory: HistoryEntry[]
  redoStack: HistoryEntry[]
  errorRegistry: ErrorRecord[]
  pinSettings: PinSettings
  breadcrumbBuffer: string[]
  customSections: ObligationSection[]
  changeLog: ChangeLogEntry[]
  loading: boolean
  addTransaction: (t: Omit<Transaction, 'id' | 'createdAt'>) => Promise<void>
  addManyTransactions: (ts: Transaction[]) => Promise<void>
  deleteTransaction: (id: string) => Promise<void>
  updateTransactionComment: (id: string, comment: string) => Promise<void>
  addObligation: (o: Omit<Obligation, 'id' | 'createdAt'>, createdAt?: string) => Promise<Obligation>
  updateObligation: (id: string, updates: Partial<Obligation>) => Promise<void>
  deleteObligation: (id: string) => Promise<void>
  setObligationStatus: (
    obligationId: string,
    year: number,
    month: number,
    status: ObligationStatus,
    transactionId?: string
  ) => Promise<void>
  getObligationMonth: (obligationId: string, year: number, month: number) => ObligationMonth | null
  carryObligationDebt: (obligationId: string, fromYear: number, fromMonth: number, toYear: number, toMonth: number) => Promise<void>
  setCarriedPaid: (obligationId: string, year: number, month: number, paid: boolean) => Promise<void>
  autoMatchObligations: (transactions: Transaction[]) => Promise<void>
  clearAllTransactions: () => Promise<void>
  addImportRecord: (record: ImportRecord) => Promise<void>
  deleteTransactionBatch: (batchId: string) => Promise<void>
  addDebtResolution: (
    failedDebitId: string,
    type: DebtResolutionType,
    monthlyAmount?: number,
    note?: string
  ) => Promise<void>
  deleteDebtResolution: (id: string) => Promise<void>
  updateOllamaSettings: (settings: OllamaSettings) => Promise<void>
  refresh: () => Promise<void>
  addError: (record: ErrorRecord) => void
  resolveError: (id: string) => void
  clearResolvedErrors: () => Promise<void>
  getBreadcrumbs: () => string[]
  pushUndo: (action: string, before: Partial<AppData>, after: Partial<AppData>) => void
  undo: () => Promise<void>
  redo: () => Promise<void>
  updateAccountBalance: (id: string, balance: number) => Promise<void>
  saveSnapshot: (snap: FinancialSnapshot) => Promise<void>
  saveFinancialBrainCache: (result: OllamaResult<FinancialBrainResult>) => Promise<void>
  addCustomSection: (name: string) => Promise<ObligationSection>
  deleteCustomSection: (id: string) => Promise<void>
  renameCustomSection: (id: string, name: string) => Promise<void>
}

const DEFAULT_OLLAMA_SETTINGS: OllamaSettings = {
  baseUrl: 'http://localhost:11434',
  model: 'qwen2.5:7b',
  availableModels: []
}

export function useStore(): UseStoreReturn {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [obligations, setObligations] = useState<Obligation[]>([])
  const [obligationMonths, setObligationMonths] = useState<ObligationMonth[]>([])
  // Зеркало obligationMonths в ref: используется для НАДЁЖНОГО снятия undo-снимков,
  // не зависящего от тайминга React-updater'а (см. setObligationStatus). Синхронизируется
  // и из эффекта (любые внешние изменения), и синхронно в местах записи статусов.
  const obligationMonthsRef = useRef<ObligationMonth[]>([])
  useEffect(() => { obligationMonthsRef.current = obligationMonths }, [obligationMonths])
  const [importHistory, setImportHistory] = useState<ImportRecord[]>([])
  const [debtResolutions, setDebtResolutions] = useState<DebtResolution[]>([])
  const [ollamaSettings, setOllamaSettingsState] = useState<OllamaSettings>(DEFAULT_OLLAMA_SETTINGS)
  const [accountBalances, setAccountBalances] = useState<AccountBalance[]>([])
  const [financialSnapshot, setFinancialSnapshot] = useState<FinancialSnapshot | null>(null)
  const [financialBrainCache, setFinancialBrainCache] = useState<OllamaResult<FinancialBrainResult> | null>(null)
  const [undoHistory, setUndoHistory] = useState<HistoryEntry[]>([])
  const [errorRegistry, setErrorRegistry] = useState<ErrorRecord[]>([])
  const [pinSettings, setPinSettings] = useState<PinSettings>({ enabled: false, pinHash: null, lockoutUntil: null, failedAttempts: 0 })
  const [breadcrumbBuffer, setBreadcrumbBuffer] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([])
  const [customSections, setCustomSections] = useState<ObligationSection[]>([])
  const [changeLog, setChangeLog] = useState<ChangeLogEntry[]>([])

  const refresh = useCallback(async () => {
    const data = (await window.api.store.getAll()) as AppDataExtended
    setTransactions(data.transactions)
    setObligations(data.obligations ?? [])
    setObligationMonths(data.obligationMonths ?? [])
    obligationMonthsRef.current = data.obligationMonths ?? []
    setImportHistory(data.importHistory ?? [])
    setDebtResolutions(data.debtResolutions ?? [])
    setOllamaSettingsState(data.ollamaSettings ?? DEFAULT_OLLAMA_SETTINGS)
    setAccountBalances(data.accountBalances ?? [])
    setFinancialSnapshot(data.financialSnapshot ?? null)
    setFinancialBrainCache(data.financialBrainCache ?? null)
    setUndoHistory(data.undoHistory ?? [])
    setRedoStack(data.redoStack ?? [])
    setErrorRegistry(data.errorRegistry ?? [])
    setPinSettings(data.pinSettings ?? { enabled: false, pinHash: null, lockoutUntil: null, failedAttempts: 0 })
    setBreadcrumbBuffer(data.breadcrumbBuffer ?? [])
    setCustomSections(data.customSections ?? [])
    setChangeLog(data.changeLog ?? [])
    setLoading(false)
  }, [])

  const logChange = useCallback(async (action: string, description: string, category: ChangeLogCategory) => {
    const entry: ChangeLogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      action,
      description,
      category,
    }
    setChangeLog(prev => [entry, ...prev].slice(0, 500))
    await window.api.store.addChangeLog(entry)
  }, [])

  // Seed defaults on first launch
  useEffect(() => {
    const seed = async (): Promise<void> => {
      const data = (await window.api.store.getAll()) as AppData

      // Deduplicate obligations (can happen due to React StrictMode double-invocation)
      if (data.obligations && data.obligations.length > 0) {
        const seen = new Set<string>()
        const deduped: Obligation[] = []
        for (const o of data.obligations) {
          if (!seen.has(o.id)) {
            seen.add(o.id)
            deduped.push(o)
          }
        }
        if (deduped.length < data.obligations.length) {
          await window.api.store.setObligations(deduped)
          data.obligations = deduped
        }
      }

      // Seed base obligations (BUG-008: createdAt антидатирован, иначе сиды исчезают в прошлых месяцах)
      const SEED_CREATED_AT = '2020-01-01T00:00:00.000Z'
      if (!data.obligations || data.obligations.length === 0) {
        for (const o of defaultObligations) {
          const full: Obligation = {
            ...o,
            id: crypto.randomUUID(),
            createdAt: SEED_CREATED_AT
          }
          await window.api.store.addObligation(full)
        }
      }

      // BUG-008 миграция: у ранее засеянных обязательств createdAt был "сегодня".
      // Переписываем на SEED_CREATED_AT у записей, совпадающих по имени с defaultObligations.
      if (!data.seedCreatedAtBackfilled) {
        const seedNames = new Set(defaultObligations.map(o => o.name))
        for (const o of data.obligations ?? []) {
          if (seedNames.has(o.name) && o.createdAt > SEED_CREATED_AT) {
            await window.api.store.updateObligation(o.id, { createdAt: SEED_CREATED_AT })
          }
        }
        await window.api.store.setSeedCreatedAtBackfilled(true)
      }

      // BUG-004 миграция: одноразово удаляем старые klarna-обязательства (seed + импорт)
      // и их ObligationMonth. Новая система Klarna строится с нуля вручную через форму "Добавить".
      if (!data.klarnaResetDone) {
        const klarnaObligationIds = new Set(
          (data.obligations ?? []).filter(o => o.billingChain === 'klarna').map(o => o.id)
        )
        if (klarnaObligationIds.size > 0) {
          const keptObligations = (data.obligations ?? []).filter(o => o.billingChain !== 'klarna')
          await window.api.store.setObligations(keptObligations)
          const keptMonths = (data.obligationMonths ?? []).filter(m => !klarnaObligationIds.has(m.obligationId))
          await window.api.store.setAllObligationMonths(keptMonths)
        }
        await window.api.store.setKlarnaResetDone(true)
      }

      await refresh()
    }
    seed()
  }, [refresh])

  const addTransaction = useCallback(
    async (t: Omit<Transaction, 'id' | 'createdAt'>) => {
      try {
        pushBreadcrumb('Добавление транзакции')
        // Central sanitizer: strip sensitive IDs from description before persisting.
        const transaction: Transaction = sanitizeTransaction({
          ...t,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString()
        })
        await window.api.store.add(transaction)
        await logChange('ADD_TRANSACTION', `Транзакция: ${t.source} ${t.type === 'income' ? '+' : '-'}${t.amount}€`, 'transaction')
        await refresh()
      } catch (e) {
        captureError(e, 'ipc_error', 'addTransaction')
        throw e
      }
    },
    [refresh]
  )

  const addManyTransactions = useCallback(
    async (ts: Transaction[]) => {
      try {
        pushBreadcrumb(`Импорт ${ts.length} транзакций`)
        // Central sanitizer: strip sensitive IDs from every imported description.
        await window.api.store.addMany(sanitizeTransactions(ts))
        await logChange('IMPORT_TRANSACTIONS', `Импортировано ${ts.length} транзакций`, 'import')
        await refresh()
      } catch (e) {
        captureError(e, 'ipc_error', 'addManyTransactions')
        throw e
      }
    },
    [refresh]
  )

  const deleteTransaction = useCallback(
    async (id: string) => {
      try {
        pushBreadcrumb('Удаление транзакции')
        await window.api.store.delete(id)
        await logChange('DELETE_TRANSACTION', `Удалена транзакция`, 'transaction')
        await refresh()
      } catch (e) {
        captureError(e, 'ipc_error', 'deleteTransaction')
        throw e
      }
    },
    [refresh]
  )

  const updateTransactionComment = useCallback(
    async (id: string, comment: string) => {
      try {
        pushBreadcrumb(`Комментарий к транзакции ${id}`)
        const trimmed = comment.trim()
        const patch: Partial<Transaction> = trimmed
          ? { comment: trimmed }
          : { comment: undefined }
        await window.api.store.updateTransaction(id, patch)
        setTransactions(current =>
          current.map(t => (t.id === id ? { ...t, ...patch } : t))
        )
        await logChange(
          'EDIT_TRANSACTION',
          trimmed ? `Комментарий: ${trimmed.slice(0, 40)}` : 'Удалён комментарий',
          'transaction'
        )
      } catch (e) {
        captureError(e, 'ipc_error', 'updateTransactionComment')
        throw e
      }
    },
    []
  )

  const addObligation = useCallback(
    async (o: Omit<Obligation, 'id' | 'createdAt'>, createdAt?: string): Promise<Obligation> => {
      try {
        pushBreadcrumb(`Добавление обязательства: ${o.name}`)
        const obligation: Obligation = {
          ...o,
          id: crypto.randomUUID(),
          createdAt: createdAt ?? new Date().toISOString()
        }
        await window.api.store.addObligation(obligation)
        await logChange('ADD_OBLIGATION', `Обязательство создано: ${o.name}`, 'obligation')
        setObligations(current => [...current, obligation])
        return obligation
      } catch (e) {
        captureError(e, 'ipc_error', 'addObligation')
        throw e
      }
    },
    []
  )

  const updateObligation = useCallback(
    async (id: string, updates: Partial<Obligation>) => {
      try {
        pushBreadcrumb(`Изменение обязательства ${id}`)
        await window.api.store.updateObligation(id, updates)
        await logChange('UPDATE_OBLIGATION', `Обязательство изменено`, 'obligation')
        setObligations(current =>
          current.map(o => (o.id === id ? { ...o, ...updates } : o))
        )
      } catch (e) {
        captureError(e, 'ipc_error', 'updateObligation')
        throw e
      }
    },
    []
  )

  const deleteObligation = useCallback(
    async (id: string) => {
      try {
        pushBreadcrumb('Удаление обязательства')
        await window.api.store.deleteObligation(id)
        await logChange('DELETE_OBLIGATION', `Обязательство удалено`, 'obligation')
        setObligations(current => current.filter(o => o.id !== id))
      } catch (e) {
        captureError(e, 'ipc_error', 'deleteObligation')
        throw e
      }
    },
    []
  )

  const setObligationStatus = useCallback(
    async (
      obligationId: string,
      year: number,
      month: number,
      status: ObligationStatus,
      transactionId?: string
    ) => {
      try {
        pushBreadcrumb(`Статус обязательства ${obligationId} → ${status}`)
        const record: ObligationMonth = {
          obligationId,
          year,
          month,
          status,
          actualAmount: null,
          matchedTransactionId: transactionId,
          paidDate: status === 'paid' ? formatLocalDate(new Date()) : undefined
        }
        await window.api.store.setObligationMonth(record)
        await logChange('SET_OBLIGATION_STATUS', `Статус обязательства → ${status}`, 'obligation')
        // ВАЖНО (data-wipe fix): снимки для undo берём из ref, а НЕ захватываем внутри
        // setState-updater'а. При батчинге (после await) updater мог не успеть выполниться
        // до pushUndo → snapshotBefore/After оставались [] → undo затирал ВСЕ obligationMonths.
        const snapshotBefore = obligationMonthsRef.current
        const existing = snapshotBefore.findIndex(
          m => m.obligationId === obligationId && m.year === year && m.month === month
        )
        const snapshotAfter = existing !== -1
          ? snapshotBefore.map((m, i) => (i === existing ? record : m))
          : [...snapshotBefore, record]
        obligationMonthsRef.current = snapshotAfter // синхронно — чтобы серии вызовов (рассрочки) видели актуальное
        setObligationMonths(snapshotAfter)
        pushUndo(
          `Статус обязательства → ${status}`,
          { obligationMonths: snapshotBefore },
          { obligationMonths: snapshotAfter }
        )
      } catch (e) {
        captureError(e, 'ipc_error', 'setObligationStatus')
        throw e
      }
    },
    []
  )

  const getObligationMonth = useCallback(
    (obligationId: string, year: number, month: number): ObligationMonth | null => {
      return (
        obligationMonths.find(
          (m) => m.obligationId === obligationId && m.year === year && m.month === month
        ) ?? null
      )
    },
    [obligationMonths]
  )

  const carryObligationDebt = useCallback(
    async (obligationId: string, fromYear: number, fromMonth: number, toYear: number, toMonth: number) => {
      try {
        pushBreadcrumb(`Перенос долга ${obligationId} → ${toYear}/${toMonth}`)
        const obligation = obligations.find(o => o.id === obligationId)
        // Если источник уже оплачен — долг считается погашённым (платёж был, просто с опозданием)
        const sourceRecord = obligationMonths.find(
          m => m.obligationId === obligationId && m.year === fromYear && m.month === fromMonth
        )
        const sourcePaid = sourceRecord?.status === 'paid'
        // BUG-009: для подписок с amount=null берём фактическую сумму из исходного месяца,
        // иначе carriedAmount = undefined → дальнейшая математика трактует как 0.
        const carriedAmount = obligation?.amount ?? sourceRecord?.actualAmount ?? undefined
        // Merge с существующей записью целевого месяца (сохраняем status, actualAmount, paidDate)
        const existing = obligationMonths.find(
          m => m.obligationId === obligationId && m.year === toYear && m.month === toMonth
        )
        const record: ObligationMonth = existing
          ? {
              ...existing,
              isCarriedOver: true,
              carriedFromYear: fromYear,
              carriedFromMonth: fromMonth,
              carriedAmount,
              carriedPaid: sourcePaid,
            }
          : {
              obligationId,
              year: toYear,
              month: toMonth,
              status: 'unpaid',
              actualAmount: null,
              isCarriedOver: true,
              carriedFromYear: fromYear,
              carriedFromMonth: fromMonth,
              carriedAmount,
              carriedPaid: sourcePaid,
            }
        await window.api.store.setObligationMonth(record)
        setObligationMonths(current => {
          const idx = current.findIndex(
            m => m.obligationId === obligationId && m.year === toYear && m.month === toMonth
          )
          if (idx !== -1) {
            const updated = [...current]
            updated[idx] = record
            return updated
          }
          return [...current, record]
        })
      } catch (e) {
        captureError(e, 'ipc_error', 'carryObligationDebt')
        throw e
      }
    },
    [obligations, obligationMonths]
  )

  const setCarriedPaid = useCallback(
    async (obligationId: string, year: number, month: number, paid: boolean) => {
      try {
        pushBreadcrumb(`Оплата перенесённого долга ${obligationId}`)
        const existing = obligationMonths.find(
          m => m.obligationId === obligationId && m.year === year && m.month === month
        )
        if (!existing) return
        const record: ObligationMonth = { ...existing, carriedPaid: paid }
        await window.api.store.setObligationMonth(record)
        setObligationMonths(current => {
          const idx = current.findIndex(
            m => m.obligationId === obligationId && m.year === year && m.month === month
          )
          if (idx !== -1) {
            const updated = [...current]
            updated[idx] = record
            return updated
          }
          return current
        })
      } catch (e) {
        captureError(e, 'ipc_error', 'setCarriedPaid')
        throw e
      }
    },
    [obligationMonths]
  )

  const autoMatchObligations = useCallback(
    async (txs: Transaction[]) => {
      const now = new Date()
      const year = now.getFullYear()
      const month = now.getMonth() + 1

      const monthTxs = txs.filter((t) => {
        const d = new Date(t.date)
        return d.getFullYear() === year && d.getMonth() + 1 === month
      })

      for (const ob of obligations) {
        if (!ob.isActive) continue
        const existing = obligationMonths.find(
          (m) => m.obligationId === ob.id && m.year === year && m.month === month
        )
        if (existing && existing.status === 'paid') continue

        const match = monthTxs.find((t) => {
          const descMatch = t.description
            ? t.description.toLowerCase().includes(ob.name.toLowerCase())
            : false
          const chainMatch = t.paymentChain === ob.billingChain
          const amountOk = ob.amount === null || Math.abs(t.amount - ob.amount) / ob.amount <= 0.2
          return (descMatch || chainMatch) && amountOk
        })

        if (match) {
          const record: ObligationMonth = {
            obligationId: ob.id,
            year,
            month,
            status: 'paid',
            actualAmount: match.amount,
            matchedTransactionId: match.id,
            paidDate: match.date
          }
          await window.api.store.setObligationMonth(record)
        }
      }
      await refresh()
    },
    [obligations, obligationMonths, refresh]
  )

  const clearAllTransactions = useCallback(async () => {
    try {
      pushBreadcrumb('Очистка всех транзакций')
      await window.api.store.clearAll()
      await logChange('CLEAR_ALL', 'Все транзакции очищены', 'system')
      await refresh()
    } catch (e) {
      captureError(e, 'ipc_error', 'clearAllTransactions')
      throw e
    }
  }, [refresh])

  const addImportRecord = useCallback(
    async (record: ImportRecord) => {
      try {
        pushBreadcrumb(`Импорт: ${record.bank} (${record.transactionCount} тр.)`)
        await window.api.store.addImportRecord(record)
        await refresh()
      } catch (e) {
        captureError(e, 'ipc_error', 'addImportRecord')
        throw e
      }
    },
    [refresh]
  )

  const deleteTransactionBatch = useCallback(
    async (batchId: string) => {
      try {
        pushBreadcrumb(`Удаление батча: ${batchId}`)
        await window.api.store.deleteImportBatch(batchId)
        await refresh()
      } catch (e) {
        captureError(e, 'ipc_error', 'deleteTransactionBatch')
        throw e
      }
    },
    [refresh]
  )

  const addDebtResolution = useCallback(
    async (
      failedDebitId: string,
      type: DebtResolutionType,
      monthlyAmount?: number,
      note?: string
    ) => {
      try {
        pushBreadcrumb('Добавление резолюции долга')
        const resolution: DebtResolution = {
          id: crypto.randomUUID(),
          failedDebitId,
          type,
          monthlyAmount,
          note,
          resolvedAt: new Date().toISOString()
        }
        await window.api.store.addDebtResolution(resolution)
        await refresh()
      } catch (e) {
        captureError(e, 'ipc_error', 'addDebtResolution')
        throw e
      }
    },
    [refresh]
  )

  const deleteDebtResolution = useCallback(
    async (id: string) => {
      try {
        pushBreadcrumb('Удаление резолюции долга')
        await window.api.store.deleteDebtResolution(id)
        await refresh()
      } catch (e) {
        captureError(e, 'ipc_error', 'deleteDebtResolution')
        throw e
      }
    },
    [refresh]
  )

  const updateOllamaSettings = useCallback(
    async (settings: OllamaSettings) => {
      try {
        pushBreadcrumb('Обновление настроек Ollama')
        await window.api.store.updateOllamaSettings(settings)
        await refresh()
      } catch (e) {
        captureError(e, 'ipc_error', 'updateOllamaSettings')
        throw e
      }
    },
    [refresh]
  )

  // BUG-006: errorRegistry теперь персистится — параллельно с локальным state шлём IPC
  const addError = useCallback((record: ErrorRecord) => {
    setErrorRegistry((prev) => [record, ...prev].slice(0, 100))
    void window.api.store.addError(record)
  }, [])

  const resolveError = useCallback((id: string) => {
    setErrorRegistry((prev) => prev.map((e) => (e.id === id ? { ...e, resolved: true } : e)))
    void window.api.store.updateError(id, { resolved: true })
  }, [])

  const clearResolvedErrors = useCallback(async () => {
    setErrorRegistry((prev) => prev.filter((e) => !e.resolved))
    await window.api.store.clearResolvedErrors()
    await refresh()
  }, [refresh])

  const getBreadcrumbs = useCallback(() => breadcrumbBuffer, [breadcrumbBuffer])

  const pushUndo = useCallback(
    (action: string, before: Partial<AppData>, after: Partial<AppData>) => {
      setUndoHistory(current => {
        const newHistory = pushHistory(current, action, before, after)
        return newHistory
      })
      setRedoStack([]) // Clear redo stack on new action
      // BUG-007: zero out persisted redoStack тоже
      void window.api.store.saveRedoStack([])
    },
    []
  )

  const undo = useCallback(async () => {
    if (undoHistory.length === 0) return
    const [entry, ...rest] = undoHistory
    setUndoHistory(rest)
    setRedoStack([entry, ...redoStack])
    // Apply snapshotBefore (BUG-005: персистим transactions/accountBalances через IPC, иначе теряются после refresh)
    if (entry.snapshotBefore.transactions !== undefined) {
      const txs = entry.snapshotBefore.transactions as Transaction[]
      setTransactions(txs)
      await window.api.store.setTransactions(txs)
    }
    if (entry.snapshotBefore.obligations !== undefined) {
      const obs = entry.snapshotBefore.obligations as Obligation[]
      setObligations(obs)
      await window.api.store.setObligations(obs)
    }
    if (entry.snapshotBefore.obligationMonths !== undefined) {
      const months = entry.snapshotBefore.obligationMonths as ObligationMonth[]
      // Guard (data-wipe fix): нет легитимного действия, очищающего ВСЕ obligationMonths разом.
      // Пустой снимок при непустом текущем состоянии = битая undo-запись → не применяем.
      if (months.length === 0 && obligationMonthsRef.current.length > 0) {
        captureError(
          new Error('Undo пропущен: пустой снимок obligationMonths затёр бы все статусы'),
          'validation_error', 'undo'
        )
      } else {
        obligationMonthsRef.current = months
        setObligationMonths(months)
        await window.api.store.setAllObligationMonths(months)
      }
    }
    if (entry.snapshotBefore.accountBalances !== undefined) {
      const balances = entry.snapshotBefore.accountBalances as AccountBalance[]
      setAccountBalances(balances)
      await window.api.store.setAccountBalances(balances)
    }
    // Save undoHistory and redoStack to store (BUG-007: redoStack теперь персистится)
    await window.api.store.saveUndoHistory(rest)
    await window.api.store.saveRedoStack([entry, ...redoStack])
  }, [undoHistory, redoStack])

  const redo = useCallback(async () => {
    if (redoStack.length === 0) return
    const [entry, ...rest] = redoStack
    setRedoStack(rest)
    setUndoHistory([entry, ...undoHistory])
    // Apply snapshotAfter (BUG-005: персистим transactions/accountBalances через IPC)
    if (entry.snapshotAfter.transactions !== undefined) {
      const txs = entry.snapshotAfter.transactions as Transaction[]
      setTransactions(txs)
      await window.api.store.setTransactions(txs)
    }
    if (entry.snapshotAfter.obligations !== undefined) {
      const obs = entry.snapshotAfter.obligations as Obligation[]
      setObligations(obs)
      await window.api.store.setObligations(obs)
    }
    if (entry.snapshotAfter.obligationMonths !== undefined) {
      const months = entry.snapshotAfter.obligationMonths as ObligationMonth[]
      // Guard (data-wipe fix): см. undo — пустой снимок при непустом состоянии не применяем.
      if (months.length === 0 && obligationMonthsRef.current.length > 0) {
        captureError(
          new Error('Redo пропущен: пустой снимок obligationMonths затёр бы все статусы'),
          'validation_error', 'redo'
        )
      } else {
        obligationMonthsRef.current = months
        setObligationMonths(months)
        await window.api.store.setAllObligationMonths(months)
      }
    }
    if (entry.snapshotAfter.accountBalances !== undefined) {
      const balances = entry.snapshotAfter.accountBalances as AccountBalance[]
      setAccountBalances(balances)
      await window.api.store.setAccountBalances(balances)
    }
    // Save undoHistory and redoStack to store (BUG-007: redoStack теперь персистится)
    await window.api.store.saveUndoHistory([entry, ...undoHistory])
    await window.api.store.saveRedoStack(rest)
  }, [redoStack, undoHistory])

  const updateAccountBalance = useCallback(
    async (id: string, balance: number) => {
      try {
        pushBreadcrumb(`Обновление баланса ${id}`)
        const nowIso = new Date().toISOString()
        const updated = accountBalances.map((acc) =>
          acc.id === id
            ? { ...acc, balance, balanceDate: nowIso.split('T')[0], updatedAt: nowIso }
            : acc
        )
        const updatedAcc = updated.find((a) => a.id === id)
        if (updatedAcc) {
          await window.api.store.updateAccountBalance(updatedAcc)
        }
        setAccountBalances(updated)
        // Полный контекст для snapshot — без obligationMonths/klarnaResetDone/importHistory/debtResolutions падал TypeError
        const snapshot = computeSnapshot({
          accountBalances: updated,
          transactions,
          obligations,
          obligationMonths,
        } as AppDataExtended)
        setFinancialSnapshot(snapshot)
        await window.api.store.saveSnapshot(snapshot)
        await refresh()
      } catch (e) {
        captureError(e, 'ipc_error', 'updateAccountBalance')
        throw e
      }
    },
    [accountBalances, transactions, obligations, obligationMonths, refresh]
  )

  const saveSnapshot = useCallback(
    async (snap: FinancialSnapshot) => {
      try {
        await window.api.store.saveSnapshot(snap)
        setFinancialSnapshot(snap)
      } catch (e) {
        captureError(e, 'ipc_error', 'saveSnapshot')
        throw e
      }
    },
    []
  )

  const saveFinancialBrainCache = useCallback(
    async (result: OllamaResult<FinancialBrainResult>) => {
      setFinancialBrainCache(result)
      await refresh()
    },
    [refresh]
  )

  const addCustomSection = useCallback(
    async (name: string): Promise<ObligationSection> => {
      try {
        pushBreadcrumb(`Создание раздела: ${name}`)
        const section: ObligationSection = {
          id: crypto.randomUUID(),
          name,
          order: customSections.length,
          createdAt: new Date().toISOString()
        }
        const updated = [...customSections, section]
        setCustomSections(updated)
        await window.api.store.saveCustomSections(updated)
        return section
      } catch (e) {
        captureError(e, 'ipc_error', 'addCustomSection')
        throw e
      }
    },
    [customSections]
  )

  const deleteCustomSection = useCallback(
    async (id: string) => {
      try {
        pushBreadcrumb('Удаление раздела')
        const updated = customSections.filter(s => s.id !== id)
        setCustomSections(updated)
        await window.api.store.saveCustomSections(updated)
        const affectedObligations = obligations.filter(o => o.sectionId === id)
        for (const o of affectedObligations) {
          await window.api.store.updateObligation(o.id, { sectionId: undefined, frequency: 'monthly' })
        }
        if (affectedObligations.length > 0) {
          setObligations(current =>
            current.map(o => o.sectionId === id ? { ...o, sectionId: undefined, frequency: 'monthly' as const } : o)
          )
        }
      } catch (e) {
        captureError(e, 'ipc_error', 'deleteCustomSection')
        throw e
      }
    },
    [customSections, obligations]
  )

  const renameCustomSection = useCallback(
    async (id: string, name: string) => {
      try {
        pushBreadcrumb(`Переименование раздела: ${name}`)
        const updated = customSections.map(s => s.id === id ? { ...s, name } : s)
        setCustomSections(updated)
        await window.api.store.saveCustomSections(updated)
      } catch (e) {
        captureError(e, 'ipc_error', 'renameCustomSection')
        throw e
      }
    },
    [customSections]
  )

  return {
    transactions,
    obligations,
    obligationMonths,
    importHistory,
    debtResolutions,
    ollamaSettings,
    accountBalances,
    financialSnapshot,
    financialBrainCache,
    undoHistory,
    redoStack,
    errorRegistry,
    pinSettings,
    breadcrumbBuffer,
    customSections,
    changeLog,
    loading,
    addTransaction,
    addManyTransactions,
    deleteTransaction,
    updateTransactionComment,
    addObligation,
    updateObligation,
    deleteObligation,
    setObligationStatus,
    getObligationMonth,
    carryObligationDebt,
    setCarriedPaid,
    autoMatchObligations,
    clearAllTransactions,
    addImportRecord,
    deleteTransactionBatch,
    addDebtResolution,
    deleteDebtResolution,
    updateOllamaSettings,
    refresh,
    addError,
    resolveError,
    clearResolvedErrors,
    getBreadcrumbs,
    pushUndo,
    undo,
    redo,
    updateAccountBalance,
    saveSnapshot,
    saveFinancialBrainCache,
    addCustomSection,
    deleteCustomSection,
    renameCustomSection,
  }
}
