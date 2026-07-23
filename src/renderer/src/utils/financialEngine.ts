import {
  AppDataExtended,
  FinancialSnapshot,
  SnapshotWarning,
  UpcomingPayment,
  DataConfidence,
  Obligation,
  ObligationMonth,
  ObligationStatus,
} from '../types'
import {
  clampDayToMonth,
  formatLocalDate,
  effectiveAmount,
  getEffectiveStatus,
  isNativeActive,
  paidInstallmentCount,
  roundCents,
} from './obligationMath'

// Ре-экспорт (Фаза 0): эти чистые функции переехали в obligationMath.ts (единый
// источник предикатов), но многие модули импортируют их из financialEngine —
// сохраняем прежний путь импорта.
export { clampDayToMonth, formatLocalDate, effectiveAmount } from './obligationMath'

const STALE_DAYS = 14

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
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
  const totalLiquid = roundCents(accounts.reduce((s, a) => s + a.balance, 0))
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
  const recThisMonth = (o: Obligation): ObligationMonth | undefined =>
    data.obligationMonths.find(
      (m) => m.obligationId === o.id && m.year === yr0 && m.month === mo0
    )

  const statusThisMonth = (o: Obligation): ObligationStatus =>
    getEffectiveStatus(o, recThisMonth(o) ?? null)

  // Гейт «нативности» месяца (аудит 2026-07-02): обязательство участвует в текущем
  // месяце только если месяц >= месяца createdAt; once — ТОЛЬКО в месяце создания.
  // Без гейта once после своего месяца (дефолт unpaid) вычиталось из freeThisMonth
  // навсегда (BUG-016 закрывал это только для Klarna-once), а обязательства,
  // созданные для будущего месяца, — уже сейчас. Единый предикат со страницей
  // обязательств (isNativeActive в ObligationsTab).
  const isNativeThisMonth = (o: Obligation): boolean => isNativeActive(o, yr0, mo0)

  // Перенос долга в дашборде (продолжение BUG-023, решение 2026-07-02):
  // долг, перенесённый ИЗ текущего месяца, здесь больше не должен;
  // непогашенный долг, перенесённый СЮДА, — добавляется к обязательствам месяца.
  const carriedOutIds = new Set(
    data.obligationMonths
      .filter((m) => m.isCarriedOver && m.carriedFromYear === yr0 && m.carriedFromMonth === mo0)
      .map((m) => m.obligationId)
  )
  const carriedInDebt = (o: Obligation): number => {
    const rec = recThisMonth(o)
    return rec?.isCarriedOver && !rec.carriedPaid && rec.carriedAmount != null
      ? rec.carriedAmount
      : 0
  }

  // Завершённая рассрочка Klarna (оплачено >= всего платежей) — больше не ежемесячное
  // обязательство и не должна вычитаться из «свободных денег» каждый месяц (BUG-014/BUG-022).
  const isKlarnaCompleted = (o: Obligation): boolean => {
    if (o.totalInstallments == null) return false
    return paidInstallmentCount(o, data.obligationMonths) >= o.totalInstallments
  }

  const activeObligations = data.obligations.filter(
    (o) => o.isActive && o.billingChain !== 'klarna'
  )
  // Считаем обязательства с реальным статусом (paid/unpaid). 'unknown' (yearly без записи)
  // и 'skipped' (скрыто в этом месяце) в месячное обязательство НЕ идут.
  // Дополнительно: только нативные в этом месяце (гейт createdAt/once) и не
  // перенесённые ИЗ него — их текущее начисление живёт в целевом месяце переноса.
  const knownObligations = activeObligations.filter((o) => {
    if (!isNativeThisMonth(o) || carriedOutIds.has(o.id)) return false
    const status = statusThisMonth(o)
    return status === 'paid' || status === 'unpaid'
  })
  let monthlyObligations = knownObligations.reduce(
    (s, o) => s + (effectiveAmount(o, yr0, mo0) ?? 0),
    0
  )
  let monthlyObligationsCount = knownObligations.length
  // Непогашенный долг, перенесённый СЮДА, добавляется отдельной суммой — в т.ч. у
  // once/yearly, которые вне своего месяца текущего начисления не имеют.
  for (const o of activeObligations) {
    const debt = carriedInDebt(o)
    if (debt > 0) {
      monthlyObligations += debt
      if (!knownObligations.some((k) => k.id === o.id)) monthlyObligationsCount++
    }
  }

  // Klarna-обязательства теперь живут как обычные Obligation с billingChain='klarna'
  const klarnaObligations = data.obligations.filter((o) => {
    if (!o.isActive || o.billingChain !== 'klarna') return false
    // Завершённая рассрочка не входит в месячную Klarna-сумму.
    if (isKlarnaCompleted(o)) return false
    // Гейт нативности + перенос — как у обычных обязательств.
    if (!isNativeThisMonth(o) || carriedOutIds.has(o.id)) return false
    // Единоразовая (once) Klarna — не ежемесячная: учитываем её ТОЛЬКО в её собственном
    // месяце и только пока не оплачена. Иначе будущий/прошлый разовый платёж постоянно
    // вычитался бы из «свободных денег» в каждом месяце.
    if ((o.frequency ?? 'monthly') === 'once') {
      return (recThisMonth(o)?.status ?? 'unknown') === 'unpaid'
    }
    return true
  })
  let monthlyKlarna = klarnaObligations.reduce((s, o) => s + (effectiveAmount(o, yr0, mo0) ?? 0), 0)
  let monthlyKlarnaCount = klarnaObligations.length
  for (const o of data.obligations) {
    if (!o.isActive || o.billingChain !== 'klarna') continue
    const debt = carriedInDebt(o)
    if (debt > 0) {
      monthlyKlarna += debt
      if (!klarnaObligations.some((k) => k.id === o.id)) monthlyKlarnaCount++
    }
  }
  // Cent-корректность (Фаза 5): округляем суммы до центов на границе, чтобы float-дрейф
  // не давал «...0000004» в отображаемых числах.
  monthlyObligations = roundCents(monthlyObligations)
  monthlyKlarna = roundCents(monthlyKlarna)
  const freeThisMonth = roundCents(totalLiquid - monthlyObligations - monthlyKlarna)

  if (freeThisMonth < 0)
    warnings.push({
      code: 'DEFICIT',
      message: `Дефицит ${Math.abs(freeThisMonth).toFixed(2)}€: обязательства превышают средства.`,
      severity: 'error',
    })

  // Нормализация к 00:00 (аудит 2026-07-02): сравнение due < today с временем суток
  // «уводило» платёж В ДЕНЬ ОПЛАТЫ на следующий месяц — он пропадал из ближайших.
  const todayMid = new Date(today)
  todayMid.setHours(0, 0, 0, 0)
  const in14 = new Date(todayMid)
  in14.setDate(in14.getDate() + 14)
  const yr = today.getFullYear()
  const mo = today.getMonth()

  const upcomingObligation: UpcomingPayment[] = knownObligations
    .filter((o) => o.approximateDay != null)
    .map((o) => {
      let due = new Date(yr, mo, clampDayToMonth(yr, mo, o.approximateDay!))
      if (due < todayMid) due = new Date(yr, mo + 1, clampDayToMonth(yr, mo + 1, o.approximateDay!))
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
      if (due < todayMid) due = new Date(yr, mo + 1, clampDayToMonth(yr, mo + 1, o.approximateDay!))
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
    monthlyObligationsCount,
    monthlyKlarna,
    monthlyKlarnaCount,
    freeThisMonth,
    riskLevel,
    upcomingPayments,
    warnings,
  }
}
