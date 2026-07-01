import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Undo2,
  Redo2,
  Search,
  X,
  ArrowUpDown,
  ChevronDown,
  FolderPlus,
  Pencil,
  Trash2,
  Check as CheckIcon,
  Download,
} from 'lucide-react'
import type {
  Obligation,
  ObligationMonth,
  ObligationStatus,
  ObligationType,
  ObligationFrequency,
  AppData,
  HistoryEntry,
  ObligationSection,
} from '../types'
import { ObligationCard } from './ObligationCard'
import { AddObligationModal } from './AddObligationModal'
import { clampDayToMonth, formatLocalDate, effectiveAmount } from '../utils/financialEngine'

interface ObligationsTabProps {
  obligations: Obligation[]
  obligationMonths: ObligationMonth[]
  undoHistory: HistoryEntry[]
  redoStack?: HistoryEntry[]
  customSections: ObligationSection[]
  onAdd: (o: Omit<Obligation, 'id' | 'createdAt'>, createdAt?: string) => Promise<Obligation>
  onUpdate: (id: string, updates: Partial<Obligation>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onStatusChange: (
    obligationId: string,
    year: number,
    month: number,
    status: ObligationStatus,
    transactionId?: string,
    skipUndo?: boolean
  ) => Promise<void>
  getMonthRecord: (obligationId: string, year: number, month: number) => ObligationMonth | null
  onUndo?: () => Promise<void>
  onRedo?: () => Promise<void>
  pushUndo?: (action: string, before: Partial<AppData>, after: Partial<AppData>) => void
  onAddSection: (name: string) => Promise<ObligationSection>
  onDeleteSection: (id: string) => Promise<void>
  onRenameSection: (id: string, name: string) => Promise<void>
  onCarryDebt: (obligationId: string, fromYear: number, fromMonth: number, toYear: number, toMonth: number) => Promise<void>
  onSetCarriedPaid: (obligationId: string, year: number, month: number, paid: boolean) => Promise<void>
  onReturnCarried: (obligationId: string, year: number, month: number) => Promise<void>
}

export function ObligationsTab({
  obligations,
  obligationMonths,
  undoHistory,
  redoStack,
  customSections,
  onAdd,
  onUpdate,
  onDelete,
  onStatusChange,
  getMonthRecord,
  onUndo,
  onRedo,
  pushUndo,
  onAddSection,
  onDeleteSection,
  onRenameSection,
  onCarryDebt,
  onSetCarriedPaid,
  onReturnCarried,
}: ObligationsTabProps): React.JSX.Element {
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Obligation | null>(null)
  const [preselectedType, setPreselectedType] = useState<ObligationType>('subscription')
  const [preselectedFrequency, setPreselectedFrequency] = useState<ObligationFrequency>('monthly')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [newSectionName, setNewSectionName] = useState('')
  const [showAddSection, setShowAddSection] = useState(false)
  const [renamingSectionId, setRenamingSectionId] = useState<string | null>(null)
  const [renamingSectionName, setRenamingSectionName] = useState('')
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())

  // Month navigation
  const [navYear, setNavYear] = useState(new Date().getFullYear())
  const [navMonth, setNavMonth] = useState(new Date().getMonth() + 1)

  // Search and filters
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'paid' | 'unpaid' | 'unknown'>('all')
  const [filterType, setFilterType] = useState<'all' | 'monthly' | 'yearly' | 'once'>('all')
  const [sortBy, setSortBy] = useState<'name' | 'amount' | 'date'>('name')

  // Collapsed sections
  const [collapsedMonthly, setCollapsedMonthly] = useState(false)
  const [collapsedYearly, setCollapsedYearly] = useState(false)
  const [collapsedOnce, setCollapsedOnce] = useState(false)
  const [collapsedKlarna, setCollapsedKlarna] = useState(false)

  // Klarna add modal (unified with paste parser)
  const [klarnaAddOpen, setKlarnaAddOpen] = useState(false)
  const [klarnaPaymentType, setKlarnaPaymentType] = useState<'installment' | 'single'>('installment')
  const [klarnaPasteText, setKlarnaPasteText] = useState('')
  const [klarnaGenDate, setKlarnaGenDate] = useState(() => formatLocalDate(new Date()))
  const [klarnaAddMerchant, setKlarnaAddMerchant] = useState('')
  const [klarnaAddTotal, setKlarnaAddTotal] = useState('')
  const [klarnaAddMonthly, setKlarnaAddMonthly] = useState('')
  const [klarnaAddTotalInst, setKlarnaAddTotalInst] = useState('')
  const [klarnaAddPaidInst, setKlarnaAddPaidInst] = useState('0')
  const [klarnaAddNextDate, setKlarnaAddNextDate] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 1)
    return formatLocalDate(d)
  })
  const [klarnaAddSaving, setKlarnaAddSaving] = useState(false)
  const [klarnaParseError, setKlarnaParseError] = useState('')
  const [klarnaSaveError, setKlarnaSaveError] = useState('')

  // One-time cleanup: single-payment Klarna obligations (totalInstallments=1)
  // should not have ObligationMonth records in future months
  const singleKlarnaCleanupDone = useRef(false)
  useEffect(() => {
    if (singleKlarnaCleanupDone.current) return
    const todayY = new Date().getFullYear()
    const todayM = new Date().getMonth() + 1
    const singleKlarnaIds = new Set(
      obligations
        .filter((o) => o.billingChain === 'klarna' && o.totalInstallments === 1)
        .map((o) => o.id)
    )
    if (singleKlarnaIds.size === 0) return
    const futureMonths = obligationMonths.filter(
      (m) => singleKlarnaIds.has(m.obligationId) && (m.year > todayY || (m.year === todayY && m.month > todayM))
    )
    if (futureMonths.length === 0) return
    singleKlarnaCleanupDone.current = true
    const kept = obligationMonths.filter(
      (m) => !(singleKlarnaIds.has(m.obligationId) && (m.year > todayY || (m.year === todayY && m.month > todayM)))
    )
    void window.api.store.setAllObligationMonths(kept)
    // Also update frequency to 'once' for these obligations
    for (const id of singleKlarnaIds) {
      const ob = obligations.find((o) => o.id === id)
      if (ob && ob.frequency !== 'once') {
        void onUpdate(id, { frequency: 'once' })
      }
    }
  }, [obligations, obligationMonths, onUpdate])

  const now = useMemo(() => new Date(), [])
  const year = navYear
  const month = navMonth

  const currentMonthLabel = useMemo(() => {
    return new Date(year, month - 1, 1).toLocaleDateString('ru-RU', {
      month: 'long',
      year: 'numeric',
    })
  }, [year, month])

  const canGoPrev = true
  const canGoNext = useMemo(() => {
    const now = new Date()
    const nextMonth = new Date(year, month, 1)
    // Планирование бюджета до 3 месяцев вперёд (раньше — только следующий месяц).
    return nextMonth <= new Date(now.getFullYear(), now.getMonth() + 3, 1)
  }, [year, month])

  // «Нативно» активно в заданном месяце: isActive + месяц >= createdAt (once — только
  // в месяце создания). Единый предикат: используется и для базового active, и как гейт
  // «начислять ли текущий платёж месяца» (nativeThisMonth) в подсчётах.
  const isNativeActive = useCallback((o: Obligation, y: number, m: number): boolean => {
    if (!o.isActive) return false
    const created = new Date(o.createdAt)
    const createdYear = created.getFullYear()
    const createdMonth = created.getMonth() + 1
    if (y < createdYear || (y === createdYear && m < createdMonth)) return false
    if (o.frequency === 'once') return createdYear === y && createdMonth === m
    return true
  }, [])

  // Обязательства, ПЕРЕНЕСЁННЫЕ В этот месяц (есть isCarriedOver-запись за nav-месяц).
  // Нужно, чтобы once/yearly (которые фильтр active не показывает вне их месяца) всё равно
  // отображались в целевом месяце переноса и участвовали в подсчётах (баг №1/№2).
  const carriedInIds = useMemo(() => {
    const ids = new Set<string>()
    for (const m of obligationMonths) {
      if (m.isCarriedOver && m.year === year && m.month === month) ids.add(m.obligationId)
    }
    return ids
  }, [obligationMonths, year, month])

  const active = useMemo(
    () => obligations.filter((o) => isNativeActive(o, year, month) || (o.isActive && carriedInIds.has(o.id))),
    [obligations, year, month, isNativeActive, carriedInIds]
  )

  // For yearly obligations: find the month they were last paid and compute "paid until" date.
  // If paid in month M of year Y → covered until month M of year Y+1 (exclusive).
  const yearlyPaidUntilMap = useMemo(() => {
    const map = new Map<string, { paidMonth: number; paidYear: number; untilMonth: number; untilYear: number }>()

    for (const o of active) {
      if (o.frequency !== 'yearly') continue

      // Search backwards from current viewing month for a 'paid' record (up to 12 months)
      let cy = year
      let cm = month
      for (let i = 0; i < 13; i++) {
        const rec = getMonthRecord(o.id, cy, cm)
        if (rec?.status === 'paid') {
          // Paid in cy/cm → valid until cm of cy+1 (exclusive: months cm..cy+1 minus 1 month)
          let untilMonth = cm - 1
          let untilYear = cy + 1
          if (untilMonth === 0) { untilMonth = 12; untilYear-- }
          map.set(o.id, { paidMonth: cm, paidYear: cy, untilMonth, untilYear })
          break
        }
        cm--
        if (cm === 0) { cm = 12; cy-- }
      }
    }

    return map
  }, [active, year, month, getMonthRecord])

  // Check if a yearly obligation is covered (paid) for the current viewing month
  const isYearlyCovered = useCallback((o: Obligation): boolean => {
    if (o.frequency !== 'yearly') return false
    const info = yearlyPaidUntilMap.get(o.id)
    if (!info) return false
    // Current viewing month is covered if it's between paidMonth/paidYear and untilMonth/untilYear (inclusive)
    const paidYM = info.paidYear * 12 + info.paidMonth
    const untilYM = info.untilYear * 12 + info.untilMonth
    const currentYM = year * 12 + month
    return currentYM >= paidYM && currentYM <= untilYM
  }, [yearlyPaidUntilMap, year, month])

  // Автоматический carryoverMap отключён — только ручной перенос через кнопку.
  // Возвращает пустую Map, чтобы карточки не показывали долг без явного переноса.
  const carryoverMap = useMemo(
    () => new Map<string, { fromYear: number; fromMonth: number; months: number; totalDebt: number; resolved: boolean }>(),
    []
  )

  // Для каждого обязательства в текущем nav-месяце: куда был перенесён долг (если был)
  // Ключ = obligationId, значение = {toYear, toMonth} куда создана isCarriedOver-запись
  const carryDestMap = useMemo(() => {
    const map = new Map<string, { toYear: number; toMonth: number }>()
    for (const m of obligationMonths) {
      if (m.isCarriedOver && m.carriedFromYear === year && m.carriedFromMonth === month) {
        map.set(m.obligationId, { toYear: m.year, toMonth: m.month })
      }
    }
    return map
  }, [obligationMonths, year, month])

  // Вычисляет эффективный статус обязательства для nav-месяца.
  // Monthly без записи → 'unpaid' (активная подписка, не подтверждена оплата).
  // Yearly/once без записи → 'unknown'.
  const getEffectiveStatus = useCallback((o: Obligation, rec: ObligationMonth | null): ObligationStatus => {
    if (rec?.status != null) return rec.status
    // yearly → 'unknown' (неизвестно, due ли в этом месяце); monthly и once → 'unpaid'.
    // Once виден только в своём месяце создания, где платёж реально предстоит.
    return o.frequency === 'yearly' ? 'unknown' : 'unpaid'
  }, [])

  // Apply filters
  const filtered = useMemo(() => {
    return active.filter((o) => {
      // Hide obligations skipped for this specific month
      if (getMonthRecord(o.id, year, month)?.status === 'skipped') return false
      // Search
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        const text = `${o.name} ${o.notes ?? ''} ${o.source}`.toLowerCase()
        if (!text.includes(q)) return false
      }
      // Status filter
      if (filterStatus !== 'all') {
        const rec = getMonthRecord(o.id, year, month)
        const status = getEffectiveStatus(o, rec)
        if (filterStatus === 'paid' && status !== 'paid') return false
        if (filterStatus === 'unpaid' && status !== 'unpaid') return false
        if (filterStatus === 'unknown' && status !== 'unknown') return false
      }
      // Type filter
      if (filterType !== 'all') {
        const freq: ObligationFrequency = o.frequency ?? 'monthly'
        if (filterType === 'monthly' && freq !== 'monthly') return false
        if (filterType === 'yearly' && freq !== 'yearly') return false
        if (filterType === 'once' && freq !== 'once') return false
      }
      return true
    })
  }, [active, searchQuery, filterStatus, filterType, year, month, getMonthRecord, getEffectiveStatus])

  // Sort: paid obligations sink to bottom, then by selected criteria
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const recA = getMonthRecord(a.id, year, month)
      const recB = getMonthRecord(b.id, year, month)
      const aIsYearlyCovered = a.frequency === 'yearly' && isYearlyCovered(a)
      const bIsYearlyCovered = b.frequency === 'yearly' && isYearlyCovered(b)
      const aPaid = recA?.status === 'paid' || aIsYearlyCovered
      const bPaid = recB?.status === 'paid' || bIsYearlyCovered
      if (aPaid !== bPaid) return aPaid ? 1 : -1
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      if (sortBy === 'amount') return (b.amount ?? 0) - (a.amount ?? 0)
      if (sortBy === 'date') return (b.approximateDay ?? 0) - (a.approximateDay ?? 0)
      return 0
    })
  }, [filtered, sortBy, getMonthRecord, year, month, isYearlyCovered])

  // Klarna (любой frequency) живёт в своей секции и исключён из monthly/yearly/once,
  // иначе единоразовое (once) Klarna падало в «Единоразовые» (BUG-019).
  const monthlyObligations = sorted.filter((o) => (o.frequency ?? 'monthly') === 'monthly' && o.billingChain !== 'klarna' && !o.sectionId && !o.parentId)
  const regularMonthly = monthlyObligations.filter((o) => o.billingChain !== 'klarna')
  const regularMonthlyUnpaid = regularMonthly.filter((o) => {
    const rec = getMonthRecord(o.id, year, month)
    return rec?.status !== 'paid'
  })
  const regularMonthlyPaid = regularMonthly.filter((o) => {
    const rec = getMonthRecord(o.id, year, month)
    return rec?.status === 'paid'
  })
  const klarnaMonthly = sorted.filter((o) => o.billingChain === 'klarna' && !o.sectionId && !o.parentId)
  const yearlyObligations = sorted.filter((o) => o.frequency === 'yearly' && o.billingChain !== 'klarna' && !o.sectionId && !o.parentId)
  const onceObligations = sorted.filter((o) => o.frequency === 'once' && o.billingChain !== 'klarna' && !o.sectionId && !o.parentId)

  // Map Klarna obligation IDs to count of paid ObligationMonth records
  const klarnaPaidCountMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const o of obligations) {
      if (o.billingChain !== 'klarna') continue
      const count = obligationMonths.filter(
        (m) => m.obligationId === o.id && m.status === 'paid'
      ).length
      map.set(o.id, count)
    }
    return map
  }, [obligations, obligationMonths])

  // BUG-014: Klarna полностью оплачена (paid count >= totalInstallments).
  // Карточка остаётся видимой как «история», но не учитывается в шапке €/мес и в paidCount.
  const isKlarnaCompleted = useCallback((o: Obligation): boolean => {
    if (o.billingChain !== 'klarna') return false
    if (!o.totalInstallments) return false
    const paid = klarnaPaidCountMap.get(o.id) ?? 0
    return paid >= o.totalInstallments
  }, [klarnaPaidCountMap])

  // Obligations grouped by custom section
  const sectionObligations = useMemo(() => {
    const map = new Map<string, Obligation[]>()
    for (const s of customSections) {
      map.set(s.id, sorted.filter((o) => o.sectionId === s.id && !o.parentId))
    }
    return map
  }, [sorted, customSections])

  const totalMonthlyFiltered = useMemo(() => {
    return filtered.reduce((sum, o) => {
      // Завершённая рассрочка Klarna (оплачено >= всего платежей) больше ничего не должна,
      // но в месяцах после последнего платежа у неё нет записи → дефолт monthly 'unpaid'
      // ложно добавлял её сумму в «Осталось оплатить» (BUG-022).
      if (isKlarnaCompleted(o)) return sum
      // Долг перенесён ИЗ этого месяца → исключаем полностью
      if (carryDestMap.has(o.id)) return sum

      const rec = getMonthRecord(o.id, year, month)

      // Yearly: skip if covered or not due this month
      if (o.frequency === 'yearly') {
        if (isYearlyCovered(o)) return sum
        if (o.yearlyMonth != null && o.yearlyMonth !== month) return sum
      }

      const base = effectiveAmount(o, year, month) ?? 0

      // Новая система isCarriedOver: считаем каждую часть отдельно.
      // Текущий платёж месяца начисляем только если обязательство нативно в этом месяце —
      // у перенесённых сюда once/yearly текущего начисления нет, только сам долг (баг №1/№2).
      if (rec?.isCarriedOver) {
        const carriedPart = rec.carriedPaid ? 0 : (rec.carriedAmount ?? 0)
        const nativeHere = isNativeActive(o, year, month)
        const currentPart = (nativeHere && rec.status !== 'paid') ? base : 0
        const total = carriedPart + currentPart
        return total > 0 ? sum + total : sum
      }

      // Обычные записи: пропускаем оплаченные и explicitly unknown
      if (rec?.status === 'paid') return sum
      if (rec && rec.status === 'unknown') return sum
      // Без записи: monthly считаем как unpaid, остальные пропускаем
      if (!rec && getEffectiveStatus(o, null) === 'unknown') return sum

      return sum + base
    }, 0)
  }, [filtered, isYearlyCovered, getMonthRecord, year, month, getEffectiveStatus, carryDestMap, isKlarnaCompleted, isNativeActive])

  const totalPaidFiltered = useMemo(() => {
    return filtered.reduce((sum, o) => {
      const rec = getMonthRecord(o.id, year, month)
      const base = effectiveAmount(o, year, month) ?? 0

      if (rec?.isCarriedOver) {
        const nativeHere = isNativeActive(o, year, month)
        const carriedPart = rec.carriedPaid ? (rec.carriedAmount ?? 0) : 0
        const currentPart = (nativeHere && rec.status === 'paid') ? base : 0
        return sum + carriedPart + currentPart
      }

      if (rec?.status === 'paid') return sum + base
      return sum
    }, 0)
  }, [filtered, getMonthRecord, year, month, isNativeActive])

  // Годовой итог — только нативные (перенесённые сюда yearly не дают «текущего» начисления).
  const yearlyTotal = yearlyObligations.reduce((s, o) => s + (isNativeActive(o, year, month) ? (effectiveAmount(o, year, month) ?? 0) : 0), 0)

  const carryoverFiltered = useMemo(() => {
    let total = 0
    let count = 0
    for (const o of filtered) {
      const info = carryoverMap.get(o.id)
      if (info && !info.resolved) {
        total += info.totalDebt
        count++
      }
    }
    return { total, count }
  }, [filtered, carryoverMap])

  const paidCount = filtered.filter((o) => {
    // BUG-014: completed Klarna (paid >= totalInstallments) исключены из счётчика —
    // их paid-метка за текущий месяц это часть импорт-истории, не реальный платёж пользователя.
    if (isKlarnaCompleted(o)) return false
    // Only count obligations with an actual 'paid' record for THIS month.
    // Yearly covered by a past month's payment are NOT counted here.
    const rec = getMonthRecord(o.id, year, month)
    return rec?.status === 'paid'
  }).length

  const pendingCount = filtered.filter((o) => {
    // Завершённая Klarna ничего не ожидает (симметрично paidCount и totalMonthlyFiltered, BUG-022)
    if (isKlarnaCompleted(o)) return false
    // Долг перенесён ИЗ этого месяца → больше не "ожидает оплаты" здесь
    if (carryDestMap.has(o.id)) return false
    const rec = getMonthRecord(o.id, year, month)
    // Перенесённый СЮДА долг: ожидает, пока не погашен; текущий платёж — только если нативно.
    if (rec?.isCarriedOver) {
      const nativeHere = isNativeActive(o, year, month)
      return !rec.carriedPaid || (nativeHere && rec.status !== 'paid')
    }
    if (o.frequency === 'yearly') {
      if (isYearlyCovered(o)) return false           // already covered
      if (o.yearlyMonth != null && o.yearlyMonth !== month) return false
    }
    // Paid → not pending
    if (rec?.status === 'paid') return false
    // Explicitly unknown → excluded
    if (rec && rec.status === 'unknown') return false
    // Monthly obligations default to 'unpaid' even without a record
    if (!rec && o.frequency === 'yearly' && !carryoverMap.has(o.id)) return false
    // 'unpaid' or monthly without record or carryover → pending
    return true
  }).length

  // Due warnings — obligations due within 5 days that are not paid
  // Klarna obligations excluded: KlarnaSection handles them with real nextPaymentDate logic
  const dueWarnings = useMemo(() => {
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    return active.filter((o) => {
      if (o.approximateDay === null) return false
      if (o.billingChain === 'klarna') return false
      const rec = getMonthRecord(o.id, year, month)
      if (rec?.status === 'paid') return false
      // Real calendar math
      const oMonth = today.getMonth()
      const oYear = today.getFullYear()
      let nextDate = new Date(oYear, oMonth, clampDayToMonth(oYear, oMonth, o.approximateDay))
      nextDate.setHours(0, 0, 0, 0)
      if (nextDate < today) {
        nextDate = new Date(oYear, oMonth + 1, clampDayToMonth(oYear, oMonth + 1, o.approximateDay))
      }
      const diff = Math.round((nextDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
      return diff >= 0 && diff <= 5
    })
  }, [active, year, month, now, getMonthRecord])

  const handleOpenAdd = (type: ObligationType, frequency: ObligationFrequency = 'monthly'): void => {
    setEditTarget(null)
    setPreselectedType(type)
    setPreselectedFrequency(frequency)
    setModalOpen(true)
  }

  const handleEdit = (o: Obligation): void => {
    setEditTarget(o)
    setModalOpen(true)
  }

  const handleDelete = (id: string): void => {
    setDeleteConfirm(id)
  }

  const handleSkipMonth = async (): Promise<void> => {
    if (deleteConfirm) {
      await onStatusChange(deleteConfirm, year, month, 'skipped')
      setDeleteConfirm(null)
    }
  }

  const confirmDelete = async (): Promise<void> => {
    if (deleteConfirm) {
      const obligationToDelete = obligations.find(o => o.id === deleteConfirm)
      if (pushUndo && obligationToDelete) {
        pushUndo('Удаление обязательства',
          { obligations: [...obligations] },
          { obligations: obligations.filter(o => o.id !== deleteConfirm) }
        )
      }
      await onDelete(deleteConfirm)
      setDeleteConfirm(null)
    }
  }

  const handleSave = async (o: Omit<Obligation, 'id' | 'createdAt'>, klarnaPaidInstallments?: number, priceFromCurrentMonth?: boolean): Promise<void> => {
    if (editTarget) {
      // #1: «Изменить цену только с открытого месяца» — не трогаем базовый amount,
      // добавляем эффективно-датированную запись в amountChanges с месяца просмотра.
      let patch = o
      if (priceFromCurrentMonth && o.amount != null) {
        const key = `${year}-${String(month).padStart(2, '0')}`
        const prevChanges = (editTarget.amountChanges ?? []).filter(c => c.from !== key)
        const newChanges = [...prevChanges, { from: key, amount: o.amount }].sort((a, b) => a.from.localeCompare(b.from))
        patch = { ...o, amount: editTarget.amount, amountChanges: newChanges }
      }
      if (pushUndo) {
        pushUndo('Изменение обязательства',
          { obligations, obligationMonths },
          {
            obligations: obligations.map(ob => ob.id === editTarget.id ? { ...ob, ...patch } : ob),
            obligationMonths
          }
        )
      }
      await onUpdate(editTarget.id, patch)

      // Klarna: recalculate ObligationMonth records when paid count changes
      if (editTarget.billingChain === 'klarna' && klarnaPaidInstallments != null) {
        const currentPaid = klarnaPaidCountMap.get(editTarget.id) ?? 0
        if (klarnaPaidInstallments !== currentPaid) {
          const created = new Date(editTarget.createdAt)
          const sYear = created.getFullYear()
          const sMonth = created.getMonth() + 1
          // future-paid guard: нельзя помечать 'оплачено' месяцы позже текущего реального
          const realNow = new Date()
          const curYM = realNow.getFullYear() * 12 + (realNow.getMonth() + 1)

          // Mark months that should be paid
          for (let i = 0; i < klarnaPaidInstallments; i++) {
            let mYear = sYear
            let mMonth = sMonth + i
            while (mMonth > 12) { mMonth -= 12; mYear++ }
            if (mYear * 12 + mMonth > curYM) break
            const existing = obligationMonths.find(
              (m) => m.obligationId === editTarget.id && m.year === mYear && m.month === mMonth
            )
            if (existing?.status !== 'paid') {
              await onStatusChange(editTarget.id, mYear, mMonth, 'paid')
            }
          }

          // Unmark months that should no longer be paid (if count decreased)
          if (klarnaPaidInstallments < currentPaid) {
            const totalInst = o.totalInstallments ?? editTarget.totalInstallments ?? 999
            for (let i = klarnaPaidInstallments; i < totalInst; i++) {
              let mYear = sYear
              let mMonth = sMonth + i
              while (mMonth > 12) { mMonth -= 12; mYear++ }
              const existing = obligationMonths.find(
                (m) => m.obligationId === editTarget.id && m.year === mYear && m.month === mMonth
              )
              if (existing?.status === 'paid') {
                await onStatusChange(editTarget.id, mYear, mMonth, 'unpaid')
              }
            }
          }
        }
      }
    } else {
      const beforeObligations = [...obligations]
      // Привязываем createdAt к просматриваемому месяцу, если он не текущий —
      // тогда обязательство появляется именно в открытом месяце (прошлом ИЛИ будущем),
      // а once-обязательства не "светятся" в неправильном месяце. В текущем месяце —
      // createdAt по умолчанию (now), чтобы не сбивать время создания.
      const realNow = new Date()
      const realYear = realNow.getFullYear()
      const realMonth = realNow.getMonth() + 1
      const isViewingCurrent = year === realYear && month === realMonth
      const targetCreatedAt = isViewingCurrent ? undefined : new Date(year, month - 1, 1).toISOString()
      const newObligation = await onAdd(o, targetCreatedAt)
      // Auto-set status to 'unpaid' for the current month so it appears correctly
      await onStatusChange(newObligation.id, year, month, 'unpaid')
      if (pushUndo) {
        pushUndo('Добавление обязательства',
          { obligations: beforeObligations },
          { obligations: [...beforeObligations, newObligation] }
        )
      }
    }
  }

  // Парсер вставленного текста Klarna. Ожидаемый формат (разделитель строк любой):
  //   Merchant
  //   Initiated 3 days ago  ИЛИ  Autopay in 7 days
  //   5 of 12 (179,00 €)
  //   •••• 6406              (игнорируется)
  //   25,00 €                (ежемесячный платёж)
  // Возвращает частично-заполненные поля формы или сообщение об ошибке.
  const parseKlarnaPaste = (text: string): string => {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) return 'Пустой текст'

    let paid = 0
    let total = 0
    let originalTotal = 0
    let monthly = 0
    let days = 0
    let mode: 'initiated' | 'autopay' | null = null
    const skipIdx = new Set<number>()

    // "N of M (AMOUNT €)"
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/(\d+)\s+of\s+(\d+)\s*\(([\d.,]+)\s*€\)/i)
      if (m) {
        paid = parseInt(m[1])
        total = parseInt(m[2])
        originalTotal = parseFloat(m[3].replace(/\./g, '').replace(',', '.'))
        skipIdx.add(i)
        break
      }
    }

    // "Initiated X days ago" или "Autopay in X days"
    for (let i = 0; i < lines.length; i++) {
      let m = lines[i].match(/Initiated\s+(\d+)\s+days?\s+ago/i)
      if (m) { days = parseInt(m[1]); mode = 'initiated'; skipIdx.add(i); break }
      m = lines[i].match(/Autopay\s+in\s+(\d+)\s+days?/i)
      if (m) { days = parseInt(m[1]); mode = 'autopay'; skipIdx.add(i); break }
    }

    // Карта "•••• 6406"
    for (let i = 0; i < lines.length; i++) {
      if (/[•*]{2,}\s*\d{3,}/.test(lines[i])) skipIdx.add(i)
    }

    // Ежемесячный платёж "N,NN €" (последняя оставшаяся строка с €)
    for (let i = lines.length - 1; i >= 0; i--) {
      if (skipIdx.has(i)) continue
      const m = lines[i].match(/^([\d.,]+)\s*€$/i)
      if (m) {
        monthly = parseFloat(m[1].replace(/\./g, '').replace(',', '.'))
        skipIdx.add(i)
        break
      }
    }

    // Магазин — первая оставшаяся строка
    let merchant = ''
    for (let i = 0; i < lines.length; i++) {
      if (!skipIdx.has(i)) { merchant = lines[i]; break }
    }

    if (!merchant) return 'Не найдено название магазина'
    if (!monthly) return 'Не найдена сумма (€)'

    // Единоразовый платёж: нет строки "N of M"
    const isSingle = total === 0
    if (isSingle) {
      total = 1
      paid = mode === 'initiated' ? 1 : 0
      originalTotal = monthly
      setKlarnaPaymentType('single')
    } else {
      setKlarnaPaymentType('installment')
    }

    // Дата следующего платежа (только для рассрочек)
    const gen = new Date(klarnaGenDate)
    let nextDate: Date
    if (isSingle) {
      nextDate = gen
    } else if (mode === 'autopay') {
      nextDate = new Date(gen)
      nextDate.setDate(nextDate.getDate() + days)
    } else if (mode === 'initiated') {
      const lastPaid = new Date(gen)
      lastPaid.setDate(lastPaid.getDate() - days)
      nextDate = new Date(lastPaid)
      nextDate.setMonth(nextDate.getMonth() + 1)
    } else {
      nextDate = new Date(gen)
      nextDate.setMonth(nextDate.getMonth() + 1)
    }

    setKlarnaAddMerchant(merchant)
    setKlarnaAddTotal(originalTotal ? originalTotal.toFixed(2) : '')
    setKlarnaAddMonthly(monthly.toFixed(2))
    setKlarnaAddTotalInst(String(total))
    setKlarnaAddPaidInst(String(paid))
    setKlarnaAddNextDate(isSingle ? '' : formatLocalDate(nextDate))
    return ''
  }

  const handleKlarnaAdd = async (): Promise<void> => {
    const merchant = klarnaAddMerchant.trim()
    const originalTotal = parseFloat(klarnaAddTotal)
    const monthlyAmount = parseFloat(klarnaAddMonthly)
    const totalInstallments = parseInt(klarnaAddTotalInst)
    const paidInstallments = parseInt(klarnaAddPaidInst)
    const isSingle = klarnaPaymentType === 'single'
    setKlarnaSaveError('')
    if (!merchant) { setKlarnaSaveError('Укажи название магазина'); return }
    if (isNaN(monthlyAmount) || monthlyAmount <= 0) { setKlarnaSaveError('Укажи сумму платежа'); return }
    if (!isSingle && (isNaN(totalInstallments) || totalInstallments < 1)) {
      setKlarnaSaveError('Укажи количество платежей'); return
    }
    if (!isSingle) {
      const [y, m, d] = klarnaAddNextDate.split('-').map(Number)
      if (!y || !m || !d || isNaN(y) || isNaN(m) || isNaN(d)) {
        setKlarnaSaveError('Укажи дату следующего платежа'); return
      }
    }
    setKlarnaAddSaving(true)
    try {
      const todayYear = new Date().getFullYear()
      const todayMonth = new Date().getMonth() + 1

      if (isSingle) {
        const safePaid = isNaN(paidInstallments) ? 0 : paidInstallments
        const status: ObligationStatus = safePaid >= 1 ? 'paid' : 'unpaid'
        // Привязываем единоразовый платёж к ПРОСМАТРИВАЕМОМУ месяцу (как в handleSave):
        // если открыт не текущий месяц — createdAt = первое число этого месяца, иначе
        // once-обязательство «светится» в месяце создания (now), а не в открытом будущем.
        const isViewingCurrent = year === todayYear && month === todayMonth
        const targetCreatedAt = isViewingCurrent ? undefined : new Date(year, month - 1, 1).toISOString()
        const beforeObligations = [...obligations]
        const newObligation = await onAdd({
          name: `${merchant} (платёж Klarna ${monthlyAmount.toFixed(2)}€)`,
          type: 'manual_payment',
          amount: monthlyAmount,
          approximateDay: null,
          billingChain: 'klarna',
          source: 'Klarna',
          isActive: true,
          frequency: 'once',
          totalInstallments: 1,
          originalTotal: monthlyAmount,
        }, targetCreatedAt)
        // Статус пишем в ПРОСМАТРИВАЕМЫЙ месяц (а не в текущий реальный)
        await onStatusChange(newObligation.id, year, month, status)
        // Объединённый undo: один откат убирает и обязательство, и его статус-запись
        // (onStatusChange внутри пушит свой months-only снимок — он остаётся ниже и безвреден,
        //  как при обычном добавлении в handleSave).
        if (pushUndo) {
          const record: ObligationMonth = {
            obligationId: newObligation.id,
            year,
            month,
            status,
            actualAmount: null,
            paidDate: status === 'paid' ? formatLocalDate(new Date()) : undefined,
          }
          pushUndo('Добавление обязательства Klarna',
            { obligations: beforeObligations, obligationMonths },
            {
              obligations: [...beforeObligations, newObligation],
              obligationMonths: [...obligationMonths, record],
            }
          )
        }
      } else {
        const [npYear, npMonthNum, npDay] = klarnaAddNextDate.split('-').map(Number)
        const safePaid = isNaN(paidInstallments) ? 0 : paidInstallments
        let startYear = npYear
        let startMonth = npMonthNum - safePaid
        while (startMonth <= 0) { startMonth += 12; startYear-- }
        const createdAt = new Date(startYear, startMonth - 1, 1).toISOString()

        const newObligation = await onAdd({
          name: `${merchant} (рассрочка ${isNaN(originalTotal) ? monthlyAmount * totalInstallments : originalTotal}€)`,
          type: 'manual_payment',
          amount: monthlyAmount,
          approximateDay: npDay || null,
          billingChain: 'klarna',
          source: 'Klarna',
          isActive: true,
          frequency: 'monthly',
          totalInstallments,
          originalTotal: isNaN(originalTotal) ? undefined : originalTotal,
        }, createdAt)

        // future-paid guard: нельзя помечать 'оплачено' месяцы позже текущего реального
        const realNow = new Date()
        const curYM = realNow.getFullYear() * 12 + (realNow.getMonth() + 1)
        for (let i = 0; i < safePaid; i++) {
          let paidYear = npYear
          let paidMonth = npMonthNum - safePaid + i
          while (paidMonth <= 0) { paidMonth += 12; paidYear-- }
          if (paidYear * 12 + paidMonth > curYM) break
          await onStatusChange(newObligation.id, paidYear, paidMonth, 'paid')
        }
      }

      setKlarnaAddOpen(false)
      setKlarnaPasteText('')
      setKlarnaParseError('')
      setKlarnaSaveError('')
      setKlarnaAddMerchant(''); setKlarnaAddTotal(''); setKlarnaAddMonthly('')
      setKlarnaAddTotalInst(''); setKlarnaAddPaidInst('0')
      setKlarnaPaymentType('installment')
      setKlarnaGenDate(formatLocalDate(new Date()))
    } catch (e) {
      setKlarnaSaveError('Не удалось сохранить: ' + (e instanceof Error ? e.message : 'неизвестная ошибка'))
    } finally {
      setKlarnaAddSaving(false)
    }
  }

  const handleStatusToggle = async (
    obligationId: string,
    status: ObligationStatus
  ): Promise<void> => {
    const currentRecord = getMonthRecord(obligationId, year, month)
    // Save current state for undo BEFORE change
    const beforeState = { obligationMonths: [...obligationMonths] }

    // skipUndo=true: внутренние вызовы НЕ пишут собственный undo — ниже пушим ОДИН
    // объединённый undo на всю операцию (статус + дети + carryover). Иначе одно нажатие
    // давало 2+ undo-записей и кнопку «Отменить» приходилось жать дважды (BUG-022).
    await onStatusChange(obligationId, year, month, status, undefined, true)

    // When marking as 'paid', also mark any carryover (unpaid) months as paid.
    // Scan obligationMonths directly to avoid stale closure issues with carryoverMap/getMonthRecord.
    const carryoverMonthsToPay: Array<{ y: number; m: number; oId: string }> = []
    const collectCarryover = (oId: string): void => {
      const obligation = obligations.find(o => o.id === oId)
      if (obligation && obligation.frequency !== 'yearly' && obligation.frequency !== 'once') {
        const createdDate = new Date(obligation.createdAt)
        const cYear = createdDate.getFullYear()
        const cMonth = createdDate.getMonth() + 1
        const MAX_CARRY = 3
        let cy = year
        let cm = month - 1
        if (cm === 0) { cm = 12; cy-- }
        for (let i = 0; i < MAX_CARRY; i++) {
          if (cy < cYear || (cy === cYear && cm < cMonth)) break
          const rec = obligationMonths.find(
            r => r.obligationId === oId && r.year === cy && r.month === cm
          )
          if (rec?.status !== 'unpaid') break
          carryoverMonthsToPay.push({ y: cy, m: cm, oId })
          cm--
          if (cm === 0) { cm = 12; cy-- }
        }
      }
    }
    // Для isCarriedOver-записей НЕ запускаем auto-resolve предыдущих месяцев:
    // пользователь перенёс долг явно — март должен оставаться 'unpaid'.
    if (status === 'paid' && !currentRecord?.isCarriedOver) {
      collectCarryover(obligationId)
    }

    // Linked children: propagate status to all children of this obligation
    const childObligations = obligations.filter(o => o.parentId === obligationId)
    for (const child of childObligations) {
      const childRecord = getMonthRecord(child.id, year, month)
      await onStatusChange(child.id, year, month, status, undefined, true)
      if (status === 'paid' && !childRecord?.isCarriedOver) {
        collectCarryover(child.id)
      }
    }

    for (const { y, m, oId } of carryoverMonthsToPay) {
      await onStatusChange(oId, y, m, 'paid', undefined, true)
    }

    // After change, push undo with correct before/after
    if (pushUndo) {
      const afterRecord = {
        obligationId,
        year,
        month,
        status,
        actualAmount: currentRecord?.actualAmount ?? null,
        matchedTransactionId: currentRecord?.matchedTransactionId,
        paidDate: status === 'paid' ? formatLocalDate(new Date()) : undefined
      }
      let afterMonths = obligationMonths.filter(
        m => !(m.obligationId === obligationId && m.year === year && m.month === month)
      ).concat(afterRecord)
      // Include child records in undo
      for (const child of childObligations) {
        afterMonths = afterMonths.filter(
          r => !(r.obligationId === child.id && r.year === year && r.month === month)
        ).concat({
          obligationId: child.id,
          year,
          month,
          status,
          actualAmount: null,
          paidDate: status === 'paid' ? formatLocalDate(new Date()) : undefined
        })
      }
      // Also include carryover months in undo state
      for (const { y, m, oId } of carryoverMonthsToPay) {
        afterMonths = afterMonths.filter(
          r => !(r.obligationId === oId && r.year === y && r.month === m)
        ).concat({
          obligationId: oId,
          year: y,
          month: m,
          status: 'paid',
          actualAmount: null,
          paidDate: formatLocalDate(new Date())
        })
      }
      const afterState = { obligationMonths: afterMonths }
      pushUndo('Изменение статуса обязательства', beforeState, afterState)
    }

  }

  const handleCopyToMonth = async (obligation: Obligation, targetYear: number, targetMonth: number): Promise<void> => {
    const { id: _id, createdAt: _createdAt, ...rest } = obligation
    const targetCreatedAt = new Date(targetYear, targetMonth - 1, 1).toISOString()
    const beforeObligations = [...obligations]
    const newObligation = await onAdd(rest, targetCreatedAt)
    if (pushUndo) {
      pushUndo('Копирование обязательства',
        { obligations: beforeObligations },
        { obligations: [...beforeObligations, newObligation] }
      )
    }
  }

  const handlePrevMonth = () => {
    if (month === 1) {
      setNavMonth(12)
      setNavYear(year - 1)
    } else {
      setNavMonth(month - 1)
    }
  }

  const handleNextMonth = () => {
    if (canGoNext) {
      if (month === 12) {
        setNavMonth(1)
        setNavYear(year + 1)
      } else {
        setNavMonth(month + 1)
      }
    }
  }

  const resetFilters = () => {
    setSearchQuery('')
    setFilterStatus('all')
    setFilterType('all')
    setSortBy('name')
  }

  // Drag-and-drop between monthly/yearly/custom sections
  const [dragOverSection, setDragOverSection] = useState<string | null>(null)

  // ── Drag auto-scroll via requestAnimationFrame ────────────────
  const dragYRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  // useRef для рекурсивного RAF без circular deps в useCallback
  const scrollLoopRef = useRef<() => void>(() => {})
  scrollLoopRef.current = () => {
    const y = dragYRef.current
    if (y === null) return
    const ZONE = 120
    const MAX_SPEED = 14
    const h = window.innerHeight
    if (y < ZONE) {
      const t = 1 - y / ZONE
      window.scrollBy({ top: -Math.round(MAX_SPEED * t * t), behavior: 'instant' as ScrollBehavior })
    } else if (y > h - ZONE) {
      const t = 1 - (h - y) / ZONE
      window.scrollBy({ top: Math.round(MAX_SPEED * t * t), behavior: 'instant' as ScrollBehavior })
    }
    rafRef.current = requestAnimationFrame(scrollLoopRef.current)
  }

  const handleDragStart = useCallback((e: React.DragEvent, obligationId: string) => {
    e.dataTransfer.setData('text/plain', obligationId)
    e.dataTransfer.effectAllowed = 'all'
    dragYRef.current = e.clientY
    document.body.style.setProperty('cursor', 'grabbing', 'important')
    rafRef.current = requestAnimationFrame(scrollLoopRef.current)
  }, [])

  const handleDrag = useCallback((e: React.DragEvent) => {
    if (e.clientY !== 0) dragYRef.current = e.clientY
  }, [])

  const handleDragEnd = useCallback(() => {
    dragYRef.current = null
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    document.body.style.cursor = ''
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, section: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverSection(section)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOverSection(null)
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent, targetSection: string) => {
    e.preventDefault()
    setDragOverSection(null)
    const obligationId = e.dataTransfer.getData('text/plain')
    const obligation = obligations.find(o => o.id === obligationId)
    if (!obligation) return

    let patch: Partial<Obligation> | null = null
    if (targetSection === 'monthly') {
      if ((obligation.frequency ?? 'monthly') === 'monthly' && !obligation.sectionId && !obligation.parentId) return
      patch = { frequency: 'monthly', sectionId: undefined, parentId: undefined }
    } else if (targetSection === 'yearly') {
      if (obligation.frequency === 'yearly' && !obligation.sectionId && !obligation.parentId) return
      patch = { frequency: 'yearly', sectionId: undefined, parentId: undefined }
    } else if (targetSection === 'once') {
      if (obligation.frequency === 'once' && !obligation.sectionId && !obligation.parentId) return
      patch = { frequency: 'once', sectionId: undefined, parentId: undefined }
    } else {
      // Custom section
      if (obligation.sectionId === targetSection && !obligation.parentId) return
      patch = { sectionId: targetSection, parentId: undefined }
    }
    if (!patch) return

    // Drag-drop теперь undoable (BUG-019): раньше onUpdate не писал undo → после undo/redo
    // frequency/sectionId рассинхронизировались и обязательство «терялось».
    const beforeObligations = [...obligations]
    await onUpdate(obligationId, patch)
    if (pushUndo) {
      pushUndo('Перемещение обязательства',
        { obligations: beforeObligations },
        { obligations: beforeObligations.map(o => (o.id === obligationId ? { ...o, ...patch } : o)) }
      )
    }
  }, [obligations, onUpdate, pushUndo])

  const handleAddSection = useCallback(async () => {
    const name = newSectionName.trim()
    if (!name) return
    await onAddSection(name)
    setNewSectionName('')
    setShowAddSection(false)
  }, [newSectionName, onAddSection])

  const handleRenameSection = useCallback(async (id: string) => {
    const name = renamingSectionName.trim()
    if (!name) return
    await onRenameSection(id, name)
    setRenamingSectionId(null)
    setRenamingSectionName('')
  }, [renamingSectionName, onRenameSection])

  // ── Linked obligations: drag-drop onto a card to link as child ────
  const [linkDropTarget, setLinkDropTarget] = useState<string | null>(null)
  const [childAreaDropTarget, setChildAreaDropTarget] = useState<string | null>(null)

  const handleChildAreaDragOver = useCallback((e: React.DragEvent, parentId: string) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'link'
    setChildAreaDropTarget(parentId)
  }, [])

  const handleChildAreaDragLeave = useCallback((e: React.DragEvent) => {
    e.stopPropagation()
    setChildAreaDropTarget(null)
  }, [])

  const handleChildAreaDrop = useCallback(async (e: React.DragEvent, parentId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setChildAreaDropTarget(null)
    const draggedId = e.dataTransfer.getData('text/plain')
    if (!draggedId || draggedId === parentId) return
    const dragged = obligations.find(o => o.id === draggedId)
    const target = obligations.find(o => o.id === parentId)
    if (!dragged || !target || target.parentId) return
    if (obligations.some(o => o.parentId === draggedId)) return // не разрешаем перемещать родителя
    if (dragged.parentId === parentId) return // уже дочерний
    await onUpdate(draggedId, { parentId })
  }, [obligations, onUpdate])

  const handleCardDragOver = useCallback((e: React.DragEvent, targetObligationId: string) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'link'
    setLinkDropTarget(targetObligationId)
  }, [])

  const handleCardDragLeave = useCallback((e: React.DragEvent) => {
    e.stopPropagation()
    setLinkDropTarget(null)
  }, [])

  const handleCardDrop = useCallback(async (e: React.DragEvent, targetObligationId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setLinkDropTarget(null)
    const draggedId = e.dataTransfer.getData('text/plain')
    if (!draggedId || draggedId === targetObligationId) return

    const dragged = obligations.find(o => o.id === draggedId)
    const target = obligations.find(o => o.id === targetObligationId)
    if (!dragged || !target) return

    // Don't allow linking to self, or linking a parent that already has children
    // Don't allow circular: target cannot be a child itself
    if (target.parentId) return
    // Don't allow if dragged is already a parent with children
    const draggedHasChildren = obligations.some(o => o.parentId === draggedId)
    if (draggedHasChildren) return

    await onUpdate(draggedId, { parentId: targetObligationId })
  }, [obligations, onUpdate])

  const handleUnlink = useCallback(async (obligationId: string) => {
    await onUpdate(obligationId, { parentId: undefined })
  }, [onUpdate])

  // Build parent→children map
  const childrenMap = useMemo(() => {
    const map = new Map<string, Obligation[]>()
    for (const o of obligations) {
      if (o.parentId && o.isActive) {
        const list = map.get(o.parentId) ?? []
        list.push(o)
        map.set(o.parentId, list)
      }
    }
    return map
  }, [obligations])

  const toggleSectionCollapse = useCallback((sectionId: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }, [])

  // ── Handlers для частичной оплаты перенесённого долга ────
  const handlePayCarried = useCallback(async (obligationId: string) => {
    await onSetCarriedPaid(obligationId, year, month, true)
  }, [onSetCarriedPaid, year, month])

  const handleReturnCarried = useCallback(async (obligationId: string) => {
    await onReturnCarried(obligationId, year, month)
  }, [onReturnCarried, year, month])

  const handlePayAll = useCallback(async (obligationId: string) => {
    await onStatusChange(obligationId, year, month, 'paid')
    await onSetCarriedPaid(obligationId, year, month, true)
  }, [onStatusChange, onSetCarriedPaid, year, month])

  // ── Render obligation card with linked children ────
  const renderObligationWithChildren = useCallback((o: Obligation) => {
    const children = childrenMap.get(o.id) ?? []
    const isParent = children.length > 0

    // Кнопка переноса долга: доступна ЛЮБОМУ типу (баг №1/№2). Целевой месяц выбирается
    // в пикере на карточке. Once/yearly теперь корректно отображаются в целевом месяце —
    // они добавлены в `active` через carriedInIds, а «текущий» платёж месяца им не
    // начисляется (гейт isNativeActive). Отменяет ограничение monthly из BUG-022 п.4.
    const getCarryHandler = (ob: Obligation): ((toY: number, toM: number) => void) | undefined => {
      if (carryDestMap.has(ob.id)) return undefined // уже перенесено ИЗ этого месяца
      return (toY, toM) => { void onCarryDebt(ob.id, year, month, toY, toM) }
    }

    const carryDest = carryDestMap.get(o.id)

    return (
      <div key={o.id}>
        <div
          draggable
          onDragStart={(e) => handleDragStart(e, o.id)}
          onDrag={handleDrag}
          onDragEnd={handleDragEnd}
          onDragOver={(e) => handleCardDragOver(e, o.id)}
          onDragLeave={handleCardDragLeave}
          onDrop={(e) => handleCardDrop(e, o.id)}
          className={`cursor-grab active:cursor-grabbing transition-all ${
            linkDropTarget === o.id ? 'ring-2 ring-blue-500 rounded-xl' : ''
          }`}
        >
          <ObligationCard
            obligation={o}
            currentMonthRecord={getMonthRecord(o.id, year, month)}
            carriedFrom={carryoverMap.get(o.id)}
            yearlyPaidUntil={yearlyPaidUntilMap.get(o.id)}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onStatusChange={handleStatusToggle}
            onCopy={handleCopyToMonth}
            isParent={isParent}
            childCount={children.length}
            klarnaPaidCount={klarnaPaidCountMap.get(o.id)}
            onCarryDebt={getCarryHandler(o)}
            carriedToYear={carryDest?.toYear}
            carriedToMonth={carryDest?.toMonth}
            onPayCarried={() => { void handlePayCarried(o.id) }}
            onPayAll={() => { void handlePayAll(o.id) }}
            onReturnCarried={() => { void handleReturnCarried(o.id) }}
            effectiveAmt={effectiveAmount(o, year, month)}
            navYear={year}
            navMonth={month}
            occursNatively={isNativeActive(o, year, month)}
          />
        </div>
        {children.length > 0 && (
          <div
            className={`ml-6 mt-1 border-l-2 pl-3 pb-1 transition-colors ${
              childAreaDropTarget === o.id ? 'border-blue-500/60' : 'border-blue-800/40'
            }`}
            onDragOver={(e) => handleChildAreaDragOver(e, o.id)}
            onDragLeave={handleChildAreaDragLeave}
            onDrop={(e) => { void handleChildAreaDrop(e, o.id) }}
          >
            <div className="space-y-1">
              {children.map((child) => {
                const childCarryDest = carryDestMap.get(child.id)
                return (
                  <div
                    key={child.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, child.id)}
                    onDrag={handleDrag}
                    onDragEnd={handleDragEnd}
                    className="cursor-grab active:cursor-grabbing"
                  >
                    <ObligationCard
                      obligation={child}
                      currentMonthRecord={getMonthRecord(child.id, year, month)}
                      carriedFrom={carryoverMap.get(child.id)}
                      yearlyPaidUntil={yearlyPaidUntilMap.get(child.id)}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                      onStatusChange={handleStatusToggle}
                      onCopy={handleCopyToMonth}
                      isChild
                      parentName={o.name}
                      onUnlink={handleUnlink}
                      klarnaPaidCount={klarnaPaidCountMap.get(child.id)}
                      onCarryDebt={getCarryHandler(child)}
                      carriedToYear={childCarryDest?.toYear}
                      carriedToMonth={childCarryDest?.toMonth}
                      onPayCarried={() => { void handlePayCarried(child.id) }}
                      onPayAll={() => { void handlePayAll(child.id) }}
                      onReturnCarried={() => { void handleReturnCarried(child.id) }}
                      effectiveAmt={effectiveAmount(child, year, month)}
                      navYear={year}
                      navMonth={month}
                      occursNatively={isNativeActive(child, year, month)}
                    />
                  </div>
                )
              })}
            </div>
            <div className={`mt-1 rounded border-dashed border px-3 py-1 text-xs text-center transition-all select-none ${
              childAreaDropTarget === o.id
                ? 'border-blue-500/60 text-blue-400/80 bg-blue-950/20'
                : 'border-neutral-800/60 text-neutral-700'
            }`}>
              + перетащите сюда, чтобы добавить в группу
            </div>
          </div>
        )}
      </div>
    )
  }, [childrenMap, linkDropTarget, childAreaDropTarget, handleDragStart, handleDrag, handleDragEnd, handleCardDragOver, handleCardDragLeave, handleCardDrop, handleChildAreaDragOver, handleChildAreaDragLeave, handleChildAreaDrop, getMonthRecord, year, month, carryoverMap, carryDestMap, yearlyPaidUntilMap, handleEdit, handleDelete, handleStatusToggle, handleCopyToMonth, handleUnlink, klarnaPaidCountMap, onCarryDebt, handlePayCarried, handlePayAll, handleReturnCarried, isNativeActive])

  const handleExportMD = useCallback(async () => {
    const fmtEur = (n: number): string => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
    const statusLabel = (s: ObligationStatus): string =>
      ({ paid: 'Оплачено', unpaid: 'Не оплачено', unknown: 'Неизвестно', skipped: 'Пропущено' }[s] ?? 'Неизвестно')
    const freqLabel = (f?: ObligationFrequency): string =>
      f === 'yearly' ? 'Ежегодный' : f === 'once' ? 'Единоразовый' : 'Ежемесячный'

    const GEN_MONTHS = ['', 'января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
    const NOM_MONTHS = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

    // Export uses ALL active obligations, ignoring current filter/search state
    const allSorted = [...active].sort((a, b) => a.name.localeCompare(b.name))

    // Строки одного обязательства: основная (если нативно в этом месяце) + отдельная строка
    // перенесённого СЮДА долга (баг №4) + рекурсивно дети под родителем (баг №4: Spotify).
    const rowsFor = (o: Obligation, isChildRow: boolean): string[] => {
      const out: string[] = []
      const rec = getMonthRecord(o.id, year, month)
      const nativeHere = isNativeActive(o, year, month)
      const transferredOut = carryDestMap.get(o.id)
      const name = ((isChildRow ? '↳ ' : '') + o.name).replace(/\|/g, '\\|')
      const dayStr = o.approximateDay !== null ? `~${o.approximateDay}` : ''
      const notes = (o.notes ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
      if (nativeHere) {
        if (transferredOut) {
          out.push(`| ${name} | ${freqLabel(o.frequency)} | — | ${dayStr} | → перенесён на ${NOM_MONTHS[transferredOut.toMonth] ?? ''} ${transferredOut.toYear} | ${notes} |`)
        } else {
          const st = isYearlyCovered(o)
            ? 'paid'
            : (rec?.status ?? (o.frequency === 'yearly' ? 'unknown' : 'unpaid')) as ObligationStatus
          const ea = effectiveAmount(o, year, month); const amt = ea !== null ? fmtEur(ea) : '—'
          out.push(`| ${name} | ${freqLabel(o.frequency)} | ${amt} | ${dayStr} | ${statusLabel(st)} | ${notes} |`)
        }
      }
      if (rec?.isCarriedOver && rec.carriedAmount != null && !transferredOut) {
        const dSt: ObligationStatus = rec.carriedPaid ? 'paid' : 'unpaid'
        const from = `долг с ${GEN_MONTHS[rec.carriedFromMonth ?? 0] ?? ''} ${rec.carriedFromYear ?? ''}`.trim()
        out.push(`| ${name} (${from}) | ${freqLabel(o.frequency)} | ${fmtEur(rec.carriedAmount)} | | ${statusLabel(dSt)} | перенесён |`)
      }
      for (const child of (childrenMap.get(o.id) ?? [])) out.push(...rowsFor(child, true))
      return out
    }

    const renderGroupMd = (title: string, items: Obligation[]): string => {
      if (items.length === 0) return ''
      const rows = items.flatMap(o => rowsFor(o, false)).join('\n')
      if (!rows) return ''
      return `\n## ${title} (${items.length})\n\n| Название | Период | Сумма | Дата | Статус | Заметки |\n|---|---|---|---|---|---|\n${rows}\n`
    }

    // BUG-019: Klarna (любой frequency) — отдельный раздел, исключён из monthly/yearly/once.
    const klarnaAll = allSorted.filter(o => o.billingChain === 'klarna' && !o.sectionId && !o.parentId)
    const monthlyAll = allSorted.filter(o => (o.frequency ?? 'monthly') === 'monthly' && o.billingChain !== 'klarna' && !o.sectionId && !o.parentId)
    const yearlyAll = allSorted.filter(o => o.frequency === 'yearly' && o.billingChain !== 'klarna' && !o.sectionId && !o.parentId)
    const onceAll = allSorted.filter(o => o.frequency === 'once' && o.billingChain !== 'klarna' && !o.sectionId && !o.parentId)
    const allCustomMd = customSections
      .map(s => renderGroupMd(s.name, allSorted.filter(o => o.sectionId === s.id)))
      .join('')

    // Compute totals from all active (not filtered by UI search/status/type)
    const totalPayable = allSorted.reduce((sum, o) => {
      if (isKlarnaCompleted(o)) return sum
      if (carryDestMap.has(o.id)) return sum
      const rec = getMonthRecord(o.id, year, month)
      if (o.frequency === 'yearly') {
        if (isYearlyCovered(o)) return sum
        if (o.yearlyMonth != null && o.yearlyMonth !== month) return sum
      }
      const base = effectiveAmount(o, year, month) ?? 0
      if (rec?.isCarriedOver) {
        const nativeHere = isNativeActive(o, year, month)
        const cp = rec.carriedPaid ? 0 : (rec.carriedAmount ?? 0)
        const cur = (nativeHere && rec.status !== 'paid') ? base : 0
        const total = cp + cur
        return total > 0 ? sum + total : sum
      }
      if (rec?.status === 'paid') return sum
      if (rec && rec.status === 'unknown') return sum
      if (!rec && o.frequency === 'yearly') return sum
      return sum + base
    }, 0)

    const totalPaidAmt = allSorted.reduce((sum, o) => {
      const rec = getMonthRecord(o.id, year, month)
      const base = effectiveAmount(o, year, month) ?? 0
      if (rec?.isCarriedOver) {
        const nativeHere = isNativeActive(o, year, month)
        return sum + (rec.carriedPaid ? (rec.carriedAmount ?? 0) : 0) + ((nativeHere && rec.status === 'paid') ? base : 0)
      }
      return rec?.status === 'paid' ? sum + base : sum
    }, 0)

    const paidCountAll = allSorted.filter(o => {
      if (isKlarnaCompleted(o)) return false
      const rec = getMonthRecord(o.id, year, month)
      return rec?.status === 'paid'
    }).length

    const pendingCountAll = allSorted.filter(o => {
      if (isKlarnaCompleted(o)) return false
      if (carryDestMap.has(o.id)) return false
      const rec = getMonthRecord(o.id, year, month)
      if (rec?.isCarriedOver) {
        const nativeHere = isNativeActive(o, year, month)
        return !rec.carriedPaid || (nativeHere && rec.status !== 'paid')
      }
      if (o.frequency === 'yearly') {
        if (isYearlyCovered(o)) return false
        if (o.yearlyMonth != null && o.yearlyMonth !== month) return false
      }
      if (rec?.status === 'paid') return false
      if (rec && rec.status === 'unknown') return false
      if (!rec && o.frequency === 'yearly') return false
      return true
    }).length

    const md = [
      `# Обязательства — ${currentMonthLabel}`,
      ``,
      `Сгенерировано: ${new Date().toLocaleString('ru-RU')}`,
      ``,
      `## Итого`,
      ``,
      `| Показатель | Значение |`,
      `|---|---|`,
      `| Итого к оплате | ${fmtEur(totalPayable)} |`,
      `| Оплачено | ${fmtEur(totalPaidAmt)} (${paidCountAll} поз.) |`,
      `| Ожидают оплаты | ${pendingCountAll} |`,
      renderGroupMd('Ежемесячные', monthlyAll),
      renderGroupMd('Klarna', klarnaAll),
      renderGroupMd('Ежегодные', yearlyAll),
      renderGroupMd('Единоразовые', onceAll),
      allCustomMd,
    ].join('\n')

    const _d = new Date()
    const stamp = `${String(_d.getDate()).padStart(2, '0')}.${String(_d.getMonth() + 1).padStart(2, '0')}.${String(_d.getFullYear()).slice(-2)}`
    await window.api.exportMd(md, `maulwurf обязательства ${stamp}.md`)
  }, [
    active, customSections,
    getMonthRecord, year, month, currentMonthLabel,
    carryDestMap, isYearlyCovered, isKlarnaCompleted, childrenMap, isNativeActive,
  ])

  const handleExportPDF = useCallback(async () => {
    const fmtEur = (n: number): string => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
    const statusBadge = (s: ObligationStatus): string => {
      const map = {
        paid: { color: '#16a34a', text: 'Оплачено' },
        unpaid: { color: '#dc2626', text: 'Не оплачено' },
        unknown: { color: '#6b7280', text: 'Неизвестно' },
        skipped: { color: '#6b7280', text: 'Пропущено' },
      } as const
      const { color, text } = map[s] ?? map.unknown
      return `<span style="color:${color};font-weight:600">${text}</span>`
    }
    const freqLabel = (f?: ObligationFrequency): string =>
      f === 'yearly' ? 'Ежегодный' : f === 'once' ? 'Единоразовый' : 'Ежемесячный'

    const GEN_MONTHS = ['', 'января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
    const NOM_MONTHS = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
    const td = 'padding:8px 12px;border-bottom:1px solid #ddd'

    // Export uses ALL active obligations, ignoring current filter/search state
    const allSorted = [...active].sort((a, b) => a.name.localeCompare(b.name))

    // Строки одного обязательства: основная (если нативно) + строка перенесённого СЮДА долга
    // + рекурсивно дети под родителем (баг №4).
    const rowsFor = (o: Obligation, isChildRow: boolean): string[] => {
      const out: string[] = []
      const rec = getMonthRecord(o.id, year, month)
      const nativeHere = isNativeActive(o, year, month)
      const transferredOut = carryDestMap.get(o.id)
      const name = (isChildRow ? '↳ ' : '') + o.name
      const dayStr = o.approximateDay !== null ? `~${o.approximateDay} число` : ''
      if (nativeHere) {
        if (transferredOut) {
          out.push(`<tr>
          <td style="${td}">${name}</td>
          <td style="${td}">${freqLabel(o.frequency)}</td>
          <td style="${td}">—</td>
          <td style="${td}">${dayStr}</td>
          <td style="${td};color:#b45309">→ перенесён на ${NOM_MONTHS[transferredOut.toMonth] ?? ''} ${transferredOut.toYear}</td>
          <td style="${td};color:#666">${o.notes ?? ''}</td>
        </tr>`)
        } else {
          const st = isYearlyCovered(o)
            ? 'paid'
            : (rec?.status ?? (o.frequency === 'yearly' ? 'unknown' : 'unpaid')) as ObligationStatus
          const ea = effectiveAmount(o, year, month); const amt = ea !== null ? fmtEur(ea) : '—'
          out.push(`<tr>
          <td style="${td}">${name}</td>
          <td style="${td}">${freqLabel(o.frequency)}</td>
          <td style="${td}">${amt}</td>
          <td style="${td}">${dayStr}</td>
          <td style="${td}">${statusBadge(st)}</td>
          <td style="${td};color:#666">${o.notes ?? ''}</td>
        </tr>`)
        }
      }
      if (rec?.isCarriedOver && rec.carriedAmount != null && !transferredOut) {
        const dSt: ObligationStatus = rec.carriedPaid ? 'paid' : 'unpaid'
        const from = `долг с ${GEN_MONTHS[rec.carriedFromMonth ?? 0] ?? ''} ${rec.carriedFromYear ?? ''}`.trim()
        out.push(`<tr>
          <td style="${td};color:#b45309">${name} <span style="font-size:11px">(${from})</span></td>
          <td style="${td}">${freqLabel(o.frequency)}</td>
          <td style="${td}">${fmtEur(rec.carriedAmount)}</td>
          <td style="${td}"></td>
          <td style="${td}">${statusBadge(dSt)}</td>
          <td style="${td};color:#666">перенесён</td>
        </tr>`)
      }
      for (const child of (childrenMap.get(o.id) ?? [])) out.push(...rowsFor(child, true))
      return out
    }

    const renderGroup = (title: string, items: Obligation[]): string => {
      if (items.length === 0) return ''
      const rows = items.flatMap(o => rowsFor(o, false)).join('')
      return `<h2 style="margin:24px 0 8px;color:#111">${title} <span style="color:#666;font-size:14px">(${items.length})</span></h2>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="text-align:left;color:#666;border-bottom:2px solid #bbb">
            <th style="padding:8px 12px">Название</th>
            <th style="padding:8px 12px">Период</th>
            <th style="padding:8px 12px">Сумма</th>
            <th style="padding:8px 12px">Дата</th>
            <th style="padding:8px 12px">Статус</th>
            <th style="padding:8px 12px">Заметки</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`
    }

    // BUG-019: Klarna (любой frequency) — отдельный раздел, исключён из monthly/yearly/once.
    const klarnaAll = allSorted.filter(o => o.billingChain === 'klarna' && !o.sectionId && !o.parentId)
    const monthlyAll = allSorted.filter(o => (o.frequency ?? 'monthly') === 'monthly' && o.billingChain !== 'klarna' && !o.sectionId && !o.parentId)
    const yearlyAll = allSorted.filter(o => o.frequency === 'yearly' && o.billingChain !== 'klarna' && !o.sectionId && !o.parentId)
    const onceAll = allSorted.filter(o => o.frequency === 'once' && o.billingChain !== 'klarna' && !o.sectionId && !o.parentId)
    const allCustom = customSections.map(s => renderGroup(s.name, allSorted.filter(o => o.sectionId === s.id))).join('')

    // Compute totals from all active (not filtered by UI search/status/type)
    const totalPayable = allSorted.reduce((sum, o) => {
      if (isKlarnaCompleted(o)) return sum
      if (carryDestMap.has(o.id)) return sum
      const rec = getMonthRecord(o.id, year, month)
      if (o.frequency === 'yearly') {
        if (isYearlyCovered(o)) return sum
        if (o.yearlyMonth != null && o.yearlyMonth !== month) return sum
      }
      const base = effectiveAmount(o, year, month) ?? 0
      if (rec?.isCarriedOver) {
        const nativeHere = isNativeActive(o, year, month)
        const cp = rec.carriedPaid ? 0 : (rec.carriedAmount ?? 0)
        const cur = (nativeHere && rec.status !== 'paid') ? base : 0
        const total = cp + cur
        return total > 0 ? sum + total : sum
      }
      if (rec?.status === 'paid') return sum
      if (rec && rec.status === 'unknown') return sum
      if (!rec && o.frequency === 'yearly') return sum
      return sum + base
    }, 0)

    const totalPaidAmt = allSorted.reduce((sum, o) => {
      const rec = getMonthRecord(o.id, year, month)
      const base = effectiveAmount(o, year, month) ?? 0
      if (rec?.isCarriedOver) {
        const nativeHere = isNativeActive(o, year, month)
        return sum + (rec.carriedPaid ? (rec.carriedAmount ?? 0) : 0) + ((nativeHere && rec.status === 'paid') ? base : 0)
      }
      return rec?.status === 'paid' ? sum + base : sum
    }, 0)

    const paidCountAll = allSorted.filter(o => {
      if (isKlarnaCompleted(o)) return false
      const rec = getMonthRecord(o.id, year, month)
      return rec?.status === 'paid'
    }).length

    const pendingCountAll = allSorted.filter(o => {
      if (isKlarnaCompleted(o)) return false
      if (carryDestMap.has(o.id)) return false
      const rec = getMonthRecord(o.id, year, month)
      if (rec?.isCarriedOver) {
        const nativeHere = isNativeActive(o, year, month)
        return !rec.carriedPaid || (nativeHere && rec.status !== 'paid')
      }
      if (o.frequency === 'yearly') {
        if (isYearlyCovered(o)) return false
        if (o.yearlyMonth != null && o.yearlyMonth !== month) return false
      }
      if (rec?.status === 'paid') return false
      if (rec && rec.status === 'unknown') return false
      if (!rec && o.frequency === 'yearly') return false
      return true
    }).length

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Обязательства — ${currentMonthLabel}</title>
  <style>
    body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; background: #fff; color: #111; padding: 32px; max-width: 900px; margin: 0 auto; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    .meta { color: #666; font-size: 13px; margin-bottom: 24px; }
    .stats { display: flex; gap: 16px; margin-bottom: 24px; }
    .stat { flex: 1; background: #f5f5f5; border: 1px solid #ddd; border-radius: 12px; padding: 16px; }
    .stat-label { font-size: 11px; color: #666; text-transform: uppercase; }
    .stat-value { font-size: 22px; font-weight: 700; margin-top: 4px; }
    table { color: #222; }
    h2 { color: #111; }
  </style>
</head>
<body>
  <h1>Обязательства — ${currentMonthLabel}</h1>
  <p class="meta">Сгенерировано: ${new Date().toLocaleString('ru-RU')}</p>
  <div class="stats">
    <div class="stat">
      <div class="stat-label">Итого к оплате</div>
      <div class="stat-value">${fmtEur(totalPayable)}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Оплачено</div>
      <div class="stat-value" style="color:#16a34a">${fmtEur(totalPaidAmt)}</div>
      <div style="font-size:12px;color:#666;margin-top:4px">${paidCountAll} ${paidCountAll === 1 ? 'позиция' : 'позиций'}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Ожидают оплаты</div>
      <div class="stat-value" style="color:${pendingCountAll > 0 ? '#dc2626' : '#16a34a'}">${pendingCountAll}</div>
    </div>
  </div>
  ${renderGroup('Ежемесячные', monthlyAll)}
  ${renderGroup('Klarna', klarnaAll)}
  ${renderGroup('Ежегодные', yearlyAll)}
  ${renderGroup('Единоразовые', onceAll)}
  ${allCustom}
</body>
</html>`

    const _d = new Date()
    const stamp = `${String(_d.getDate()).padStart(2, '0')}.${String(_d.getMonth() + 1).padStart(2, '0')}.${String(_d.getFullYear()).slice(-2)}`
    await window.api.exportPdf(html, `maulwurf обязательства ${stamp}.pdf`)
  }, [active, customSections, getMonthRecord, year, month, currentMonthLabel, carryDestMap, isYearlyCovered, isKlarnaCompleted, childrenMap, isNativeActive])

  return (
    <div className="space-y-6">
      {/* Header with navigation and undo/redo */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-semibold text-neutral-200">Обязательства</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrevMonth}
              disabled={!canGoPrev}
              className="p-1 rounded hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="text-sm font-medium text-neutral-300 min-w-32 text-center capitalize">
              {currentMonthLabel}
            </span>
            <button
              onClick={handleNextMonth}
              disabled={!canGoNext}
              className="p-1 rounded hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
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
          <button
            onClick={handleExportMD}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-neutral-800 text-neutral-400 hover:text-neutral-200"
            title="Скачать MD"
          >
            <Download className="h-4 w-4" />
            MD
          </button>
          <button
            onClick={handleExportPDF}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-neutral-800 text-neutral-400 hover:text-neutral-200"
            title="Скачать PDF"
          >
            <Download className="h-4 w-4" />
            PDF
          </button>
        </div>
      </div>

      {/* Search and filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск..."
            className="w-full rounded border border-neutral-700 bg-neutral-800 pl-8 pr-8 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {(['all', 'paid', 'unpaid', 'unknown'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                filterStatus === s
                  ? 'bg-neutral-700 text-neutral-200'
                  : 'bg-neutral-800 text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {s === 'all' ? 'Все' : s === 'paid' ? 'Оплачено' : s === 'unpaid' ? 'Не оплачено' : 'Неизвестно'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {(['all', 'monthly', 'yearly', 'once'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                filterType === t
                  ? 'bg-neutral-700 text-neutral-200'
                  : 'bg-neutral-800 text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {t === 'all' ? 'Все' : t === 'monthly' ? 'Ежемесячные' : t === 'yearly' ? 'Ежегодные' : 'Единоразовые'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <ArrowUpDown className="h-4 w-4 text-neutral-500" />
          {(['name', 'amount', 'date'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                sortBy === s
                  ? 'bg-neutral-700 text-neutral-200'
                  : 'bg-neutral-800 text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {s === 'name' ? 'Название' : s === 'amount' ? 'Сумма' : 'Дата'}
            </button>
          ))}
        </div>
        {(searchQuery || filterStatus !== 'all' || filterType !== 'all' || sortBy !== 'name') && (
          <button
            onClick={resetFilters}
            className="text-xs text-neutral-400 hover:text-neutral-200 underline"
          >
            Сбросить
          </button>
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
          <p className="text-xs text-neutral-400">Осталось оплатить в {currentMonthLabel}</p>
          <p className="mt-1 text-2xl font-bold text-neutral-100">
            {totalMonthlyFiltered.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
            <span className="text-xs font-normal text-neutral-500 ml-1">
              (из {filtered.length})
            </span>
          </p>
          {carryoverFiltered.total > 0 && (
            <p className="text-xs text-amber-400 mt-1">
              вкл. долг: {carryoverFiltered.total.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })} ({carryoverFiltered.count} поз.)
            </p>
          )}
          {totalPaidFiltered > 0 && (
            <div className="mt-2 border-t border-neutral-800 pt-2">
              <p className="text-xs text-neutral-400">Оплачено в {currentMonthLabel}</p>
              <p className="mt-0.5 text-lg font-semibold text-green-400">
                {totalPaidFiltered.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
              </p>
            </div>
          )}
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
          <p className="text-xs text-neutral-400">Оплачено в этом месяце</p>
          <p className="mt-1 text-2xl font-bold text-green-400">{paidCount}</p>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
          <p className="text-xs text-neutral-400">Ожидают оплаты</p>
          <p
            className={`mt-1 text-2xl font-bold ${pendingCount > 0 ? 'text-red-400' : 'text-green-400'}`}
          >
            {pendingCount}
          </p>
        </div>
      </div>

      {/* Due warning banner */}
      {dueWarnings.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 rounded-xl bg-orange-950/40 px-4 py-3 text-sm text-orange-300"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {dueWarnings.length} {dueWarnings.length === 1 ? 'платёж' : 'платежей'} в ближайшие
            5 дней:{' '}
            <span className="font-medium text-orange-200">
              {dueWarnings.map((o) => o.name).join(', ')}
            </span>
          </span>
        </motion.div>
      )}

      {/* Grouped sections */}
      <div className="space-y-4">
        {/* Monthly obligations */}
        <div
          className={`rounded-xl border bg-neutral-900/30 transition-colors ${
            dragOverSection === 'monthly' ? 'border-blue-600 bg-blue-950/10' : 'border-neutral-800'
          }`}
          onDragOver={(e) => handleDragOver(e, 'monthly')}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, 'monthly')}
        >
          <div
            className="flex items-center justify-between px-4 py-3 cursor-pointer"
            onClick={() => setCollapsedMonthly(!collapsedMonthly)}
          >
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-neutral-300">Ежемесячные</h3>
              <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
                {monthlyObligations.length}
              </span>
              <span className="text-xs text-neutral-500">
                {monthlyObligations.reduce((s, o) => s + (effectiveAmount(o, year, month) ?? 0), 0).toFixed(2)}€
              </span>
            </div>
            <ChevronDown className={`h-4 w-4 text-neutral-500 transition-transform ${collapsedMonthly ? '-rotate-90' : ''}`} />
          </div>
          <AnimatePresence>
            {!collapsedMonthly && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="p-4 pt-0 space-y-2">
                  {regularMonthly.length === 0 && klarnaMonthly.length === 0 ? (
                    <p className="text-sm text-neutral-500">Нет ежемесячных обязательств</p>
                  ) : (
                    <>
                      {regularMonthlyUnpaid.map((o) => renderObligationWithChildren(o))}

                      {/* Klarna Ratenzahlung subgroup */}
                      {(
                        <div className="rounded-lg border border-pink-800/40 bg-pink-950/10 overflow-hidden">
                          <div
                            className="flex items-center justify-between px-3 py-2"
                          >
                            <div
                              className="flex items-center gap-2 flex-1 cursor-pointer"
                              onClick={() => setCollapsedKlarna(!collapsedKlarna)}
                            >
                              <span className="text-xs font-medium text-pink-300">Klarna Ratenzahlung</span>
                              <span className="rounded-full bg-pink-900/40 px-1.5 py-0.5 text-[10px] text-pink-400">
                                {klarnaMonthly.length}
                              </span>
                              <span className="text-xs text-pink-400/60">
                                {klarnaMonthly.filter(o => !isKlarnaCompleted(o) && isNativeActive(o, year, month)).reduce((s, o) => s + (effectiveAmount(o, year, month) ?? 0), 0).toFixed(2)}€/мес
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={(e) => { e.stopPropagation(); setKlarnaAddOpen(true) }}
                                className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-pink-400/70 hover:bg-pink-900/30 hover:text-pink-300 transition-colors"
                                title="Добавить рассрочку"
                              >
                                <Plus className="h-3 w-3" />
                                Добавить
                              </button>
                              <ChevronDown
                                className={`h-3.5 w-3.5 text-pink-400/60 transition-transform cursor-pointer ${collapsedKlarna ? '-rotate-90' : ''}`}
                                onClick={() => setCollapsedKlarna(!collapsedKlarna)}
                              />
                            </div>
                          </div>
                          <AnimatePresence>
                            {!collapsedKlarna && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden"
                              >
                                <div className="px-3 pb-3 space-y-2">
                                  {klarnaMonthly.length === 0 && (
                                    <p className="text-xs text-pink-400/40 py-1">Нет активных рассрочек</p>
                                  )}
                                  {klarnaMonthly.map((o) => renderObligationWithChildren(o))}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )}

                      {/* Paid regular obligations at the bottom */}
                      {regularMonthlyPaid.map((o) => renderObligationWithChildren(o))}
                    </>
                  )}
                  <button
                    onClick={() => handleOpenAdd('subscription', 'monthly')}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-700 py-2 text-sm text-neutral-500 transition-colors hover:border-neutral-500 hover:text-neutral-300"
                  >
                    <Plus className="h-4 w-4" />
                    Добавить обязательство
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Yearly obligations */}
        <div
          className={`rounded-xl border bg-neutral-900/30 transition-colors ${
            dragOverSection === 'yearly' ? 'border-blue-600 bg-blue-950/10' : 'border-neutral-800'
          }`}
          onDragOver={(e) => handleDragOver(e, 'yearly')}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, 'yearly')}
        >
          <div
            className="flex items-center justify-between px-4 py-3 cursor-pointer"
            onClick={() => setCollapsedYearly(!collapsedYearly)}
          >
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-neutral-300">Ежегодные</h3>
              <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
                {yearlyObligations.length}
              </span>
              <span className="text-xs text-neutral-500">
                {yearlyTotal.toFixed(2)}€/год
              </span>
            </div>
            <ChevronDown className={`h-4 w-4 text-neutral-500 transition-transform ${collapsedYearly ? '-rotate-90' : ''}`} />
          </div>
          <AnimatePresence>
            {!collapsedYearly && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="p-4 pt-0 space-y-2">
                  {yearlyObligations.length === 0 ? (
                    <p className="text-sm text-neutral-500">Нет ежегодных обязательств</p>
                  ) : (
                    yearlyObligations.map((o) => renderObligationWithChildren(o))
                  )}
                  <button
                    onClick={() => handleOpenAdd('manual_payment', 'yearly')}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-700 py-2 text-sm text-neutral-500 transition-colors hover:border-neutral-500 hover:text-neutral-300"
                  >
                    <Plus className="h-4 w-4" />
                    Добавить ежегодное
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* One-time obligations */}
        <div
          className={`rounded-xl border bg-neutral-900/30 transition-colors ${
            dragOverSection === 'once' ? 'border-blue-600 bg-blue-950/10' : 'border-neutral-800'
          }`}
          onDragOver={(e) => handleDragOver(e, 'once')}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, 'once')}
        >
          <div
            className="flex items-center justify-between px-4 py-3 cursor-pointer"
            onClick={() => setCollapsedOnce(!collapsedOnce)}
          >
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-neutral-300">Единоразовые</h3>
              <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
                {onceObligations.length}
              </span>
              <span className="text-xs text-neutral-500">
                {onceObligations.reduce((s, o) => s + (isNativeActive(o, year, month) ? (effectiveAmount(o, year, month) ?? 0) : 0), 0).toFixed(2)}€
              </span>
            </div>
            <ChevronDown className={`h-4 w-4 text-neutral-500 transition-transform ${collapsedOnce ? '-rotate-90' : ''}`} />
          </div>
          <AnimatePresence>
            {!collapsedOnce && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="p-4 pt-0 space-y-2">
                  {onceObligations.length === 0 ? (
                    <p className="text-sm text-neutral-500">Нет единоразовых обязательств</p>
                  ) : (
                    onceObligations.map((o) => renderObligationWithChildren(o))
                  )}
                  <button
                    onClick={() => handleOpenAdd('manual_payment', 'once')}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-700 py-2 text-sm text-neutral-500 transition-colors hover:border-neutral-500 hover:text-neutral-300"
                  >
                    <Plus className="h-4 w-4" />
                    Добавить единоразовое
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Custom sections */}
        {customSections.map((section) => {
          const sectionObs = sectionObligations.get(section.id) ?? []
          const sectionTotal = sectionObs.reduce((s, o) => s + (isNativeActive(o, year, month) ? (effectiveAmount(o, year, month) ?? 0) : 0), 0)
          const isCollapsed = collapsedSections.has(section.id)
          const isRenaming = renamingSectionId === section.id

          return (
            <div
              key={section.id}
              className={`rounded-xl border bg-neutral-900/30 transition-colors ${
                dragOverSection === section.id ? 'border-purple-600 bg-purple-950/10' : 'border-neutral-800'
              }`}
              onDragOver={(e) => handleDragOver(e, section.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, section.id)}
            >
              <div className="flex items-center justify-between px-4 py-3">
                <div
                  className="flex flex-1 items-center gap-2 cursor-pointer"
                  onClick={() => toggleSectionCollapse(section.id)}
                >
                  {isRenaming ? (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <input
                        autoFocus
                        value={renamingSectionName}
                        onChange={(e) => setRenamingSectionName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameSection(section.id)
                          if (e.key === 'Escape') { setRenamingSectionId(null); setRenamingSectionName('') }
                        }}
                        className="rounded border border-neutral-600 bg-neutral-800 px-2 py-0.5 text-sm text-neutral-200 focus:border-purple-600 focus:outline-none"
                      />
                      <button
                        onClick={() => handleRenameSection(section.id)}
                        className="p-0.5 text-green-400 hover:text-green-300"
                      >
                        <CheckIcon className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <h3 className="text-sm font-medium text-purple-300">{section.name}</h3>
                      <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
                        {sectionObs.length}
                      </span>
                      <span className="text-xs text-neutral-500">
                        {sectionTotal.toFixed(2)}€
                      </span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { setRenamingSectionId(section.id); setRenamingSectionName(section.name) }}
                    className="p-1 text-neutral-500 hover:text-neutral-300"
                    title="Переименовать"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => onDeleteSection(section.id)}
                    className="p-1 text-neutral-500 hover:text-red-400"
                    title="Удалить раздел"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <ChevronDown className={`h-4 w-4 text-neutral-500 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                </div>
              </div>
              <AnimatePresence>
                {!isCollapsed && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="p-4 pt-0 space-y-2">
                      {sectionObs.length === 0 ? (
                        <p className="text-sm text-neutral-500">Перетащите обязательства сюда</p>
                      ) : (
                        sectionObs.map((o) => renderObligationWithChildren(o))
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}

        {/* Add custom section */}
        {showAddSection ? (
          <div className="flex items-center gap-2 rounded-xl border border-dashed border-purple-700/50 bg-purple-950/10 px-4 py-3">
            <input
              autoFocus
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddSection()
                if (e.key === 'Escape') { setShowAddSection(false); setNewSectionName('') }
              }}
              placeholder="Название раздела..."
              className="flex-1 rounded border border-neutral-600 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-500 focus:border-purple-600 focus:outline-none"
            />
            <button
              onClick={handleAddSection}
              disabled={!newSectionName.trim()}
              className="rounded bg-purple-800 px-3 py-1.5 text-xs text-purple-200 hover:bg-purple-700 disabled:opacity-30"
            >
              Создать
            </button>
            <button
              onClick={() => { setShowAddSection(false); setNewSectionName('') }}
              className="text-neutral-500 hover:text-neutral-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowAddSection(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-700 py-2.5 text-sm text-neutral-500 transition-colors hover:border-purple-600/50 hover:text-purple-300"
          >
            <FolderPlus className="h-4 w-4" />
            Добавить раздел
          </button>
        )}
      </div>

      {/* Klarna Add Modal — paste + manual form combined */}
      {klarnaAddOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setKlarnaAddOpen(false) }}
        >
          <motion.div
            initial={{ scale: 0.95 }} animate={{ scale: 1 }}
            className="w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-900 p-6 shadow-xl max-h-[90vh] overflow-y-auto"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-base font-semibold text-neutral-100">Добавить платёж Klarna</h3>

            {/* Payment type toggle */}
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                onClick={() => setKlarnaPaymentType('installment')}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  klarnaPaymentType === 'installment'
                    ? 'bg-pink-900/60 text-pink-200 ring-1 ring-pink-700/50'
                    : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                Рассрочка
              </button>
              <button
                type="button"
                onClick={() => setKlarnaPaymentType('single')}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  klarnaPaymentType === 'single'
                    ? 'bg-pink-900/60 text-pink-200 ring-1 ring-pink-700/50'
                    : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                Единоразовый платёж
              </button>
            </div>

            <p className="mb-3 text-xs text-neutral-500">
              {klarnaPaymentType === 'installment'
                ? 'Вставь текст из Klarna (магазин, Initiated/Autopay, N of M, карта, €/мес) или заполни вручную.'
                : 'Вставь текст из Klarna (магазин, Initiated/Autopay, карта, сумма €) или заполни вручную.'}
            </p>

            {/* Paste section */}
            <div className="mb-4 rounded-lg border border-pink-900/40 bg-pink-950/10 p-3">
              <div className="mb-2 flex items-center gap-2">
                <label className="shrink-0 text-xs text-neutral-400">Дата выписки:</label>
                <input
                  type="date"
                  value={klarnaGenDate}
                  onChange={(e) => setKlarnaGenDate(e.target.value)}
                  className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-100 focus:border-neutral-500 focus:outline-none"
                />
                <span className="text-[10px] text-neutral-500">относительно неё считается "Initiated/Autopay"</span>
              </div>
              <textarea
                value={klarnaPasteText}
                onChange={(e) => setKlarnaPasteText(e.target.value)}
                rows={5}
                placeholder={klarnaPaymentType === 'installment'
                  ? `DJI Store\nAutopay in 7 days\n5 of 12 (179,00 €)\n•••• 6406\n25,00 €`
                  : `Steam\nInitiated 5 days ago\n•••• 6406\n2,94 €`}
                className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs text-neutral-100 focus:border-neutral-500 focus:outline-none resize-none font-mono"
              />
              {klarnaParseError && <p className="mt-1 text-xs text-red-400">{klarnaParseError}</p>}
              <button
                type="button"
                onClick={() => { const err = parseKlarnaPaste(klarnaPasteText); setKlarnaParseError(err) }}
                disabled={!klarnaPasteText.trim()}
                className="mt-2 rounded-md bg-pink-900/60 px-3 py-1 text-xs font-medium text-pink-200 hover:bg-pink-900 disabled:opacity-40"
              >
                Разобрать текст
              </button>
            </div>

            {/* Manual form */}
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-neutral-400">Магазин</label>
                <input type="text" value={klarnaAddMerchant} onChange={(e) => setKlarnaAddMerchant(e.target.value)}
                  placeholder="Amazon, DJI, Steam..."
                  className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-neutral-400">
                  {klarnaPaymentType === 'single' ? 'Сумма (€)' : 'В месяц (€)'}
                </label>
                <input type="number" value={klarnaAddMonthly} onChange={(e) => setKlarnaAddMonthly(e.target.value)}
                  placeholder={klarnaPaymentType === 'single' ? '2.94' : '25.00'} min={0} step={0.01}
                  className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none" />
              </div>
              {klarnaPaymentType === 'single' ? (
                <div>
                  <label className="mb-1 block text-xs text-neutral-400">Статус</label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setKlarnaAddPaidInst('1')}
                      className={`flex-1 rounded-md px-3 py-2 text-sm ${klarnaAddPaidInst === '1' ? 'bg-green-900/50 text-green-300' : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'}`}>
                      Оплачено
                    </button>
                    <button type="button" onClick={() => setKlarnaAddPaidInst('0')}
                      className={`flex-1 rounded-md px-3 py-2 text-sm ${klarnaAddPaidInst !== '1' ? 'bg-red-900/50 text-red-300' : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'}`}>
                      Не оплачено
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <label className="mb-1 block text-xs text-neutral-400">Изначальный долг (€)</label>
                    <input type="number" value={klarnaAddTotal} onChange={(e) => setKlarnaAddTotal(e.target.value)}
                      placeholder="179.00" min={0} step={0.01}
                      className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-xs text-neutral-400">Всего платежей</label>
                      <input type="number" value={klarnaAddTotalInst} onChange={(e) => setKlarnaAddTotalInst(e.target.value)}
                        placeholder="12" min={1} step={1}
                        className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-neutral-400">Уже оплачено</label>
                      <input type="number" value={klarnaAddPaidInst} onChange={(e) => setKlarnaAddPaidInst(e.target.value)}
                        placeholder="5" min={0} step={1}
                        className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-neutral-400">Следующий платёж</label>
                    <input type="date" value={klarnaAddNextDate} onChange={(e) => setKlarnaAddNextDate(e.target.value)}
                      title="Следующий платёж"
                      className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none" />
                  </div>
                </>
              )}
            </div>
            {klarnaSaveError && (
              <p className="mt-3 text-xs text-red-400">{klarnaSaveError}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => { setKlarnaAddOpen(false); setKlarnaSaveError('') }}
                className="rounded-md px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200">
                Отмена
              </button>
              <button type="button" onClick={handleKlarnaAdd}
                disabled={klarnaAddSaving || !klarnaAddMerchant.trim() || !klarnaAddMonthly || (klarnaPaymentType === 'installment' && (!klarnaAddTotalInst || !klarnaAddNextDate))}
                className="rounded-md bg-pink-900/60 px-4 py-2 text-sm font-medium text-pink-200 hover:bg-pink-900 disabled:opacity-40">
                {klarnaAddSaving ? 'Сохранение...' : 'Добавить'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* Delete confirm dialog */}
      {deleteConfirm && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        >
          <motion.div
            initial={{ scale: 0.95 }}
            animate={{ scale: 1 }}
            className="rounded-xl border border-neutral-800 bg-neutral-900 p-6"
          >
            <p className="mb-1 text-sm font-medium text-neutral-200">Что сделать с обязательством?</p>
            <p className="mb-4 text-xs text-neutral-500">Скрыть — только в этом месяце. Удалить — полностью, начиная с этого месяца.</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="rounded-md px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200"
              >
                Отмена
              </button>
              <button
                onClick={handleSkipMonth}
                className="rounded-md bg-neutral-800 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
              >
                Скрыть в этом месяце
              </button>
              <button
                onClick={confirmDelete}
                className="rounded-md bg-red-900/50 px-4 py-2 text-sm text-red-300 hover:bg-red-900"
              >
                Удалить с этого месяца
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* Add/Edit modal */}
      <AddObligationModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        editObligation={editTarget}
        editEffectiveAmount={editTarget ? effectiveAmount(editTarget, year, month) : undefined}
        preselectedType={preselectedType}
        preselectedFrequency={preselectedFrequency}
        klarnaPaidCount={editTarget ? klarnaPaidCountMap.get(editTarget.id) : undefined}
      />

    </div>
  )
}
