// ── notificationEngine — чистый детерминированный слой in-app уведомлений (Фаза 8) ──
//
// Правило проекта: движок уведомлений живёт ВНЕ computeSnapshot и получает `now`
// инъекцией (тестируемость, ловля перехода через полночь/1-е число при открытом окне).
// Никаких обращений к store/IPC/React — только чистая функция evaluate().
//
// Дедуп персистентный (NotificationsState в сторе, вне undo): без него каждый запуск
// после 15-го = спам. Тип-1 не чаще раза в день, типы 2/3 — раз в месяц.
//
// Гейт notificationsEnabled и PIN-разблокировку проверяет ВЫЗЫВАЮЩИЙ (Home), не движок.

import type { FinancialSnapshot, Obligation, ObligationMonth, NotificationsState } from '../types'
import { formatLocalDate, isNativeActive, getEffectiveStatus, isInstallmentCompleted } from '../utils/obligationMath'

export type { NotificationsState }

export type NotificationType = 'upcoming' | 'firstOfMonth' | 'mostlyUnpaid'

export interface AppNotification {
  type: NotificationType
  title: string
  body: string
}

export interface EvaluateInput {
  snapshot: FinancialSnapshot | null
  obligations: Obligation[]
  obligationMonths: ObligationMonth[]
  now: Date
  state: NotificationsState
}

export interface EvaluateResult {
  notifications: AppNotification[]
  nextState: NotificationsState
}

const MONTHS_GEN = [
  '', 'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
]
const MONTHS_NOM = [
  '', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
]

function fmtEur(n: number): string {
  return n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
}

// Окно «за 3 дня»: [начало сегодняшнего дня, +3 суток] включительно.
function isWithin3Days(dueDate: string, now: Date): boolean {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 3)
  const due = new Date(dueDate + 'T00:00:00')
  return due >= start && due <= end
}

export function evaluate(input: EvaluateInput): EvaluateResult {
  const { snapshot, obligations, obligationMonths, now, state } = input
  const notifications: AppNotification[] = []
  const nextState: NotificationsState = { ...state }

  const todayStr = formatLocalDate(now)
  const monthStr = todayStr.slice(0, 7)
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  const date = now.getDate()

  // ── Тип 1: «за 3 дня» (не чаще раза в день) ──────────────────────────────────
  // Информационные (НЕ risky) предстоящие платежи — risky живут в OS-нотификации
  // (critical-risk, main), чтобы не было двойного «за 3 дня» (2A.4). Переиспользуем
  // готовый snapshot.upcomingPayments (нативные не-paid в 14-дневном окне) и сужаем до 3 дней.
  if (snapshot && state.lastShownUpcomingDate !== todayStr) {
    const soon = snapshot.upcomingPayments.filter(
      (p) => !p.riskFlag && isWithin3Days(p.dueDate, now)
    )
    if (soon.length > 0) {
      const shown = soon.slice(0, 2).map((p) => `${p.name} ${fmtEur(p.amount)}`)
      const extra = soon.length > 2 ? ` и ещё ${soon.length - 2}` : ''
      notifications.push({
        type: 'upcoming',
        title: 'Скоро платежи',
        body: `${shown.join(' · ')}${extra} — в ближайшие 3 дня.`
      })
      nextState.lastShownUpcomingDate = todayStr
    }
  }

  // ── Тип 2: 1-е число месяца (раз в месяц) ────────────────────────────────────
  if (date === 1 && state.lastShownFirstMonth !== monthStr) {
    notifications.push({
      type: 'firstOfMonth',
      title: 'Начало месяца',
      body: `Наступил ${MONTHS_NOM[m]} — проверь обязательства и обнови балансы счетов.`
    })
    nextState.lastShownFirstMonth = monthStr
  }

  // ── Тип 3: вторая половина месяца + большинство не оплачено (раз в месяц) ─────
  if (date > 15 && state.lastShownMostlyUnpaid !== monthStr) {
    let paid = 0
    let unpaid = 0
    for (const o of obligations) {
      if (!isNativeActive(o, y, m)) continue
      if (isInstallmentCompleted(o, obligationMonths)) continue
      const rec = obligationMonths.find(
        (r) => r.obligationId === o.id && r.year === y && r.month === m
      )
      const status = getEffectiveStatus(o, rec ?? null)
      if (status === 'paid') paid++
      else if (status === 'unpaid') unpaid++
      // 'unknown'/'skipped' в знаменатель не идут
    }
    const total = paid + unpaid
    if (total > 0 && unpaid / total > 0.5) {
      notifications.push({
        type: 'mostlyUnpaid',
        title: 'Много неоплаченного',
        body: `Больше половины обязательств за ${MONTHS_GEN[m]} ещё не оплачено (${unpaid} из ${total}).`
      })
      nextState.lastShownMostlyUnpaid = monthStr
    }
  }

  return { notifications, nextState }
}
