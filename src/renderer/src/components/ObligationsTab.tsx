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
import { clampDayToMonth, formatLocalDate } from '../utils/financialEngine'

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
    status: ObligationStatus
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
}: ObligationsTabProps): React.JSX.Element {
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Obligation | null>(null)
  const [preselectedType, setPreselectedType] = useState<ObligationType>('subscription')
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
    return nextMonth <= new Date(now.getFullYear(), now.getMonth() + 1, 1)
  }, [year, month])

  const active = obligations.filter((o) => {
    if (!o.isActive) return false
    const created = new Date(o.createdAt)
    const createdYear = created.getFullYear()
    const createdMonth = created.getMonth() + 1
    // Don't show obligation in months before it was created
    if (year < createdYear || (year === createdYear && month < createdMonth)) return false
    // Once obligations only appear in the month they were created
    if (o.frequency === 'once') {
      return createdYear === year && createdMonth === month
    }
    return true
  })

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
    const isMonthly = !o.frequency || o.frequency === 'monthly'
    return isMonthly ? 'unpaid' : 'unknown'
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

  const monthlyObligations = sorted.filter((o) => (o.frequency ?? 'monthly') === 'monthly' && !o.sectionId && !o.parentId)
  const regularMonthly = monthlyObligations.filter((o) => o.billingChain !== 'klarna')
  const regularMonthlyUnpaid = regularMonthly.filter((o) => {
    const rec = getMonthRecord(o.id, year, month)
    return rec?.status !== 'paid'
  })
  const regularMonthlyPaid = regularMonthly.filter((o) => {
    const rec = getMonthRecord(o.id, year, month)
    return rec?.status === 'paid'
  })
  const klarnaMonthly = monthlyObligations.filter((o) => o.billingChain === 'klarna')
  const yearlyObligations = sorted.filter((o) => o.frequency === 'yearly' && !o.sectionId && !o.parentId)
  const onceObligations = sorted.filter((o) => o.frequency === 'once' && !o.sectionId && !o.parentId)

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
      // Долг перенесён ИЗ этого месяца → исключаем полностью
      if (carryDestMap.has(o.id)) return sum

      const rec = getMonthRecord(o.id, year, month)

      // Yearly: skip if covered or not due this month
      if (o.frequency === 'yearly') {
        if (isYearlyCovered(o)) return sum
        if (o.yearlyMonth != null && o.yearlyMonth !== month) return sum
      }

      const base = o.amount ?? 0

      // Новая система isCarriedOver: считаем каждую часть отдельно
      if (rec?.isCarriedOver) {
        const carriedPart = rec.carriedPaid ? 0 : (rec.carriedAmount ?? 0)
        const currentPart = rec.status === 'paid' ? 0 : base
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
  }, [filtered, isYearlyCovered, getMonthRecord, year, month, getEffectiveStatus, carryDestMap])

  const totalPaidFiltered = useMemo(() => {
    return filtered.reduce((sum, o) => {
      const rec = getMonthRecord(o.id, year, month)
      const base = o.amount ?? 0

      if (rec?.isCarriedOver) {
        const carriedPart = rec.carriedPaid ? (rec.carriedAmount ?? 0) : 0
        const currentPart = rec.status === 'paid' ? base : 0
        return sum + carriedPart + currentPart
      }

      if (rec?.status === 'paid') return sum + base
      return sum
    }, 0)
  }, [filtered, getMonthRecord, year, month])

  const yearlyTotal = yearlyObligations.reduce((s, o) => s + (o.amount ?? 0), 0)

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
    // Yearly obligations covered by an earlier month's payment count as paid
    if (o.frequency === 'yearly' && isYearlyCovered(o)) return true
    const rec = getMonthRecord(o.id, year, month)
    return rec?.status === 'paid'
  }).length

  const pendingCount = filtered.filter((o) => {
    // Долг перенесён ИЗ этого месяца → больше не "ожидает оплаты" здесь
    if (carryDestMap.has(o.id)) return false
    if (o.frequency === 'yearly') {
      if (isYearlyCovered(o)) return false           // already covered
      if (o.yearlyMonth != null && o.yearlyMonth !== month) return false
    }
    const rec = getMonthRecord(o.id, year, month)
    // Paid → not pending
    if (rec?.status === 'paid') return false
    // Explicitly unknown → excluded
    if (rec && rec.status === 'unknown') return false
    // Monthly obligations default to 'unpaid' even without a record
    const isMonthlyObl = !o.frequency || o.frequency === 'monthly'
    if (!rec && !isMonthlyObl && !carryoverMap.has(o.id)) return false
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

  const handleOpenAdd = (type: ObligationType): void => {
    setEditTarget(null)
    setPreselectedType(type)
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

  const handleSave = async (o: Omit<Obligation, 'id' | 'createdAt'>, klarnaPaidInstallments?: number): Promise<void> => {
    if (editTarget) {
      if (pushUndo) {
        pushUndo('Изменение обязательства',
          { obligations, obligationMonths },
          {
            obligations: obligations.map(ob => ob.id === editTarget.id ? { ...ob, ...o } : ob),
            obligationMonths
          }
        )
      }
      await onUpdate(editTarget.id, o)

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
      const newObligation = await onAdd(o)
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
        const newObligation = await onAdd({
          name: `${merchant} (платёж Klarna ${monthlyAmount.toFixed(2)}€)`,
          type: 'manual_payment',
          amount: monthlyAmount,
          approximateDay: null,
          billingChain: 'klarna',
          source: 'Klarna',
          isActive: safePaid >= 1,
          frequency: 'once',
          totalInstallments: 1,
          originalTotal: monthlyAmount,
        })
        await onStatusChange(
          newObligation.id, todayYear, todayMonth,
          safePaid >= 1 ? 'paid' : 'unpaid'
        )
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

    await onStatusChange(obligationId, year, month, status)

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
      await onStatusChange(child.id, year, month, status)
      if (status === 'paid' && !childRecord?.isCarriedOver) {
        collectCarryover(child.id)
      }
    }

    for (const { y, m, oId } of carryoverMonthsToPay) {
      await onStatusChange(oId, y, m, 'paid')
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

    if (targetSection === 'monthly') {
      if ((obligation.frequency ?? 'monthly') === 'monthly' && !obligation.sectionId && !obligation.parentId) return
      await onUpdate(obligationId, { frequency: 'monthly', sectionId: undefined, parentId: undefined })
    } else if (targetSection === 'yearly') {
      if (obligation.frequency === 'yearly' && !obligation.sectionId && !obligation.parentId) return
      await onUpdate(obligationId, { frequency: 'yearly', sectionId: undefined, parentId: undefined })
    } else if (targetSection === 'once') {
      if (obligation.frequency === 'once' && !obligation.sectionId && !obligation.parentId) return
      await onUpdate(obligationId, { frequency: 'once', sectionId: undefined, parentId: undefined })
    } else {
      // Custom section
      if (obligation.sectionId === targetSection && !obligation.parentId) return
      await onUpdate(obligationId, { sectionId: targetSection, parentId: undefined })
    }
  }, [obligations, onUpdate])

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

  const handlePayAll = useCallback(async (obligationId: string) => {
    await onStatusChange(obligationId, year, month, 'paid')
    await onSetCarriedPaid(obligationId, year, month, true)
  }, [onStatusChange, onSetCarriedPaid, year, month])

  // ── Render obligation card with linked children ────
  const renderObligationWithChildren = useCallback((o: Obligation) => {
    const children = childrenMap.get(o.id) ?? []
    const isParent = children.length > 0

    // Кнопка переноса долга: доступна для всех обязательств (включая yearly/once),
    // если долг ещё не перенесён из этого месяца. Всегда переносит в следующий nav-месяц.
    const getCarryHandler = (ob: Obligation): (() => void) | undefined => {
      if (carryDestMap.has(ob.id)) return undefined // уже перенесено
      const nextY = month === 12 ? year + 1 : year
      const nextM = month === 12 ? 1 : month + 1
      return () => { void onCarryDebt(ob.id, year, month, nextY, nextM) }
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
  }, [childrenMap, linkDropTarget, childAreaDropTarget, handleDragStart, handleDrag, handleDragEnd, handleCardDragOver, handleCardDragLeave, handleCardDrop, handleChildAreaDragOver, handleChildAreaDragLeave, handleChildAreaDrop, getMonthRecord, year, month, carryoverMap, carryDestMap, yearlyPaidUntilMap, handleEdit, handleDelete, handleStatusToggle, handleCopyToMonth, handleUnlink, klarnaPaidCountMap, onCarryDebt, handlePayCarried, handlePayAll])

  const handleExportMD = useCallback(async () => {
    const fmtEur = (n: number): string => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
    const esc = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
    const statusLabel = (s: ObligationStatus): string =>
      ({ paid: '✅ Оплачено', unpaid: '❌ Не оплачено', unknown: '❓ Неизвестно', skipped: '⏭ Пропущено' }[s] ?? '❓ Неизвестно')
    const monthLbl = (y: number, m: number): string =>
      new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
    const MONTHS_RU = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь']

    const lines: string[] = []
    const ln = (...args: string[]) => lines.push(...args)

    ln(`# Обязательства — ${currentMonthLabel}`)
    ln(``)
    ln(`> Сгенерировано: ${new Date().toLocaleString('ru-RU')}`)
    ln(``)
    ln(`---`)
    ln(``)
    ln(`## Сводка`)
    ln(``)
    ln(`| Показатель | Значение |`)
    ln(`|---|---|`)
    ln(`| Итого к оплате | ${fmtEur(totalMonthlyFiltered)} |`)
    ln(`| Оплачено | ${fmtEur(totalPaidFiltered)} (${paidCount} позиций) |`)
    ln(`| Ожидают оплаты | ${pendingCount} |`)
    ln(``)

    // --- Regular monthly subscriptions ---
    if (regularMonthly.length > 0) {
      ln(`---`)
      ln(``)
      ln(`## Ежемесячные подписки (${regularMonthly.length})`)
      ln(``)
      ln(`| Название | Сумма | ~День | Статус | Заметки |`)
      ln(`|---|---|---|---|---|`)
      for (const o of regularMonthly) {
        const rec = getMonthRecord(o.id, year, month)
        const st = (rec?.status ?? 'unpaid') as ObligationStatus
        const amt = o.amount !== null ? fmtEur(o.amount) : '—'
        const day = o.approximateDay !== null ? `${o.approximateDay}` : '—'
        const notes = esc(o.notes ?? '')
        ln(`| ${esc(o.name)} | ${amt} | ${day} | ${statusLabel(st)} | ${notes} |`)
      }
      ln(``)
    }

    // --- Klarna installments ---
    if (klarnaMonthly.length > 0) {
      ln(`---`)
      ln(``)
      ln(`## Klarna — Рассрочки (${klarnaMonthly.length})`)
      ln(``)
      for (const o of klarnaMonthly) {
        const rec = getMonthRecord(o.id, year, month)
        const paidInst = klarnaPaidCountMap.get(o.id) ?? 0
        const totalInst = o.totalInstallments ?? null
        const monthlyAmt = o.amount ?? 0
        const paidAmt = paidInst * monthlyAmt
        const completed = isKlarnaCompleted(o)
        const stRaw: ObligationStatus = completed ? 'paid' : ((rec?.status ?? 'unpaid') as ObligationStatus)

        ln(`### ${esc(o.name)}`)
        ln(``)
        ln(`| Параметр | Значение |`)
        ln(`|---|---|`)
        ln(`| Ежемесячный платёж | ${monthlyAmt > 0 ? fmtEur(monthlyAmt) : '—'} |`)
        if (totalInst != null) {
          const remainInst = Math.max(0, totalInst - paidInst)
          const remainAmt = remainInst * monthlyAmt
          ln(`| Прогресс | ${paidInst} / ${totalInst} платежей |`)
          ln(`| Оплачено суммарно | ${fmtEur(paidAmt)} |`)
          ln(`| Остаток долга | ${fmtEur(remainAmt)} |`)
          if (o.originalTotal != null) {
            ln(`| Изначальный долг | ${fmtEur(o.originalTotal)} |`)
          }
        } else {
          ln(`| Оплачено платежей | ${paidInst} |`)
        }
        ln(`| Статус в ${currentMonthLabel} | ${statusLabel(stRaw)} |`)
        if (o.approximateDay !== null) {
          ln(`| ~День платежа | ${o.approximateDay} число |`)
        }
        if (o.notes) ln(`| Заметки | ${esc(o.notes)} |`)
        ln(``)
      }
    }

    // --- Yearly ---
    if (yearlyObligations.length > 0) {
      ln(`---`)
      ln(``)
      ln(`## Ежегодные (${yearlyObligations.length})`)
      ln(``)
      ln(`| Название | Сумма/год | Месяц платежа | Статус | Покрыто до | Заметки |`)
      ln(`|---|---|---|---|---|---|`)
      for (const o of yearlyObligations) {
        const isYC = isYearlyCovered(o)
        const rec = getMonthRecord(o.id, year, month)
        const st: ObligationStatus = isYC ? 'paid' : ((rec?.status ?? 'unknown') as ObligationStatus)
        const amt = o.amount !== null ? fmtEur(o.amount) : '—'
        const payMonth = o.yearlyMonth != null ? MONTHS_RU[o.yearlyMonth - 1] : '—'
        const paidUntil = yearlyPaidUntilMap.get(o.id)
        const untilStr = paidUntil ? monthLbl(paidUntil.untilYear, paidUntil.untilMonth) : '—'
        const notes = esc(o.notes ?? '')
        ln(`| ${esc(o.name)} | ${amt} | ${payMonth} | ${statusLabel(st)} | ${untilStr} | ${notes} |`)
      }
      ln(``)
    }

    // --- Once ---
    if (onceObligations.length > 0) {
      ln(`---`)
      ln(``)
      ln(`## Единоразовые (${onceObligations.length})`)
      ln(``)
      ln(`| Название | Сумма | Статус | Заметки |`)
      ln(`|---|---|---|---|`)
      for (const o of onceObligations) {
        const rec = getMonthRecord(o.id, year, month)
        const st = (rec?.status ?? 'unknown') as ObligationStatus
        const amt = o.amount !== null ? fmtEur(o.amount) : '—'
        const notes = esc(o.notes ?? '')
        ln(`| ${esc(o.name)} | ${amt} | ${statusLabel(st)} | ${notes} |`)
      }
      ln(``)
    }

    // --- Custom sections ---
    for (const s of customSections) {
      const items = sorted.filter(o => o.sectionId === s.id)
      if (items.length === 0) continue
      ln(`---`)
      ln(``)
      ln(`## ${esc(s.name)} (${items.length})`)
      ln(``)
      ln(`| Название | Сумма | ~День | Статус | Заметки |`)
      ln(`|---|---|---|---|---|`)
      for (const o of items) {
        const rec = getMonthRecord(o.id, year, month)
        const st = (rec?.status ?? ((!o.frequency || o.frequency === 'monthly') ? 'unpaid' : 'unknown')) as ObligationStatus
        const amt = o.amount !== null ? fmtEur(o.amount) : '—'
        const day = o.approximateDay !== null ? `${o.approximateDay}` : '—'
        const notes = esc(o.notes ?? '')
        ln(`| ${esc(o.name)} | ${amt} | ${day} | ${statusLabel(st)} | ${notes} |`)
      }
      ln(``)
    }

    // --- Carry-out: debts moved FROM this month ---
    const carriedOutItems = sorted.filter(o => carryDestMap.has(o.id))
    // --- Carry-in: debts moved TO this month from past months ---
    const carriedInRecords = obligationMonths.filter(
      m => m.isCarriedOver && m.year === year && m.month === month
    )

    if (carriedOutItems.length > 0 || carriedInRecords.length > 0) {
      ln(`---`)
      ln(``)
      ln(`## Перенесённые обязательства`)
      ln(``)

      if (carriedOutItems.length > 0) {
        ln(`### Долги перенесены ИЗ этого месяца (${carriedOutItems.length})`)
        ln(``)
        ln(`| Обязательство | Сумма | Перенесено в |`)
        ln(`|---|---|---|`)
        for (const o of carriedOutItems) {
          const dest = carryDestMap.get(o.id)!
          const amt = o.amount !== null ? fmtEur(o.amount) : '—'
          ln(`| ${esc(o.name)} | ${amt} | ${monthLbl(dest.toYear, dest.toMonth)} |`)
        }
        ln(``)
      }

      if (carriedInRecords.length > 0) {
        ln(`### Долги перенесены В этот месяц (${carriedInRecords.length})`)
        ln(``)
        ln(`| Обязательство | Перенесено из | Сумма долга | Долг оплачен | Статус месяца |`)
        ln(`|---|---|---|---|---|`)
        for (const rec of carriedInRecords) {
          const o = obligations.find(ob => ob.id === rec.obligationId)
          const name = o ? esc(o.name) : rec.obligationId
          const fromStr = (rec.carriedFromYear != null && rec.carriedFromMonth != null)
            ? monthLbl(rec.carriedFromYear, rec.carriedFromMonth) : '—'
          const debtAmt = rec.carriedAmount != null ? fmtEur(rec.carriedAmount) : '—'
          const debtPaid = rec.carriedPaid ? '✅ Да' : '❌ Нет'
          const mainRec = getMonthRecord(rec.obligationId, year, month)
          const mainSt = (mainRec?.status ?? 'unpaid') as ObligationStatus
          ln(`| ${name} | ${fromStr} | ${debtAmt} | ${debtPaid} | ${statusLabel(mainSt)} |`)
        }
        ln(``)
      }
    }

    await window.api.exportMd(lines.join('\n'), `Обязательства_${year}_${String(month).padStart(2, '0')}.md`)
  }, [
    sorted, regularMonthly, klarnaMonthly, monthlyObligations, yearlyObligations, onceObligations,
    customSections, obligations, obligationMonths,
    getMonthRecord, year, month, currentMonthLabel,
    totalMonthlyFiltered, totalPaidFiltered, paidCount, pendingCount,
    carryDestMap, yearlyPaidUntilMap, isYearlyCovered,
    klarnaPaidCountMap, isKlarnaCompleted,
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

    const renderGroup = (title: string, items: Obligation[]): string => {
      if (items.length === 0) return ''
      const rows = items.map(o => {
        const rec = getMonthRecord(o.id, year, month)
        const carry = carryoverMap.get(o.id)
        const isYC = o.frequency === 'yearly' && yearlyPaidUntilMap.has(o.id)
        const st = isYC
          ? 'paid'
          : (rec?.status ?? ((!o.frequency || o.frequency === 'monthly') ? 'unpaid' : 'unknown')) as ObligationStatus
        const amt = o.amount !== null ? fmtEur(o.amount) : '—'
        const carryColor = carry?.resolved ? '#4ade80' : '#d97706'
        const carryStr = carry ? ` <span style="color:${carryColor}">+ долг ${fmtEur(carry.totalDebt)} (${carry.months} мес.)</span>` : ''
        const dayStr = o.approximateDay !== null ? `~${o.approximateDay} число` : ''
        return `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #ddd">${o.name}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #ddd">${freqLabel(o.frequency)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #ddd">${amt}${carryStr}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #ddd">${dayStr}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #ddd">${statusBadge(st)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #ddd;color:#666">${o.notes ?? ''}</td>
        </tr>`
      }).join('')
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

    const allCustom = customSections.map(s => {
      const obs = sorted.filter(o => o.sectionId === s.id)
      return renderGroup(s.name, obs)
    }).join('')

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
      <div class="stat-value">${fmtEur(totalMonthlyFiltered)}</div>
      ${carryoverFiltered.total > 0 ? `<div style="font-size:12px;color:#d97706;margin-top:4px">вкл. долг: ${fmtEur(carryoverFiltered.total)}</div>` : ''}
    </div>
    <div class="stat">
      <div class="stat-label">Оплачено</div>
      <div class="stat-value" style="color:#16a34a">${fmtEur(totalPaidFiltered)}</div>
      <div style="font-size:12px;color:#666;margin-top:4px">${paidCount} ${paidCount === 1 ? 'позиция' : 'позиций'}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Ожидают оплаты</div>
      <div class="stat-value" style="color:${pendingCount > 0 ? '#dc2626' : '#16a34a'}">${pendingCount}</div>
    </div>
  </div>
  ${renderGroup('Ежемесячные', monthlyObligations)}
  ${renderGroup('Ежегодные', yearlyObligations)}
  ${renderGroup('Единоразовые', onceObligations)}
  ${allCustom}
</body>
</html>`

    await window.api.exportPdf(html, `Обязательства_${year}_${String(month).padStart(2, '0')}.pdf`)
  }, [filtered, sorted, monthlyObligations, yearlyObligations, onceObligations, customSections, getMonthRecord, year, month, currentMonthLabel, totalMonthlyFiltered, totalPaidFiltered, paidCount, pendingCount, carryoverMap, carryoverFiltered, yearlyPaidUntilMap])

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
                {monthlyObligations.reduce((s, o) => s + (o.amount ?? 0), 0).toFixed(2)}€
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
                                {klarnaMonthly.filter(o => !isKlarnaCompleted(o)).reduce((s, o) => s + (o.amount ?? 0), 0).toFixed(2)}€/мес
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
                    onClick={() => handleOpenAdd('subscription')}
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
                {onceObligations.reduce((s, o) => s + (o.amount ?? 0), 0).toFixed(2)}€
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
                    onClick={() => handleOpenAdd('manual_payment')}
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
          const sectionTotal = sectionObs.reduce((s, o) => s + (o.amount ?? 0), 0)
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
        preselectedType={preselectedType}
        klarnaPaidCount={editTarget ? klarnaPaidCountMap.get(editTarget.id) : undefined}
      />

    </div>
  )
}
