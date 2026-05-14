import { Fragment, useMemo, useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts'
import {
  AlertCircle,
  CheckCircle,
  TrendingDown,
  Trash2,
  CreditCard,
  Banknote,
  XCircle,
  AlertTriangle,
  Landmark,
  Receipt,
  X,
  ChevronDown,
  ChevronUp,
  ArrowDownLeft,
  Search,
  Undo2,
  Redo2,
  Coins,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  MessageSquarePlus
} from 'lucide-react'
import type {
  Transaction,
  Period,
  PeriodRange,
  DebtResolution,
  DebtResolutionType,
  AccountBalance,
  FinancialSnapshot,
  HistoryEntry,
  ImportRecord,
} from '../types'
import { PeriodSelector } from './PeriodSelector'
import { formatLocalDate } from '../utils/financialEngine'
import { Button } from './ui/button'
import { SourceLogo } from './SourceLogo'
import { ManualTransactionModal } from './ManualTransactionModal'

interface DashboardProps {
  transactions: Transaction[]
  debtResolutions: DebtResolution[]
  period: Period
  customRange: PeriodRange
  onPeriodChange: (p: Period) => void
  onCustomRangeChange: (r: PeriodRange) => void
  onDelete: (id: string) => void
  onClearAll: () => Promise<void>
  onAddDebtResolution: (
    failedDebitId: string,
    type: DebtResolutionType,
    monthlyAmount?: number,
    note?: string
  ) => Promise<void>
  onDeleteDebtResolution: (id: string) => Promise<void>
  accountBalances: AccountBalance[]
  financialSnapshot: FinancialSnapshot | null
  onUpdateBalance: (id: string, balance: number) => Promise<void>
  undoHistory?: HistoryEntry[]
  redoStack?: HistoryEntry[]
  onUndo?: () => void
  onRedo?: () => void
  importHistory?: ImportRecord[]
  onNavigateToImport?: () => void
  onAddTransaction?: (t: Omit<Transaction, 'id' | 'createdAt'>) => Promise<void>
  onUpdateComment?: (id: string, comment: string) => Promise<void>
}

// --- Debt matching helpers ---
const BANKING_NOISE = new Set([
  'lastschrift',
  'ueberweisung',
  'überweisung',
  'gutschrift',
  'ref',
  'kref',
  'mref',
  'eref',
  'svwz',
  'iban',
  'bic',
  'cred',
  'datum',
  'die',
  'der',
  'das',
  'und',
  'von',
  'für',
  'mit',
  'des',
  'den',
  'dem',
  'end',
  'eur'
])

function getSignificantWords(desc: string): string[] {
  return desc
    .toLowerCase()
    .split(/[\s/\-+.,;:()]+/)
    .filter((w) => w.length >= 3 && !BANKING_NOISE.has(w))
}

function hasDescriptionOverlap(desc1: string, desc2: string): boolean {
  const words1 = getSignificantWords(desc1)
  const words2 = getSignificantWords(desc2)
  return words1.some((w1) => words2.some((w2) => w1 === w2))
}

function findMatchingPayment(fd: Transaction, allTx: Transaction[]): Transaction | null {
  if (!fd.description) return null
  const fdDate = new Date(fd.date).getTime()
  // Look at payments AND income, but exclude Wiedergutschrift (refunds within the same Rücklastschrift chain)
  const candidates = allTx.filter(
    (t) =>
      (t.type === 'payment' || t.type === 'income') &&
      t.sparkasseType !== 'wiedergutschrift' &&
      !(t.description && t.description.toLowerCase().includes('wiedergutschrift'))
  )
  for (const p of candidates) {
    if (new Date(p.date).getTime() < fdDate) continue
    if (!p.description) continue
    if (!hasDescriptionOverlap(fd.description, p.description)) continue
    // Exact amount match (within €0.50)
    if (Math.abs(p.amount - fd.amount) <= 0.5) return p
    // Payment covers the debt (e.g. PayPal Visa Direct 15€ for 11.99€ debt + fees)
    if (p.amount >= fd.amount * 0.8 && p.amount <= fd.amount * 1.5) return p
  }
  return null
}

/**
 * Find a single bulk payment that covers multiple failed debits
 * (e.g. 3 PayPal debts of 23.99+6.00+16.99=46.98 paid as one 55.98 income containing "PayPal")
 */
function findBulkPayment(debts: Transaction[], allTx: Transaction[]): Transaction | null {
  if (debts.length < 2) return null
  const totalAmount = debts.reduce((s, d) => s + d.amount, 0)
  const earliestDate = debts.reduce((min, d) => (d.date < min ? d.date : min), debts[0].date)
  const candidates = allTx.filter(
    (t) => (t.type === 'payment' || t.type === 'income') && t.date >= earliestDate && t.description
  )
  // Check if the first debt has a description to match against
  const refDesc = debts[0].description
  if (!refDesc) return null

  for (const p of candidates) {
    // Amount should cover the total (within 20% tolerance for fees/rounding)
    if (p.amount < totalAmount * 0.8 || p.amount > totalAmount * 1.5) continue
    if (!p.description) continue
    if (hasDescriptionOverlap(refDesc, p.description)) return p
  }
  return null
}

// --- Refund / return detection ---
const REFUND_KEYWORDS = [
  'rückerstattung',
  'refund',
  'erstattung',
  'storno',
  'rückvergütung',
  'korrektur'
]

function isReturnOrRefund(t: Transaction): boolean {
  if (t.sparkasseType === 'wiedergutschrift') return true
  if (!t.description) return false
  const desc = t.description.toLowerCase()
  return REFUND_KEYWORDS.some((k) => desc.includes(k))
}

// --- Sparkasse fail group (Rücklastschrift + Wiedergutschrift + Entgelt) ---
interface SparkasseFailGroup {
  failedDebit: Transaction
  wiedergutschrift?: Transaction
  entgelt?: Transaction
}

function buildSparkasseGroups(txList: Transaction[]): {
  groups: Map<string, SparkasseFailGroup>
  groupedIds: Set<string>
} {
  const groups = new Map<string, SparkasseFailGroup>()
  const groupedIds = new Set<string>()
  const windowMs = 21 * 24 * 60 * 60 * 1000

  const wiederItems = txList
    .filter((t) => t.source === 'Sparkasse' && t.sparkasseType === 'wiedergutschrift')
    .sort((a, b) => a.date.localeCompare(b.date))

  const entgeltItems = txList
    .filter((t) => t.source === 'Sparkasse' && t.sparkasseType === 'entgelt')
    .sort((a, b) => a.date.localeCompare(b.date))

  // Anchor candidates: explicit failed_debit + Sparkasse payments that have a matching Wiedergutschrift
  const explicitFailed = txList.filter((t) => t.type === 'failed_debit' && t.source === 'Sparkasse')
  const inferredFailed = txList.filter((t) => {
    if (t.type !== 'payment') return false
    if (t.source !== 'Sparkasse') return false
    if (t.sparkasseType === 'wiedergutschrift' || t.sparkasseType === 'entgelt') return false
    const tTime = new Date(t.date).getTime()
    return wiederItems.some((w) => {
      const wTime = new Date(w.date).getTime()
      const dt = wTime - tTime
      return Math.abs(w.amount - t.amount) < 0.01 && dt >= 0 && dt <= windowMs
    })
  })

  const anchors = [...explicitFailed, ...inferredFailed].sort((a, b) =>
    a.date.localeCompare(b.date)
  )

  const usedWieder = new Set<string>()
  const usedEntgelt = new Set<string>()

  for (const fd of anchors) {
    const fdTime = new Date(fd.date).getTime()

    // Match Wiedergutschrift by amount equality + later date within window
    const wieder = wiederItems.find((t) => {
      if (usedWieder.has(t.id)) return false
      if (Math.abs(t.amount - fd.amount) > 0.01) return false
      const tTime = new Date(t.date).getTime()
      return tTime >= fdTime && tTime - fdTime <= windowMs
    })

    // Match Entgelt: amount of fd appears in description "über X,XX EUR" OR date proximity (±2 days from wieder)
    const entgelt = entgeltItems.find((t) => {
      if (usedEntgelt.has(t.id)) return false
      const desc = t.description?.toLowerCase() ?? ''
      const amountStr = fd.amount.toFixed(2).replace('.', ',')
      const amountStrDot = fd.amount.toFixed(2)
      const amountInDesc = desc.includes(amountStr) || desc.includes(amountStrDot)
      const tTime = new Date(t.date).getTime()
      const refTime = wieder ? new Date(wieder.date).getTime() : fdTime
      const closeInTime = Math.abs(tTime - refTime) <= 3 * 24 * 60 * 60 * 1000
      return amountInDesc || closeInTime
    })

    const group: SparkasseFailGroup = { failedDebit: fd }
    if (wieder) {
      group.wiedergutschrift = wieder
      usedWieder.add(wieder.id)
      groupedIds.add(wieder.id)
    }
    if (entgelt) {
      group.entgelt = entgelt
      usedEntgelt.add(entgelt.id)
      groupedIds.add(entgelt.id)
    }
    groups.set(fd.id, group)
    groupedIds.add(fd.id)
  }

  return { groups, groupedIds }
}

// --- Card payment detection ---
const CARD_KEYWORDS = [
  'KARTENZAHLUNG',
  'DIG. KARTE',
  'GIRO E-COM',
  'APPLE PAY',
  'VISA',
  'MASTERCARD'
]

function isCardPayment(t: Transaction): boolean {
  if (t.source === 'Revolut' || t.source === 'PayPal' || t.source === 'Klarna') return true
  if (!t.description) return false
  const upper = t.description.toUpperCase()
  return CARD_KEYWORDS.some((kw) => upper.includes(kw))
}

function getPeriodRange(period: Period, customRange: PeriodRange): PeriodRange {
  const now = new Date()
  if (period === 'this_month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1)
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    return {
      from: formatLocalDate(from),
      to: formatLocalDate(to)
    }
  }
  if (period === 'last_month') {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const to = new Date(now.getFullYear(), now.getMonth(), 0)
    return {
      from: formatLocalDate(from),
      to: formatLocalDate(to)
    }
  }
  if (period === 'month_before_last') {
    const from = new Date(now.getFullYear(), now.getMonth() - 2, 1)
    const to = new Date(now.getFullYear(), now.getMonth() - 1, 0)
    return {
      from: formatLocalDate(from),
      to: formatLocalDate(to)
    }
  }
  return customRange
}

const typeIcons: Record<Transaction['type'], React.ReactNode> = {
  payment: <CreditCard className="h-4 w-4 text-red-400" />,
  income: <Banknote className="h-4 w-4 text-green-400" />,
  failed_debit: <XCircle className="h-4 w-4 text-red-400" />,
  penalty: <AlertTriangle className="h-4 w-4 text-orange-400" />
}

const typeLabels: Record<Transaction['type'], string> = {
  payment: 'Оплата',
  income: 'Доход',
  failed_debit: 'Неудачный платёж',
  penalty: 'Штраф'
}

function getTypeLabel(t: Transaction): string {
  return typeLabels[t.type]
}

export function Dashboard({
  transactions,
  debtResolutions,
  period,
  customRange,
  onPeriodChange,
  onCustomRangeChange,
  onDelete,
  onClearAll,
  onAddDebtResolution,
  onDeleteDebtResolution,
  accountBalances,
  financialSnapshot,
  onUpdateBalance,
  undoHistory,
  redoStack,
  onUndo,
  onRedo,
  importHistory,
  onNavigateToImport,
  onAddTransaction,
  onUpdateComment,
}: DashboardProps): React.JSX.Element {
  const range = getPeriodRange(period, customRange)
  const [expandDebts, setExpandDebts] = useState(false)
  const [resolvingDebtId, setResolvingDebtId] = useState<string | null>(null)
  const [showRestructure, setShowRestructure] = useState(false)
  const [restructureInput, setRestructureInput] = useState('')
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [halfYearOffset, setHalfYearOffset] = useState<number>(0)
  const [showWarnings, setShowWarnings] = useState(true)
  const [editingBalanceId, setEditingBalanceId] = useState<string | null>(null)
  const [balanceInput, setBalanceInput] = useState('')
  const [showCashModal, setShowCashModal] = useState(false)
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null)
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState('')

  // Available sources from all transactions
  const availableSources = useMemo(() => {
    const sources = new Set(transactions.map((t) => t.source))
    sources.add('PayPal')
    sources.delete('Other')
    return Array.from(sources).sort()
  }, [transactions])

  // Source-filtered transactions (all time)
  const sourceTx = useMemo(
    () =>
      sourceFilter === 'all' ? transactions : transactions.filter((t) => t.source === sourceFilter),
    [transactions, sourceFilter]
  )

  const filtered = useMemo(
    () => sourceTx.filter((t) => t.date >= range.from && t.date <= range.to),
    [sourceTx, range.from, range.to]
  )

  // All transactions across all time — for matching debts from this period
  const allTx = useMemo(() => sourceTx, [sourceTx])

  // --- Sparkasse fail groups (visible in transaction table) ---
  const { groups: sparkasseGroups, groupedIds: sparkasseGroupedIds } = useMemo(
    () => buildSparkasseGroups(filtered),
    [filtered]
  )

  // --- Card 1: К оплате (unresolved failed debits) ---
  const failedDebitsInPeriod = useMemo(
    () => filtered.filter((t) => t.type === 'failed_debit'),
    [filtered]
  )

  const unresolvedDebts = useMemo(() => {
    // First pass: remove individually resolved and individually matched
    const afterIndividual = failedDebitsInPeriod.filter((fd) => {
      if (debtResolutions.some((r) => r.failedDebitId === fd.id)) return false
      if (findMatchingPayment(fd, allTx)) return false
      return true
    })

    // Second pass: group remaining debts by description keyword, check for bulk payments
    const byKeyword = new Map<string, Transaction[]>()
    for (const fd of afterIndividual) {
      const words = fd.description ? getSignificantWords(fd.description) : []
      const key = words[0] ?? fd.id
      const list = byKeyword.get(key) ?? []
      list.push(fd)
      byKeyword.set(key, list)
    }

    const bulkResolved = new Set<string>()
    for (const [, group] of byKeyword) {
      if (group.length >= 2 && findBulkPayment(group, allTx)) {
        for (const fd of group) bulkResolved.add(fd.id)
      }
    }

    return afterIndividual.filter((fd) => !bulkResolved.has(fd.id))
  }, [failedDebitsInPeriod, debtResolutions, allTx])

  const totalDebt = useMemo(
    () => unresolvedDebts.reduce((s, t) => s + t.amount, 0),
    [unresolvedDebts]
  )

  // --- Card 2: Оплачено (successful payments, split by type) ---
  const periodPayments = useMemo(() => filtered.filter((t) => t.type === 'payment'), [filtered])

  const lastschriftTotal = useMemo(
    () => periodPayments.filter((t) => !isCardPayment(t)).reduce((s, t) => s + t.amount, 0),
    [periodPayments]
  )

  const cardTotal = useMemo(
    () => periodPayments.filter((t) => isCardPayment(t)).reduce((s, t) => s + t.amount, 0),
    [periodPayments]
  )

  const totalPaid = lastschriftTotal + cardTotal

  // --- Card 3: Поступления (clean income, no returns/refunds) ---
  const cleanIncome = useMemo(
    () =>
      filtered
        .filter((t) => t.type === 'income' && !isReturnOrRefund(t))
        .reduce((s, t) => s + t.amount, 0),
    [filtered]
  )

  // --- Card 4: Штрафы ---
  const bankFees = useMemo(
    () =>
      filtered
        .filter((t) => t.type === 'penalty' && (t.penaltySource === 'bank' || !t.penaltySource))
        .reduce((s, t) => s + t.amount, 0),
    [filtered]
  )

  const serviceFees = useMemo(
    () =>
      filtered
        .filter((t) => t.type === 'penalty' && t.penaltySource === 'service')
        .reduce((s, t) => s + t.amount, 0),
    [filtered]
  )

  const strafen = bankFees + serviceFees

  // Chart data: current half-year (Jan-Jun or Jul-Dec)
  const chartHalf = useMemo(() => {
    const now = new Date()
    const currentHalfIdx = now.getFullYear() * 2 + (now.getMonth() < 6 ? 0 : 1)
    const targetHalfIdx = currentHalfIdx + halfYearOffset
    const year = Math.floor(targetHalfIdx / 2)
    const halfStart = (targetHalfIdx % 2) * 6 // 0 или 6
    return { year, halfStart }
  }, [halfYearOffset])

  const chartData = useMemo(() => {
    const { year, halfStart } = chartHalf
    const months: {
      name: string
      Sparkasse: number
      Revolut: number
      PayPal: number
      Пятак: number
      Штрафы: number
    }[] = []
    for (let i = 0; i < 6; i++) {
      const d = new Date(year, halfStart + i, 1)
      const monthStr = formatLocalDate(d).slice(0, 7)
      const label = d.toLocaleDateString('ru-RU', { month: 'short' })
      const monthTx = sourceTx.filter((t) => t.date.startsWith(monthStr))
      const incomeTx = monthTx.filter((t) => t.type === 'income')
      months.push({
        name: label,
        Sparkasse: incomeTx
          .filter((t) => t.source === 'Sparkasse')
          .reduce((s, t) => s + t.amount, 0),
        Revolut: incomeTx.filter((t) => t.source === 'Revolut').reduce((s, t) => s + t.amount, 0),
        PayPal: incomeTx
          .filter((t) => t.source === 'PayPal')
          .reduce((s, t) => s + t.amount, 0),
        Пятак: incomeTx
          .filter((t) => t.source === 'Пятак')
          .reduce((s, t) => s + t.amount, 0),
        Штрафы: monthTx.filter((t) => t.type === 'penalty').reduce((s, t) => s + t.amount, 0)
      })
    }
    return months
  }, [sourceTx, chartHalf])

  const datenstand = useMemo(() => {
    if (sourceTx.length === 0) return null
    const latest = sourceTx.reduce(
      (max, t) => (t.createdAt > max ? t.createdAt : max),
      sourceTx[0].createdAt
    )
    const d = new Date(latest)
    return (
      d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
      ' ' +
      d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    )
  }, [sourceTx])

  // --- Search state ---
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const searchSuggestions = useMemo(() => {
    if (searchQuery.trim().length < 2) return []
    const query = searchQuery.toLowerCase()
    const seen = new Set<string>()
    const suggestions: string[] = []
    for (const t of transactions) {
      const words = [
        t.description || '',
        t.source,
        typeLabels[t.type]
      ]
      for (const w of words) {
        if (!w) continue
        const lower = w.toLowerCase()
        if (lower.includes(query) && !seen.has(lower)) {
          seen.add(lower)
          suggestions.push(w)
        }
      }
      if (suggestions.length >= 8) break
    }
    return suggestions
  }, [searchQuery, transactions])

  const handleBalanceEdit = (acc: AccountBalance) => {
    setEditingBalanceId(acc.id)
    setBalanceInput(acc.balance.toString())
  }

  const handleBalanceSave = async (id: string) => {
    const val = parseFloat(balanceInput)
    if (!isNaN(val)) {
      await onUpdateBalance(id, val)
    }
    setEditingBalanceId(null)
    setBalanceInput('')
  }

  const fmt = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })

  const searchResults = useMemo(() => {
    if (searchQuery.trim().length < 2) return []
    const query = searchQuery.toLowerCase()
    return transactions.filter((t) => {
      const text = [
        t.description || '',
        t.source,
        typeLabels[t.type],
        t.date
      ]
        .join(' ')
        .toLowerCase()
      return text.includes(query)
    }).slice(0, 20)
  }, [searchQuery, transactions])

  const handleSuggestionClick = useCallback((suggestion: string) => {
    setSearchQuery(suggestion)
    setSearchFocused(false)
  }, [])

  return (
    <div className="space-y-6">
      {/* BLOCK 1: Warnings banner */}
      {financialSnapshot && financialSnapshot.warnings.length > 0 && showWarnings && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-xl border px-4 py-3 ${
            financialSnapshot.warnings.some((w) => w.severity === 'error')
              ? 'border-red-900/50 bg-red-950/30'
              : 'border-yellow-900/50 bg-yellow-950/30'
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              {financialSnapshot.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  {w.severity === 'error' ? (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
                  ) : w.severity === 'warn' ? (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-400 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0 text-blue-400 mt-0.5" />
                  )}
                  <span className={w.severity === 'error' ? 'text-red-300' : 'text-yellow-300'}>
                    {w.code}: {w.message}
                  </span>
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowWarnings(false)}
              className="text-neutral-400 hover:text-neutral-200 shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      )}

      {/* BLOCK 2: Account cards */}
      <div className="grid grid-cols-3 gap-4">
        {accountBalances.map((acc) => (
          <motion.div
            key={acc.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 transition-all hover:border-neutral-700"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Landmark className="h-4 w-4 text-neutral-500" />
                <span className="text-xs text-neutral-400 capitalize">{acc.source}</span>
              </div>
              {acc.confidence === 'stale' && (
                <span className="text-xs text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  устарело
                </span>
              )}
              {acc.confidence === 'missing' && (
                <span className="text-xs text-neutral-500">не введён</span>
              )}
            </div>
            {editingBalanceId === acc.id ? (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={balanceInput}
                  onChange={(e) => setBalanceInput(e.target.value)}
                  onBlur={() => handleBalanceSave(acc.id)}
                  onKeyDown={(e) => e.key === 'Enter' && handleBalanceSave(acc.id)}
                  className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-200"
                  autoFocus
                />
                <button
                  onClick={() => handleBalanceSave(acc.id)}
                  className="text-green-400 hover:text-green-300"
                >
                  <CheckCircle className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div
                onClick={() => handleBalanceEdit(acc)}
                className="cursor-pointer"
              >
                <p className="text-xl font-bold text-neutral-200">
                  {acc.confidence === 'missing' ? (
                    <span className="text-neutral-500">—</span>
                  ) : (
                    fmt(acc.balance)
                  )}
                </p>
                <p className="text-xs text-neutral-500 mt-1">
                  по данным {new Date(acc.balanceDate).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                </p>
              </div>
            )}
          </motion.div>
        ))}
      </div>

      {/* BLOCK 3: Free this month hero card */}
      {financialSnapshot && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-xl border p-6 ${
            financialSnapshot.riskLevel === 'unknown'
              ? 'border-neutral-800 bg-neutral-900/50'
              : financialSnapshot.freeThisMonth < 0
                ? 'border-red-800/50 bg-red-950/30'
                : financialSnapshot.freeThisMonth < financialSnapshot.totalLiquid * 0.15
                  ? 'border-amber-800/50 bg-amber-950/30'
                  : 'border-green-800/50 bg-green-950/30'
          }`}
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-sm text-neutral-400">
                {financialSnapshot.freeThisMonth < 0 ? 'Дефицит' : 'Свободно в этом месяце'}
              </p>
              {financialSnapshot.riskLevel === 'unknown' ? (
                <p className="text-3xl font-bold text-neutral-500 mt-2">
                  Введи балансы счетов для расчёта
                </p>
              ) : (
                <p className={`text-4xl font-bold mt-2 ${
                  financialSnapshot.freeThisMonth < 0
                    ? 'text-red-400'
                    : financialSnapshot.freeThisMonth < financialSnapshot.totalLiquid * 0.15
                      ? 'text-amber-400'
                      : 'text-green-400'
                }`}>
                  {fmt(Math.abs(financialSnapshot.freeThisMonth))}
                </p>
              )}
            </div>
            {financialSnapshot.riskLevel !== 'unknown' && (
              <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                financialSnapshot.riskLevel === 'critical'
                  ? 'bg-red-900/50 text-red-300'
                  : financialSnapshot.riskLevel === 'tight'
                    ? 'bg-amber-900/50 text-amber-300'
                    : 'bg-green-900/50 text-green-300'
              }`}>
                {financialSnapshot.riskLevel === 'critical' ? 'Критично' : financialSnapshot.riskLevel === 'tight' ? 'Внимание' : 'Норма'}
              </div>
            )}
          </div>
          {financialSnapshot.riskLevel !== 'unknown' && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-neutral-400">Sparkasse</span>
                <span className="text-neutral-200">
                  {fmt(accountBalances.find((a) => a.source === 'sparkasse')?.balance ?? 0)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">Revolut</span>
                <span className="text-neutral-200">
                  {fmt(accountBalances.find((a) => a.source === 'revolut')?.balance ?? 0)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">PayPal</span>
                <span className="text-neutral-200">
                  {fmt(accountBalances.find((a) => a.source === 'paypal')?.balance ?? 0)}
                </span>
              </div>
              <div className="border-t border-neutral-700 pt-2 flex justify-between font-medium">
                <span className="text-neutral-300">Итого</span>
                <span className="text-neutral-200">{fmt(financialSnapshot.totalLiquid)}</span>
              </div>
              <div className="flex justify-between text-red-400">
                <span>− Обязательства</span>
                <span>{fmt(financialSnapshot.monthlyObligations)} (из {financialSnapshot.monthlyObligationsCount})</span>
              </div>
              <div className="flex justify-between text-red-400">
                <span>− Klarna</span>
                <span>{fmt(financialSnapshot.monthlyKlarna)} (из {financialSnapshot.monthlyKlarnaCount})</span>
              </div>
            </div>
          )}
          <p className="text-xs text-neutral-500 mt-4">
            рассчитано {new Date(financialSnapshot.generatedAt).toLocaleString('ru-RU', {
              hour: '2-digit',
              minute: '2-digit',
              day: '2-digit',
              month: '2-digit',
            })}
          </p>
        </motion.div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <PeriodSelector
          period={period}
          customRange={customRange}
          onPeriodChange={onPeriodChange}
          onCustomRangeChange={onCustomRangeChange}
        />
        <div className="flex items-center gap-2">
          <button
            onClick={onUndo}
            disabled={!undoHistory || undoHistory.length === 0}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-neutral-800 text-neutral-400 hover:text-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Отменить"
          >
            <Undo2 className="h-4 w-4" />
            Отменить
          </button>
          <button
            onClick={onRedo}
            disabled={!redoStack || redoStack.length === 0}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-neutral-800 text-neutral-400 hover:text-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Повторить"
          >
            <Redo2 className="h-4 w-4" />
            Повторить
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Card 1: К оплате */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="rounded-xl border border-red-800/50 bg-red-950/50 p-5 transition-all duration-300 hover:border-red-700/70 hover:shadow-lg hover:shadow-red-950/20"
        >
          <div
            className="flex cursor-pointer items-center justify-between transition-opacity duration-200 hover:opacity-80"
            onClick={() => setExpandDebts(!expandDebts)}
          >
            <div>
              <p className="text-sm text-neutral-400">К оплате</p>
              <p className="mt-1 text-2xl font-bold text-red-400">
                {totalDebt.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {unresolvedDebts.length > 0 && (
                <span className="rounded-full bg-red-900/50 px-2 py-0.5 text-xs text-red-300">
                  {unresolvedDebts.length}
                </span>
              )}
              {unresolvedDebts.length > 0 ? (
                expandDebts ? (
                  <ChevronUp className="h-5 w-5 text-red-500" />
                ) : (
                  <ChevronDown className="h-5 w-5 text-red-500" />
                )
              ) : (
                <AlertCircle className="h-8 w-8 text-red-500" />
              )}
            </div>
          </div>

          <AnimatePresence>
            {expandDebts && unresolvedDebts.length > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-3 space-y-2 border-t border-red-800/30 pt-3">
                  {unresolvedDebts.map((debt) => (
                    <div key={debt.id}>
                      {resolvingDebtId === debt.id && !showRestructure ? (
                        <div className="flex flex-wrap gap-2 rounded-lg bg-red-900/20 p-2">
                          <button
                            onClick={() => {
                              onAddDebtResolution(debt.id, 'manual')
                              setResolvingDebtId(null)
                            }}
                            className="rounded bg-green-900/50 px-2.5 py-1 text-xs text-green-300 transition-all duration-200 hover:bg-green-900 hover:-translate-y-px active:translate-y-px"
                          >
                            Оплачено другим способом
                          </button>
                          <button
                            onClick={() => setShowRestructure(true)}
                            className="rounded bg-blue-900/50 px-2.5 py-1 text-xs text-blue-300 transition-all duration-200 hover:bg-blue-900 hover:-translate-y-px active:translate-y-px"
                          >
                            Реструктурировано
                          </button>
                          <button
                            onClick={() => setResolvingDebtId(null)}
                            className="rounded px-2 py-1 text-xs text-neutral-400 transition-all duration-200 hover:text-neutral-200 hover:-translate-y-px active:translate-y-px"
                          >
                            Отмена
                          </button>
                        </div>
                      ) : resolvingDebtId === debt.id && showRestructure ? (
                        <div className="space-y-2 rounded-lg bg-blue-900/20 p-2">
                          <p className="text-xs text-neutral-400">Сумма оплаты в месяц:</p>
                          <div className="flex gap-2">
                            <input
                              type="number"
                              step="0.01"
                              value={restructureInput}
                              onChange={(e) => setRestructureInput(e.target.value)}
                              className="w-24 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-200"
                              placeholder="€"
                              autoFocus
                            />
                            <button
                              onClick={() => {
                                const amount = parseFloat(restructureInput)
                                if (!isNaN(amount) && amount > 0) {
                                  onAddDebtResolution(debt.id, 'restructured', amount)
                                  setResolvingDebtId(null)
                                  setShowRestructure(false)
                                  setRestructureInput('')
                                }
                              }}
                              className="rounded bg-blue-900/50 px-2.5 py-1 text-xs text-blue-300 transition-all duration-200 hover:bg-blue-900 hover:-translate-y-px active:translate-y-px"
                            >
                              ОК
                            </button>
                            <button
                              onClick={() => {
                                setResolvingDebtId(null)
                                setShowRestructure(false)
                                setRestructureInput('')
                              }}
                              className="rounded px-2 py-1 text-xs text-neutral-400 transition-all duration-200 hover:text-neutral-200 hover:-translate-y-px active:translate-y-px"
                            >
                              Отмена
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between text-sm">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-neutral-300">
                              {debt.description || debt.source}
                            </p>
                            <p className="text-xs text-neutral-500">{debt.date}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-red-400">
                              {debt.amount.toLocaleString('de-DE', {
                                style: 'currency',
                                currency: 'EUR'
                              })}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setResolvingDebtId(debt.id)
                                setShowRestructure(false)
                              }}
                              className="rounded p-0.5 text-neutral-500 transition-all duration-200 hover:bg-red-900/30 hover:text-red-400"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Card 2: Оплачено */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className="rounded-xl border border-green-800/50 bg-green-950/50 p-5 transition-all duration-300 hover:border-green-700/70 hover:shadow-lg hover:shadow-green-950/20"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-neutral-400">Оплачено</p>
              <p className="mt-1 text-2xl font-bold text-green-400">
                {totalPaid.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
              </p>
            </div>
            <CheckCircle className="h-8 w-8 text-green-500" />
          </div>
          <div className="mt-3 space-y-2 border-t border-green-800/30 pt-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs text-neutral-400">
                <Landmark className="h-3.5 w-3.5 text-green-400/70" />
                Lastschrift / Überweisung
              </span>
              <span className="text-sm font-medium text-green-400">
                {lastschriftTotal.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs text-neutral-400">
                <CreditCard className="h-3.5 w-3.5 text-green-400/70" />
                Karte / Online
              </span>
              <span className="text-sm font-medium text-green-400">
                {cardTotal.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
              </span>
            </div>
          </div>
        </motion.div>

        {/* Card 3: Поступления */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="rounded-xl border border-blue-800/50 bg-blue-950/50 p-5 transition-all duration-300 hover:border-blue-700/70 hover:shadow-lg hover:shadow-blue-950/20"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-neutral-400">Поступления</p>
              <p className="mt-1 text-2xl font-bold text-blue-400">
                {cleanIncome.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
              </p>
            </div>
            <ArrowDownLeft className="h-8 w-8 text-blue-500" />
          </div>
        </motion.div>

        {/* Card 4: Штрафы за Lastschrift-Rückgabe */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="rounded-xl border border-orange-800/50 bg-orange-950/50 p-5 transition-all duration-300 hover:border-orange-700/70 hover:shadow-lg hover:shadow-orange-950/20"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm text-neutral-400">Штрафы за Lastschrift-Rückgabe</p>
            <TrendingDown className="h-8 w-8 text-orange-500" />
          </div>
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs text-neutral-400">
                <Landmark className="h-3.5 w-3.5 text-orange-400/70" />
                Bankgebühren
              </span>
              <span className="text-sm font-medium text-orange-400">
                {bankFees.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs text-neutral-400">
                <Receipt className="h-3.5 w-3.5 text-yellow-400/70" />
                Dienstleister-Strafen
              </span>
              <span className="text-sm font-medium text-yellow-400">
                {serviceFees.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
              </span>
            </div>
            <div className="border-t border-orange-800/30 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-neutral-400">Итого</span>
                <span className="text-sm font-bold text-orange-400">
                  {strafen.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setHalfYearOffset((v) => v - 1)}
              className="rounded-md p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300 transition-colors"
              aria-label="Предыдущее полугодие"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <h3 className="text-xs font-medium text-neutral-500 min-w-[170px] text-center">
              Статистика {chartHalf.halfStart === 0 ? 'Январь — Июнь' : 'Июль — Декабрь'} {chartHalf.year}
            </h3>
            <button
              type="button"
              onClick={() => setHalfYearOffset((v) => v + 1)}
              disabled={halfYearOffset >= 0}
              className="rounded-md p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
              aria-label="Следующее полугодие"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900/80 p-0.5 pr-2">
              <button
                onClick={() => setSourceFilter('all')}
                className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition-all duration-200 hover:-translate-y-px active:translate-y-px ${
                  sourceFilter === 'all'
                    ? 'bg-neutral-700 text-white'
                    : 'text-neutral-500 hover:text-neutral-300'
                }`}
                style={{ marginLeft: '2px' }}
              >
                Все
              </button>
              {availableSources.map((src, idx) => (
                <button
                  key={src}
                  onClick={() => setSourceFilter(src)}
                  className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[10px] font-medium transition-all duration-200 hover:-translate-y-px active:translate-y-px ${
                    sourceFilter === src
                      ? 'bg-neutral-700 text-white'
                      : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                  style={idx === availableSources.length - 1 ? { marginRight: '2px' } : {}}
                >
                  <SourceLogo source={src} size="sm" />
                  {src}
                </button>
              ))}
            </div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={chartData} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
            <XAxis dataKey="name" stroke="#525252" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis stroke="#525252" fontSize={10} tickLine={false} axisLine={false} width={40} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#171717',
                border: '1px solid #262626',
                borderRadius: 8,
                fontSize: 11
              }}
              labelStyle={{ color: '#a3a3a3', fontSize: 11 }}
            />
            <Legend iconSize={8} wrapperStyle={{ fontSize: 10, paddingTop: 4 }} />
            <Bar dataKey="Sparkasse" stackId="income" fill="#dc2626" radius={[0, 0, 0, 0]} />
            <Bar dataKey="Revolut" stackId="income" fill="#2563eb" radius={[0, 0, 0, 0]} />
            <Bar dataKey="PayPal" stackId="income" fill="#6366f1" radius={[0, 0, 0, 0]} />
            <Bar dataKey="Пятак" stackId="income" fill="#eab308" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Штрафы" fill="#d97706" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>

      </div>

      {/* Одиночные операции — строка поиска */}
      <div className="relative">
        <div className="flex items-center gap-2 rounded-lg border border-neutral-800/60 bg-neutral-900/30 px-3 py-1.5">
          <Search className="h-3 w-3 shrink-0 text-neutral-600" />
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setSelectedTxId(null) }}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
            placeholder="Поиск..."
            className="w-full bg-transparent text-xs text-neutral-400 placeholder:text-neutral-700 focus:outline-none"
          />
          {searchQuery && (
            <button onClick={() => { setSearchQuery(''); setSelectedTxId(null) }} className="text-neutral-600 hover:text-neutral-400">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        {searchFocused && searchSuggestions.length > 0 && searchResults.length === 0 && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-neutral-700 bg-neutral-900 py-1 shadow-xl">
            {searchSuggestions.map((s) => (
              <button
                key={s}
                onMouseDown={() => handleSuggestionClick(s)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-800"
              >
                <Search className="h-3 w-3 text-neutral-600" />
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {searchResults.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950/50 p-2">
              <p className="px-1 text-[10px] text-neutral-600">{searchResults.length} результатов</p>
              {searchResults.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTxId(selectedTxId === t.id ? null : t.id)}
                  className={`flex w-full items-start gap-3 rounded-lg p-2 text-left text-xs transition-colors ${
                    selectedTxId === t.id ? 'bg-neutral-800 border border-neutral-700' : 'hover:bg-neutral-800/50'
                  }`}
                >
                  <span className="shrink-0 pt-0.5">{typeIcons[t.type]}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-neutral-200">
                        {t.description || t.source}
                      </span>
                      <span className={`shrink-0 font-medium ${t.type === 'income' ? 'text-green-400' : 'text-neutral-300'}`}>
                        {t.amount.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                      </span>
                    </div>
                    {selectedTxId === t.id && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]"
                      >
                        <span className="text-neutral-500">Дата</span>
                        <span className="text-neutral-300">{t.date}</span>
                        <span className="text-neutral-500">Источник</span>
                        <span className="flex items-center gap-1 text-neutral-300">
                          <SourceLogo source={t.source} size="sm" /> {t.source}
                        </span>
                        <span className="text-neutral-500">Тип</span>
                        <span className="text-neutral-300">{getTypeLabel(t)}</span>
                        {t.description && (
                          <>
                            <span className="text-neutral-500">Описание</span>
                            <span className="text-neutral-300">{t.description}</span>
                          </>
                        )}
                      </motion.div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {datenstand && (
        <p className="text-right text-[10px] text-neutral-600">
          Последнее обновление: {datenstand}
        </p>
      )}

      {/* All transactions table */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50">
        <div className="flex items-center justify-end border-b border-neutral-800/60 px-4 py-2">
          <h3 className="text-xs font-medium text-neutral-500">Все транзакции</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-neutral-400">
              <th className="px-4 py-3">Дата</th>
              <th className="px-4 py-3">Сумма</th>
              <th className="px-4 py-3">Источник</th>
              <th className="px-4 py-3">Тип</th>
              <th className="px-4 py-3">Описание</th>
              <th className="px-4 py-3 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const banks = [
                { bank: 'sparkasse' as const, source: 'Sparkasse' as const, label: 'Sparkasse' },
                { bank: 'revolut' as const, source: 'Revolut' as const, label: 'Revolut' },
                { bank: 'paypal' as const, source: 'PayPal' as const, label: 'PayPal' },
              ]
              const now = new Date()
              const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
              const stale = banks.filter(({ bank }) => {
                const records = (importHistory ?? []).filter((r) => r.bank === bank)
                if (records.length === 0) return true
                const last = records.reduce((a, b) => (a.date > b.date ? a : b))
                const lastDate = new Date(last.date)
                if (lastDate < currentMonthStart) return true
                const daysSince = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
                return daysSince >= 7
              })
              if (stale.length === 0) return null
              return (
                <tr>
                  <td colSpan={6} className="px-4 py-4 text-center">
                    <span className="text-sm text-neutral-500">Добавьте свежие данные</span>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      {stale.map(({ bank, source, label }) => (
                        <button
                          key={bank}
                          onClick={() => onNavigateToImport?.()}
                          className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-800/60 px-2.5 py-1.5 text-xs text-neutral-400 transition-colors hover:border-neutral-600 hover:text-neutral-200"
                        >
                          <SourceLogo source={source} />
                          {label}
                        </button>
                      ))}
                      {onAddTransaction && (
                        <button
                          onClick={() => setShowCashModal(true)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-amber-800/50 bg-amber-950/30 px-2.5 py-1.5 text-xs text-amber-400 transition-colors hover:border-amber-700/70 hover:text-amber-300"
                          title="Добавить доход наличными"
                        >
                          <Coins className="h-3.5 w-3.5" />
                          Пятак
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })()}
            {filtered
              .slice()
              .sort((a: Transaction, b: Transaction) => {
                const aDate = sparkasseGroups.get(a.id)?.wiedergutschrift?.date ?? a.date
                const bDate = sparkasseGroups.get(b.id)?.wiedergutschrift?.date ?? b.date
                return bDate.localeCompare(aDate)
              })
              .map((t: Transaction) => {
                // Пропускаем wiedergutschrift/entgelt — они рендерятся внутри кластера
                // Анкер группы (failed_debit или inferred payment) НЕ пропускаем — он есть ключ в Map
                if (sparkasseGroupedIds.has(t.id) && !sparkasseGroups.has(t.id)) return null

                const group = sparkasseGroups.get(t.id)

                const renderTxRow = (tx: Transaction, phase?: 1 | 2 | 3, groupId?: string) => {
                  const txRes = phase === 1 ? debtResolutions.find((r) => r.failedDebitId === tx.id) : undefined
                  const isHovered = groupId != null && hoveredGroupId === groupId
                  const subdued = (phase === 2 || phase === 3) && !isHovered
                  const anchorGroup = phase === 1 ? sparkasseGroups.get(tx.id) : undefined
                  const displayDate = anchorGroup?.wiedergutschrift?.date ?? tx.date
                  const amountColor =
                    phase === 2
                      ? isHovered ? 'text-green-400' : 'text-green-500/60'
                      : phase === 3
                        ? isHovered ? 'text-orange-400' : 'text-orange-500/60'
                        : 'text-neutral-200'
                  // BUG-fix: размер строк не меняется на hover — приглушаем только цветом
                  const dateColor = subdued ? 'text-neutral-500' : 'text-neutral-200'
                  const sourceColor = subdued ? 'text-neutral-500' : 'text-neutral-300'
                  const typeColor = subdued ? 'text-neutral-500' : 'text-neutral-300'
                  const descColor = subdued ? 'text-neutral-600' : 'text-neutral-400'
                  return (
                    <tr
                      key={tx.id}
                      onMouseEnter={groupId ? () => setHoveredGroupId(groupId) : undefined}
                      onMouseLeave={groupId ? () => setHoveredGroupId(null) : undefined}
                      className={
                        phase === 1
                          ? 'border-b border-neutral-800/50 bg-red-950/10 transition-colors duration-300 hover:bg-red-950/20'
                          : phase === 2
                            ? 'border-b border-neutral-800/20 bg-green-950/5 transition-colors duration-300 hover:bg-green-950/10'
                            : phase === 3
                              ? 'border-b border-neutral-800/20 bg-orange-950/5 transition-colors duration-300 hover:bg-orange-950/10'
                              : 'border-b border-neutral-800/50 transition-colors duration-300 hover:bg-neutral-800/30'
                      }
                    >
                      <td className={`${phase ? 'border-l-4 border-orange-500/70' : ''} px-4 py-2.5`}>
                        <span className="flex items-center gap-1">
                          {phase === 2 && <span className={`text-[10px] transition-colors duration-300 ${isHovered ? 'text-green-500' : 'text-green-700'}`}>↩</span>}
                          {phase === 3 && <span className={`text-[10px] transition-colors duration-300 ${isHovered ? 'text-orange-500' : 'text-orange-700'}`}>⚠</span>}
                          <span className={`transition-colors duration-300 ${dateColor}`}>{displayDate}</span>
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-medium">
                        <span className={`transition-colors duration-300 ${amountColor}`}>
                          {tx.amount.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`flex items-center gap-2 transition-colors duration-300 ${sourceColor}`}>
                          <SourceLogo source={tx.source} />
                          {tx.source}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-1.5">
                          {phase === 1 ? typeIcons.failed_debit : typeIcons[tx.type]}
                          <span className={`transition-colors duration-300 ${typeColor}`}>
                            {phase === 1
                              ? 'Неудачный платёж'
                              : phase === 2
                                ? 'Wiedergutschrift'
                                : phase === 3
                                  ? 'Entgelt'
                                  : getTypeLabel(tx)}
                          </span>
                          {phase === 1 && txRes && (
                            <span className="ml-1.5 inline-flex items-center gap-1">
                              <span
                                className="h-1.5 w-1.5 cursor-default rounded-full bg-green-500/80"
                                title={
                                  txRes.type === 'restructured'
                                    ? `Реструктурировано (${txRes.monthlyAmount?.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}/мес)`
                                    : 'Оплачен другим способом'
                                }
                              />
                              <button
                                onClick={() => onDeleteDebtResolution(txRes.id)}
                                className="text-neutral-600 hover:text-red-400"
                                title="Отменить"
                              >
                                <X className="h-2.5 w-2.5" />
                              </button>
                            </span>
                          )}
                        </span>
                      </td>
                      <td className={`px-4 py-2.5 transition-colors duration-300 ${descColor}`}>
                        <div>{tx.description || '–'}</div>
                        {tx.comment && editingCommentId !== tx.id && (
                          <div className="mt-0.5 flex items-start gap-1 text-[11px] text-neutral-500 italic">
                            <MessageSquare className="h-3 w-3 mt-0.5 shrink-0 text-blue-500/70" />
                            <span className="truncate" title={tx.comment}>{tx.comment}</span>
                          </div>
                        )}
                        {editingCommentId === tx.id && onUpdateComment && (
                          <div className="mt-2 flex flex-col gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 p-2">
                            <textarea
                              value={commentDraft}
                              onChange={(e) => setCommentDraft(e.target.value)}
                              autoFocus
                              rows={2}
                              maxLength={300}
                              placeholder="Комментарий к транзакции..."
                              className="w-full resize-none rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                  setEditingCommentId(null)
                                } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                  e.preventDefault()
                                  void onUpdateComment(tx.id, commentDraft).then(() => setEditingCommentId(null))
                                }
                              }}
                            />
                            <div className="flex items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingCommentId(null)}
                                className="text-[10px] text-neutral-500 hover:text-neutral-300"
                              >
                                Отмена
                              </button>
                              <div className="flex items-center gap-1.5">
                                {tx.comment && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void onUpdateComment(tx.id, '').then(() => setEditingCommentId(null))
                                    }}
                                    className="rounded px-2 py-0.5 text-[10px] text-red-400 hover:bg-red-950/30"
                                  >
                                    Удалить
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    void onUpdateComment(tx.id, commentDraft).then(() => setEditingCommentId(null))
                                  }}
                                  className="rounded bg-blue-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-blue-500"
                                >
                                  Сохранить
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div
                          className={`flex items-center gap-0.5 transition-opacity duration-300 ${
                            phase === 2 || phase === 3
                              ? isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'
                              : 'opacity-100'
                          }`}
                        >
                          {onUpdateComment && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setEditingCommentId(editingCommentId === tx.id ? null : tx.id)
                                setCommentDraft(tx.comment ?? '')
                              }}
                              title={tx.comment ? 'Редактировать комментарий' : 'Добавить комментарий'}
                            >
                              {tx.comment
                                ? <MessageSquare className="h-4 w-4 text-blue-400 transition-colors duration-200 hover:text-blue-300" />
                                : <MessageSquarePlus className="h-4 w-4 text-neutral-500 transition-colors duration-200 hover:text-blue-400" />
                              }
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" onClick={() => onDelete(tx.id)}>
                            <Trash2 className="h-4 w-4 text-neutral-500 transition-colors duration-200 hover:text-red-400" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                }

                if (group) {
                  return (
                    <Fragment key={t.id}>
                      {renderTxRow(t, 1, t.id)}
                      {group.wiedergutschrift && renderTxRow(group.wiedergutschrift, 2, t.id)}
                      {group.entgelt && renderTxRow(group.entgelt, 3, t.id)}
                    </Fragment>
                  )
                }

                return renderTxRow(t)
              })}
          </tbody>
        </table>
      </div>

      {/* Reset all data */}
      <ResetSection onClearAll={onClearAll} />

      {onAddTransaction && (
        <ManualTransactionModal
          isOpen={showCashModal}
          onClose={() => setShowCashModal(false)}
          onSave={onAddTransaction}
        />
      )}
    </div>
  )
}

function ResetSection({ onClearAll }: { onClearAll: () => Promise<void> }): React.JSX.Element {
  const [showDialog, setShowDialog] = useState(false)
  const [toast, setToast] = useState(false)

  const handleConfirm = async (): Promise<void> => {
    await onClearAll()
    setShowDialog(false)
    setToast(true)
    setTimeout(() => setToast(false), 3000)
  }

  return (
    <>
      <div className="flex justify-end pt-4">
        <Button
          variant="ghost"
          onClick={() => setShowDialog(true)}
          className="text-xs text-neutral-500 transition-all duration-200 hover:text-red-400"
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Удалить все транзакции
        </Button>
      </div>

      {showDialog && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-6"
          >
            <h3 className="text-base font-semibold text-neutral-100">
              Удалить все транзакции?
            </h3>
            <p className="mt-2 text-sm text-neutral-400">
              Это действие нельзя отменить. Все импортированные транзакции будут
              удалены.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowDialog(false)}
                className="rounded-md px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200"
              >
                Отмена
              </button>
              <button
                onClick={handleConfirm}
                className="rounded-md bg-red-900/60 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-900"
              >
                Да, удалить всё
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}

      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="fixed bottom-6 right-6 z-50 rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-3 text-sm text-neutral-200 shadow-lg"
        >
          Все транзакции удалены
        </motion.div>
      )}
    </>
  )
}
