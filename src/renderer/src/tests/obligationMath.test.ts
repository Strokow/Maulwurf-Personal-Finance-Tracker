import { describe, it, expect } from 'vitest'
import {
  clampDayToMonth,
  formatLocalDate,
  effectiveAmount,
  defaultStatus,
  getEffectiveStatus,
  isNativeActive,
  paidInstallmentCount,
  isInstallmentCompleted,
  lastPaidYM,
  isHiddenCompleted,
  coverageMonths,
  paidUntil,
  roundCents,
  sumMoney,
} from '../utils/obligationMath'
import type { Obligation, ObligationMonth } from '../types'

// Хелпер: минимальное обязательство с переопределениями.
function ob(over: Partial<Obligation> = {}): Obligation {
  return {
    id: 'o1',
    name: 'Test',
    type: 'subscription',
    amount: 10,
    approximateDay: null,
    billingChain: 'other',
    source: 'Sparkasse',
    isActive: true,
    createdAt: '2020-01-01T00:00:00.000Z',
    frequency: 'monthly',
    ...over,
  }
}

function month(over: Partial<ObligationMonth> = {}): ObligationMonth {
  return { obligationId: 'o1', year: 2026, month: 7, status: 'paid', actualAmount: null, ...over }
}

describe('clampDayToMonth', () => {
  it('обрезает 31 до длины короткого месяца (февраль)', () => {
    expect(clampDayToMonth(2026, 1, 31)).toBe(28) // month index 1 = февраль
  })
  it('не трогает валидный день', () => {
    expect(clampDayToMonth(2026, 6, 15)).toBe(15)
  })
})

describe('formatLocalDate', () => {
  it('локальный YYYY-MM-DD без UTC-сдвига', () => {
    expect(formatLocalDate(new Date(2026, 4, 1))).toBe('2026-05-01')
  })
})

describe('effectiveAmount', () => {
  it('без amountChanges — базовая цена', () => {
    expect(effectiveAmount({ amount: 10 }, 2026, 7)).toBe(10)
  })
  it('месяцы до самой ранней записи — базовая цена', () => {
    const o = { amount: 10, amountChanges: [{ from: '2026-07', amount: 12 }] }
    expect(effectiveAmount(o, 2026, 6)).toBe(10)
    expect(effectiveAmount(o, 2026, 7)).toBe(12)
  })
  it('несколько изменений: последнее с from <= месяца', () => {
    const o = { amount: 10, amountChanges: [{ from: '2026-09', amount: 15 }, { from: '2026-07', amount: 12 }] }
    expect(effectiveAmount(o, 2026, 8)).toBe(12)
    expect(effectiveAmount(o, 2026, 9)).toBe(15)
  })
})

describe('defaultStatus / getEffectiveStatus', () => {
  it('yearly/quarterly без записи → unknown', () => {
    expect(defaultStatus({ frequency: 'yearly' })).toBe('unknown')
    expect(defaultStatus({ frequency: 'quarterly' })).toBe('unknown')
  })
  it('monthly/once/без частоты → unpaid', () => {
    expect(defaultStatus({ frequency: 'monthly' })).toBe('unpaid')
    expect(defaultStatus({ frequency: 'once' })).toBe('unpaid')
    expect(defaultStatus({ frequency: undefined })).toBe('unpaid')
  })
  it('запись важнее дефолта', () => {
    expect(getEffectiveStatus({ frequency: 'yearly' }, month({ status: 'paid' }))).toBe('paid')
    expect(getEffectiveStatus({ frequency: 'monthly' }, null)).toBe('unpaid')
    expect(getEffectiveStatus({ frequency: 'yearly' }, null)).toBe('unknown')
  })
})

describe('isNativeActive', () => {
  it('неактивное → false', () => {
    expect(isNativeActive(ob({ isActive: false }), 2026, 7)).toBe(false)
  })
  it('месяц раньше createdAt → false', () => {
    const o = ob({ createdAt: '2026-07-01T00:00:00.000Z' })
    expect(isNativeActive(o, 2026, 6)).toBe(false)
    expect(isNativeActive(o, 2026, 7)).toBe(true)
    expect(isNativeActive(o, 2026, 8)).toBe(true)
  })
  it('once — только в месяце создания', () => {
    const o = ob({ frequency: 'once', createdAt: '2026-07-01T00:00:00.000Z' })
    expect(isNativeActive(o, 2026, 7)).toBe(true)
    expect(isNativeActive(o, 2026, 8)).toBe(false)
    expect(isNativeActive(o, 2026, 6)).toBe(false)
  })
})

describe('paidInstallmentCount / isInstallmentCompleted', () => {
  const months: ObligationMonth[] = [
    month({ year: 2026, month: 5, status: 'paid' }),
    month({ year: 2026, month: 6, status: 'paid' }),
    month({ year: 2026, month: 7, status: 'unpaid' }),
  ]
  it('считает только paid', () => {
    expect(paidInstallmentCount(ob(), months)).toBe(2)
  })
  it('не-klarna → не завершена', () => {
    expect(isInstallmentCompleted(ob({ billingChain: 'other', totalInstallments: 2 }), months)).toBe(false)
  })
  it('klarna, оплачено >= всего → завершена', () => {
    expect(isInstallmentCompleted(ob({ billingChain: 'klarna', totalInstallments: 2 }), months)).toBe(true)
    expect(isInstallmentCompleted(ob({ billingChain: 'klarna', totalInstallments: 3 }), months)).toBe(false)
  })
  it('totalInstallments отсутствует/0 → не завершена', () => {
    expect(isInstallmentCompleted(ob({ billingChain: 'klarna', totalInstallments: undefined }), months)).toBe(false)
    expect(isInstallmentCompleted(ob({ billingChain: 'klarna', totalInstallments: 0 }), months)).toBe(false)
  })
})

describe('lastPaidYM / isHiddenCompleted (Фаза 6)', () => {
  // Рассрочка 3 платежа, оплачены май/июнь/июль 2026 → завершена, последний платёж = июль.
  const done: ObligationMonth[] = [
    month({ year: 2026, month: 5, status: 'paid' }),
    month({ year: 2026, month: 6, status: 'paid' }),
    month({ year: 2026, month: 7, status: 'paid' }),
  ]
  // Те же 3 платежа, но июль ещё не оплачен → не завершена.
  const partial: ObligationMonth[] = [
    month({ year: 2026, month: 5, status: 'paid' }),
    month({ year: 2026, month: 6, status: 'paid' }),
    month({ year: 2026, month: 7, status: 'unpaid' }),
  ]
  const klarna3 = ob({ billingChain: 'klarna', totalInstallments: 3 })

  it('lastPaidYM — самый поздний paid-месяц как y*12+m; без платежей → null', () => {
    expect(lastPaidYM(klarna3, done)).toBe(2026 * 12 + 7)
    expect(lastPaidYM(klarna3, [])).toBeNull()
  })
  it('видна в месяце последнего платежа, скрыта со следующего', () => {
    expect(isHiddenCompleted(klarna3, done, 2026, 7)).toBe(false) // месяц завершения — видна
    expect(isHiddenCompleted(klarna3, done, 2026, 8)).toBe(true) // следующий — скрыта
    expect(isHiddenCompleted(klarna3, done, 2027, 1)).toBe(true) // и дальше
  })
  it('в месяцах активности (до завершения) — видна', () => {
    expect(isHiddenCompleted(klarna3, done, 2026, 6)).toBe(false)
    expect(isHiddenCompleted(klarna3, done, 2026, 5)).toBe(false)
  })
  it('незавершённая рассрочка не скрывается нигде', () => {
    expect(isHiddenCompleted(klarna3, partial, 2026, 8)).toBe(false)
  })
  it('не-klarna не скрывается', () => {
    expect(isHiddenCompleted(ob({ billingChain: 'other', totalInstallments: 3 }), done, 2026, 8)).toBe(false)
  })
  it('ретроактивное снятие последнего платежа возвращает карточку', () => {
    // С июлем-paid (done) август скрыт; без него (partial) — виден.
    expect(isHiddenCompleted(klarna3, done, 2026, 8)).toBe(true)
    expect(isHiddenCompleted(klarna3, partial, 2026, 8)).toBe(false)
  })
})

describe('coverageMonths / paidUntil', () => {
  it('покрытие: yearly=12, quarterly=3', () => {
    expect(coverageMonths('yearly')).toBe(12)
    expect(coverageMonths('quarterly')).toBe(3)
  })
  it('yearly, март 2026 → до февраля 2027', () => {
    expect(paidUntil('yearly', 2026, 3)).toEqual({ untilYear: 2027, untilMonth: 2 })
  })
  it('quarterly, ноябрь 2026 → до января 2027', () => {
    expect(paidUntil('quarterly', 2026, 11)).toEqual({ untilYear: 2027, untilMonth: 1 })
  })
})

describe('roundCents / sumMoney', () => {
  it('округляет до цента', () => {
    expect(roundCents(10.005)).toBe(10.01)
    expect(roundCents(2.994)).toBe(2.99)
  })
  it('sumMoney устойчив к float-дрейфу', () => {
    // 0.1 + 0.2 === 0.30000000000000004 при обычном сложении
    expect(sumMoney([0.1, 0.2])).toBe(0.3)
    expect(sumMoney([10.1, 20.2, 5.05])).toBe(35.35)
    expect(sumMoney([])).toBe(0)
  })
})
