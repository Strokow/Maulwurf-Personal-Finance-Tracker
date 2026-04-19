import {
  AppDataExtended,
  FinancialSnapshot,
  SnapshotWarning,
  UpcomingPayment,
  DataConfidence,
} from '../types'

const STALE_DAYS = 14

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

// BUG-010: clamp дня к длине месяца, иначе new Date(2026, 1, 31) = 3 марта вместо 28 февраля
export function clampDayToMonth(year: number, month: number, day: number): number {
  const lastDay = new Date(year, month + 1, 0).getDate()
  return Math.min(day, lastDay)
}

export function computeSnapshot(data: AppDataExtended): FinancialSnapshot {
  const warnings: SnapshotWarning[] = []
  const today = new Date()

  const accounts = data.accountBalances.map((acc) => {
    const age = daysSince(acc.balanceDate)
    const confidence: DataConfidence =
      age > STALE_DAYS
        ? 'stale'
        : acc.balance === 0 && acc.balanceDate === acc.updatedAt
          ? 'missing'
          : 'ok'
    if (confidence === 'stale')
      warnings.push({
        code: 'BALANCE_STALE',
        message: `${acc.source}: баланс не обновлялся ${age} дней.`,
        affectedId: acc.id,
        severity: 'warn',
      })
    if (confidence === 'missing')
      warnings.push({
        code: 'BALANCE_MISSING',
        message: `${acc.source}: баланс не введён.`,
        affectedId: acc.id,
        severity: 'warn',
      })
    return { ...acc, confidence }
  })

  const hasAnyRealBalance = accounts.some(
    (a) => a.confidence !== 'missing' && a.balance > 0
  )
  const totalLiquid = accounts.reduce((s, a) => s + a.balance, 0)
  const totalLiquidConfidence: DataConfidence =
    accounts.every((a) => a.confidence === 'ok')
      ? 'ok'
      : accounts.some((a) => a.confidence === 'stale')
        ? 'stale'
        : 'missing'

  const yr0 = today.getFullYear()
  const mo0 = today.getMonth() + 1
  const activeObligations = data.obligations.filter(
    (o) => o.isActive && o.billingChain !== 'klarna'
  )
  // Only count obligations with known status (paid/unpaid) — skip 'unknown'
  const knownObligations = activeObligations.filter((o) => {
    const rec = data.obligationMonths.find(
      (m) => m.obligationId === o.id && m.year === yr0 && m.month === mo0
    )
    const status = rec?.status ?? 'unknown'
    return status !== 'unknown'
  })
  const monthlyObligations = knownObligations.reduce(
    (s, o) => s + (o.amount ?? 0),
    0
  )

  // Klarna-обязательства теперь живут как обычные Obligation с billingChain='klarna'
  const klarnaObligations = data.obligations.filter(
    (o) => o.isActive && o.billingChain === 'klarna'
  )
  const monthlyKlarna = klarnaObligations.reduce((s, o) => s + (o.amount ?? 0), 0)
  const freeThisMonth = totalLiquid - monthlyObligations - monthlyKlarna

  if (freeThisMonth < 0)
    warnings.push({
      code: 'DEFICIT',
      message: `Дефицит ${Math.abs(freeThisMonth).toFixed(2)}€: обязательства превышают средства.`,
      severity: 'error',
    })

  const in14 = new Date(today)
  in14.setDate(in14.getDate() + 14)
  const yr = today.getFullYear()
  const mo = today.getMonth()

  const upcomingObligation: UpcomingPayment[] = knownObligations
    .filter((o) => o.approximateDay != null)
    .map((o) => {
      let due = new Date(yr, mo, clampDayToMonth(yr, mo, o.approximateDay!))
      if (due < today) due = new Date(yr, mo + 1, clampDayToMonth(yr, mo + 1, o.approximateDay!))
      return {
        id: o.id,
        name: o.name,
        amount: o.amount ?? 0,
        dueDate: due.toISOString().split('T')[0],
        source: 'obligation' as const,
        billingChain: o.billingChain,
        riskFlag: false,
      }
    })
    .filter((p) => new Date(p.dueDate) <= in14)

  const upcomingKlarna: UpcomingPayment[] = klarnaObligations
    .filter((o) => o.approximateDay != null)
    .map((o) => {
      let due = new Date(yr, mo, clampDayToMonth(yr, mo, o.approximateDay!))
      if (due < today) due = new Date(yr, mo + 1, clampDayToMonth(yr, mo + 1, o.approximateDay!))
      return {
        id: o.id,
        name: o.name,
        amount: o.amount ?? 0,
        dueDate: due.toISOString().split('T')[0],
        source: 'klarna' as const,
        billingChain: 'klarna',
        riskFlag: false,
      }
    })
    .filter((p) => new Date(p.dueDate) <= in14)

  const allUpcoming = [...upcomingObligation, ...upcomingKlarna].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate)
  )
  const byDate: Record<string, number> = {}
  allUpcoming.forEach((p) => {
    byDate[p.dueDate] = (byDate[p.dueDate] ?? 0) + p.amount
  })
  const upcomingPayments = allUpcoming.map((p) => ({
    ...p,
    riskFlag: totalLiquid < byDate[p.dueDate] * 1.1,
  }))

  const riskLevel: FinancialSnapshot['riskLevel'] = !hasAnyRealBalance
    ? 'unknown'
    : freeThisMonth < 0
      ? 'critical'
      : freeThisMonth < totalLiquid * 0.15
        ? 'tight'
        : 'safe'

  if (riskLevel === 'unknown')
    warnings.push({
      code: 'RISK_UNKNOWN',
      message: 'Невозможно рассчитать риск: введи балансы счетов.',
      severity: 'warn',
    })

  return {
    generatedAt: new Date().toISOString(),
    accounts,
    totalLiquid,
    totalLiquidConfidence,
    monthlyObligations,
    monthlyObligationsCount: knownObligations.length,
    monthlyKlarna,
    monthlyKlarnaCount: klarnaObligations.length,
    freeThisMonth,
    riskLevel,
    upcomingPayments,
    warnings,
  }
}
