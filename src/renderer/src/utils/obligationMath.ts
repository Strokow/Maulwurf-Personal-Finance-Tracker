// ── obligationMath — единый источник чистых предикатов и денежных примитивов ──
//
// Фаза 0 (2026-07): деньги и статусы обязательств исторически считались в ДВУХ
// местах — `financialEngine.computeSnapshot` (дашборд) и инлайново в
// `ObligationsTab.tsx` (страница). Их уже рассинхронизировали (BUG-022). Здесь —
// один набор чистых функций, который импортируют ОБА потребителя, чтобы правила
// не расходились. Экстракция строго поведение-сохраняющая: тела функций дословно
// повторяют прежнюю логику обоих мест (см. obligationMath.test.ts).
//
// Ничего, кроме чистых функций (без обращения к store/IPC/React) — модуль
// тестируется напрямую и переиспользуется движком и компонентами.

import type { Obligation, ObligationMonth, ObligationStatus } from '../types'

// ── Даты ────────────────────────────────────────────────────────────────────

// BUG-010: clamp дня к длине месяца, иначе new Date(2026, 1, 31) = 3 марта.
export function clampDayToMonth(year: number, month: number, day: number): number {
  const lastDay = new Date(year, month + 1, 0).getDate()
  return Math.min(day, lastDay)
}

// Локальный YYYY-MM-DD без сдвига в UTC: new Date(2026,4,1).toISOString() в
// Берлине летом даёт '2026-04-30'.
export function formatLocalDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ── Цена обязательства ───────────────────────────────────────────────────────

// Эффективная цена за конкретный месяц с учётом истории изменений (amountChanges).
// Месяцы до самой ранней записи используют базовый amount; прошлое не затрагивается.
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

// ── Статус за месяц ────────────────────────────────────────────────────────────

// Дефолт статуса без записи ObligationMonth (BUG-021):
// yearly/quarterly → 'unknown' (неизвестно, предстоит ли оплата в этом месяце —
// покрытие считается отдельно в UI-слое); monthly/once → 'unpaid'.
export function defaultStatus(o: Pick<Obligation, 'frequency'>): ObligationStatus {
  const f = o.frequency ?? 'monthly'
  return f === 'yearly' || f === 'quarterly' ? 'unknown' : 'unpaid'
}

// Эффективный статус: запись важнее дефолта.
export function getEffectiveStatus(
  o: Pick<Obligation, 'frequency'>,
  rec: ObligationMonth | null
): ObligationStatus {
  return rec?.status ?? defaultStatus(o)
}

// ── Нативность месяца ──────────────────────────────────────────────────────────

// «Нативно» активно в заданном месяце: isActive + месяц >= месяца createdAt
// (once — только в месяце создания). Единый предикат: и для видимого списка, и как
// гейт «начислять ли текущий платёж месяца» во всех суммах/счётчиках.
export function isNativeActive(o: Obligation, y: number, m: number): boolean {
  if (!o.isActive) return false
  const created = new Date(o.createdAt)
  const createdYear = created.getFullYear()
  const createdMonth = created.getMonth() + 1
  if (y < createdYear || (y === createdYear && m < createdMonth)) return false
  if ((o.frequency ?? 'monthly') === 'once') return createdYear === y && createdMonth === m
  return true
}

// ── Рассрочки (Klarna) ─────────────────────────────────────────────────────────

// Число оплаченных месяцев рассрочки.
export function paidInstallmentCount(o: Obligation, months: ObligationMonth[]): number {
  return months.filter((m) => m.obligationId === o.id && m.status === 'paid').length
}

// Завершённая рассрочка (оплачено >= всего платежей) больше ничего не должна и
// исключается из всех сумм «к оплате» (BUG-014/022). Карточка видна в месяце
// последнего платежа и скрыта во всех последующих (isHiddenCompleted, Фаза 6).
// В большом Maulwurf рассрочка = billingChain === 'klarna'.
export function isInstallmentCompleted(o: Obligation, months: ObligationMonth[]): boolean {
  if (o.billingChain !== 'klarna') return false
  if (o.totalInstallments == null || o.totalInstallments <= 0) return false
  return paidInstallmentCount(o, months) >= o.totalInstallments
}

// Месяц последнего оплаченного платежа рассрочки как y*12+m (или null, если платежей
// нет). Граница «истории» завершённой рассрочки (Фаза 6).
export function lastPaidYM(o: Obligation, months: ObligationMonth[]): number | null {
  let max: number | null = null
  for (const m of months) {
    if (m.obligationId === o.id && m.status === 'paid') {
      const ym = m.year * 12 + m.month
      if (max == null || ym > max) max = ym
    }
  }
  return max
}

// Завершённая рассрочка, которую в ДАННОМ месяце уже не показываем (Фаза 6, D-E):
// видна в месяце последнего платежа, скрыта во всех последующих. Данные НЕ удаляются —
// при возврате к прошлому месяцу карточка снова видна. Ретроактивное снятие последнего
// платежа делает рассрочку снова незавершённой → карточка возвращается везде.
export function isHiddenCompleted(
  o: Obligation,
  months: ObligationMonth[],
  year: number,
  month: number
): boolean {
  if (!isInstallmentCompleted(o, months)) return false
  const last = lastPaidYM(o, months)
  if (last == null) return false // защита: completed без paid-записей не прячем
  return year * 12 + month > last
}

// ── Периодические (yearly / quarterly) ─────────────────────────────────────────
// Пока используется только Lite-логикой yearly в UI; готовим к Фазе 3 (quarterly).

export type PeriodFrequency = 'yearly' | 'quarterly'

// Один платёж покрывает столько месяцев.
export function coverageMonths(frequency: PeriodFrequency): number {
  return frequency === 'yearly' ? 12 : 3
}

// Платёж в (paidYear, paidMonth) → последний покрытый месяц (включительно):
// yearly, оплачен в марте 2026 → до февраля 2027; quarterly в ноябре 2026 → до января 2027.
export function paidUntil(
  frequency: PeriodFrequency,
  paidYear: number,
  paidMonth: number
): { untilYear: number; untilMonth: number } {
  let untilMonth = paidMonth + coverageMonths(frequency) - 1
  let untilYear = paidYear
  while (untilMonth > 12) {
    untilMonth -= 12
    untilYear++
  }
  return { untilYear, untilMonth }
}

// ── Денежные примитивы (Фаза 5) ────────────────────────────────────────────────
// Пока НЕ подключены к рабочим суммам (это делает Фаза 5, с обновлением тестов):
// смысл — накопление в целых центах, чтобы сумма валют была корректной независимо
// от порядка сложения (реальный «математический алгоритм», а не порядок номеров).

// Округление до цента.
export function roundCents(n: number): number {
  return Math.round(n * 100) / 100
}

// Сумма денег через накопление в целых центах (устраняет float-дрейф).
export function sumMoney(values: number[]): number {
  return values.reduce((cents, v) => cents + Math.round(v * 100), 0) / 100
}
