import {
  AppDataExtended,
  FinancialSnapshot,
  SnapshotWarning,
  UpcomingPayment,
  DataConfidence,
  Obligation,
  ObligationStatus,
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

// Локальный YYYY-MM-DD без сдвига в UTC: new Date(2026,4,1).toISOString() в Берлине летом даёт '2026-04-30'.
export function formatLocalDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Эффективная цена обязательства для конкретного месяца с учётом истории изменений (amountChanges).
// Месяцы до самой ранней записи используют базовый amount. Прошлое не затрагивается изменением цены.
export function effectiveAmount(
  o: { amount: number | null; amountChanges?: { from: string; amount: number }[] },
  year: number,
  month: number
): number | null {
  if (!o.amountChanges || o.amountChanges.length === 0) return o.amount
  const key = `${year}-${String(month).padStart(2, '0')}`
  let amt = o.amount
  for (const ch of [...o.amountChanges].sort((a, b) => a.from.localeCompare(b.from))) {
    if (ch.from <= key) amt = ch.amount
    else break
  }
  return amt
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

  // Эффективный статус обязательства за ТЕКУЩИЙ месяц — единый с UI (BUG-021).
  // Запись > дефолт. Дефолт без записи: yearly → 'unknown' (неизвестно, предстоит ли
  // оплата в этом месяце); monthly/once → 'unpaid' (активная подписка/платёж, ещё не
  // подтверждён). Согласование движка со страницей обязательств: раньше движок считал
  // любое monthly без записи как 'unknown' и НЕ вычитал его из freeThisMonth, а страница
  // показывала его как «Не оплачено» в «Осталось оплатить» → два разных числа.
  const statusThisMonth = (o: Obligation): ObligationStatus => {
    const rec = data.obligationMonths.find(
      (m) => m.obligationId === o.id && m.year === yr0 && m.month === mo0
    )
    if (rec?.status) return rec.status
    return (o.frequency ?? 'monthly') === 'yearly' ? 'unknown' : 'unpaid'
  }

  // Завершённая рассрочка Klarna (оплачено >= всего платежей) — больше не ежемесячное
  // обязательство и не должна вычитаться из «свободных денег» каждый месяц (BUG-014/BUG-022).
  const isKlarnaCompleted = (o: Obligation): boolean => {
    if (o.totalInstallments == null) return false
    const paid = data.obligationMonths.filter(
      (m) => m.obligationId === o.id && m.status === 'paid'
    ).length
    return paid >= o.totalInstallments
  }

  const activeObligations = data.obligations.filter(
    (o) => o.isActive && o.billingChain !== 'klarna'
  )
  // Считаем обязательства с реальным статусом (paid/unpaid). 'unknown' (yearly без записи)
  // и 'skipped' (скрыто в этом месяце) в месячное обязательство НЕ идут.
  const knownObligations = activeObligations.filter((o) => {
    const status = statusThisMonth(o)
    return status === 'paid' || status === 'unpaid'
  })
  const monthlyObligations = knownObligations.reduce(
    (s, o) => s + (effectiveAmount(o, yr0, mo0) ?? 0),
    0
  )

  // Klarna-обязательства теперь живут как обычные Obligation с billingChain='klarna'
  const klarnaObligations = data.obligations.filter((o) => {
    if (!o.isActive || o.billingChain !== 'klarna') return false
    // Завершённая рассрочка не входит в месячную Klarna-сумму.
    if (isKlarnaCompleted(o)) return false
    // Единоразовая (once) Klarna — не ежемесячная: учитываем её ТОЛЬКО в её собственном
    // месяце и только пока не оплачена. Иначе будущий/прошлый разовый платёж постоянно
    // вычитался бы из «свободных денег» в каждом месяце.
    if ((o.frequency ?? 'monthly') === 'once') {
      const rec = data.obligationMonths.find(
        (m) => m.obligationId === o.id && m.year === yr0 && m.month === mo0
      )
      return (rec?.status ?? 'unknown') === 'unpaid'
    }
    return true
  })
  const monthlyKlarna = klarnaObligations.reduce((s, o) => s + (effectiveAmount(o, yr0, mo0) ?? 0), 0)
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
        amount: effectiveAmount(o, yr0, mo0) ?? 0,
        dueDate: formatLocalDate(due),
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
        amount: effectiveAmount(o, yr0, mo0) ?? 0,
        dueDate: formatLocalDate(due),
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
