import { describe, it, expect } from 'vitest'
import { evaluate, type NotificationsState } from '../services/notificationEngine'
import type { FinancialSnapshot, Obligation, ObligationMonth, UpcomingPayment } from '../types'

// ── Фикстуры ──────────────────────────────────────────────────────────────────
function snap(upcoming: Partial<UpcomingPayment>[]): FinancialSnapshot {
  return {
    upcomingPayments: upcoming.map((u) => ({
      id: 'p', name: 'X', amount: 10, dueDate: '2026-07-12',
      source: 'obligation', billingChain: 'other', riskFlag: false, ...u
    }))
  } as FinancialSnapshot
}

function ob(over: Partial<Obligation> = {}): Obligation {
  return {
    id: 'o1', name: 'Test', type: 'subscription', amount: 10, approximateDay: null,
    billingChain: 'other', source: 'Sparkasse', isActive: true,
    createdAt: '2020-01-01T00:00:00.000Z', frequency: 'monthly', ...over
  }
}

function mrec(over: Partial<ObligationMonth> = {}): ObligationMonth {
  return { obligationId: 'o1', year: 2026, month: 7, status: 'paid', actualAmount: null, ...over }
}

const empty: NotificationsState = {}

// ── Тип 1: «за 3 дня» ──────────────────────────────────────────────────────────
describe('notificationEngine — тип 1 (за 3 дня)', () => {
  const now = new Date(2026, 6, 10, 12, 0) // 10 июля 2026

  it('не-risky платёж в окне 3 дней → уведомление + дедуп-дата', () => {
    const res = evaluate({ snapshot: snap([{ name: 'Vodafone', amount: 39.99, dueDate: '2026-07-12' }]), obligations: [], obligationMonths: [], now, state: empty })
    expect(res.notifications).toHaveLength(1)
    expect(res.notifications[0].type).toBe('upcoming')
    expect(res.notifications[0].body).toContain('Vodafone')
    expect(res.notifications[0].body).toContain('39,99')
    expect(res.nextState.lastShownUpcomingDate).toBe('2026-07-10')
  })

  it('дедуп: уже показывали сегодня → тишина', () => {
    const res = evaluate({ snapshot: snap([{ dueDate: '2026-07-12' }]), obligations: [], obligationMonths: [], now, state: { lastShownUpcomingDate: '2026-07-10' } })
    expect(res.notifications).toHaveLength(0)
  })

  it('risky платёж исключён (живёт в OS-нотификации)', () => {
    const res = evaluate({ snapshot: snap([{ dueDate: '2026-07-12', riskFlag: true }]), obligations: [], obligationMonths: [], now, state: empty })
    expect(res.notifications).toHaveLength(0)
  })

  it('платёж дальше 3 дней не показывается', () => {
    const res = evaluate({ snapshot: snap([{ dueDate: '2026-07-20' }]), obligations: [], obligationMonths: [], now, state: empty })
    expect(res.notifications).toHaveLength(0)
  })

  it('до 2 названий + «и ещё N»', () => {
    const res = evaluate({
      snapshot: snap([
        { name: 'A', dueDate: '2026-07-11' }, { name: 'B', dueDate: '2026-07-12' }, { name: 'C', dueDate: '2026-07-13' }
      ]), obligations: [], obligationMonths: [], now, state: empty
    })
    expect(res.notifications[0].body).toContain('A')
    expect(res.notifications[0].body).toContain('B')
    expect(res.notifications[0].body).toContain('и ещё 1')
    expect(res.notifications[0].body).not.toContain('C')
  })

  it('snapshot=null → тип 1 не падает и не показывается', () => {
    const res = evaluate({ snapshot: null, obligations: [], obligationMonths: [], now, state: empty })
    expect(res.notifications).toHaveLength(0)
  })
})

// ── Тип 2: 1-е число ─────────────────────────────────────────────────────────
describe('notificationEngine — тип 2 (1-е число)', () => {
  it('1-е число, ещё не показывали → уведомление раз в месяц', () => {
    const res = evaluate({ snapshot: null, obligations: [], obligationMonths: [], now: new Date(2026, 6, 1, 9, 0), state: empty })
    const t2 = res.notifications.find((n) => n.type === 'firstOfMonth')
    expect(t2).toBeDefined()
    expect(t2?.body).toContain('Июль')
    expect(res.nextState.lastShownFirstMonth).toBe('2026-07')
  })

  it('дедуп: уже показывали в этом месяце → тишина', () => {
    const res = evaluate({ snapshot: null, obligations: [], obligationMonths: [], now: new Date(2026, 6, 1, 9, 0), state: { lastShownFirstMonth: '2026-07' } })
    expect(res.notifications.find((n) => n.type === 'firstOfMonth')).toBeUndefined()
  })

  it('не 1-е число → нет', () => {
    const res = evaluate({ snapshot: null, obligations: [], obligationMonths: [], now: new Date(2026, 6, 2, 9, 0), state: empty })
    expect(res.notifications.find((n) => n.type === 'firstOfMonth')).toBeUndefined()
  })
})

// ── Тип 3: вторая половина + большинство не оплачено ─────────────────────────
describe('notificationEngine — тип 3 (большинство не оплачено)', () => {
  const now = new Date(2026, 6, 20, 9, 0) // 20 июля 2026

  it('после 15-го, все три не оплачены → уведомление (3 из 3)', () => {
    const obs = [ob({ id: 'a' }), ob({ id: 'b' }), ob({ id: 'c' })]
    const res = evaluate({ snapshot: null, obligations: obs, obligationMonths: [], now, state: empty })
    const t3 = res.notifications.find((n) => n.type === 'mostlyUnpaid')
    expect(t3).toBeDefined()
    expect(t3?.body).toContain('3 из 3')
    expect(res.nextState.lastShownMostlyUnpaid).toBe('2026-07')
  })

  it('большинство оплачено (1 из 3) → нет', () => {
    const obs = [ob({ id: 'a' }), ob({ id: 'b' }), ob({ id: 'c' })]
    const months = [mrec({ obligationId: 'b', status: 'paid' }), mrec({ obligationId: 'c', status: 'paid' })]
    const res = evaluate({ snapshot: null, obligations: obs, obligationMonths: months, now, state: empty })
    expect(res.notifications.find((n) => n.type === 'mostlyUnpaid')).toBeUndefined()
  })

  it('дедуп: уже показывали в этом месяце → тишина', () => {
    const obs = [ob({ id: 'a' }), ob({ id: 'b' })]
    const res = evaluate({ snapshot: null, obligations: obs, obligationMonths: [], now, state: { lastShownMostlyUnpaid: '2026-07' } })
    expect(res.notifications.find((n) => n.type === 'mostlyUnpaid')).toBeUndefined()
  })

  it('первая половина месяца (<=15) → нет', () => {
    const obs = [ob({ id: 'a' }), ob({ id: 'b' })]
    const res = evaluate({ snapshot: null, obligations: obs, obligationMonths: [], now: new Date(2026, 6, 10, 9, 0), state: empty })
    expect(res.notifications.find((n) => n.type === 'mostlyUnpaid')).toBeUndefined()
  })

  it('завершённая рассрочка исключена из знаменателя', () => {
    // 1 обычное monthly (unpaid) + завершённая klarna (2/2 оплачено) → (1 из 1), не (1 из 3).
    const obs = [
      ob({ id: 'a' }),
      ob({ id: 'k', billingChain: 'klarna', totalInstallments: 2 })
    ]
    const months = [
      mrec({ obligationId: 'k', year: 2026, month: 6, status: 'paid' }),
      mrec({ obligationId: 'k', year: 2026, month: 7, status: 'paid' })
    ]
    const res = evaluate({ snapshot: null, obligations: obs, obligationMonths: months, now, state: empty })
    const t3 = res.notifications.find((n) => n.type === 'mostlyUnpaid')
    expect(t3).toBeDefined()
    expect(t3?.body).toContain('1 из 1')
  })
})
