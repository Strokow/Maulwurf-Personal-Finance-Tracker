import { describe, it, expect, beforeEach, vi } from 'vitest'
import { computeSnapshot, effectiveAmount } from '../utils/financialEngine'
import type { AppDataExtended, AccountBalance, Obligation, ObligationMonth } from '../types'

describe('effectiveAmount (помесячная цена с эффективной даты)', () => {
  const base = { amount: 10 as number | null }
  it('без amountChanges возвращает базовую цену', () => {
    expect(effectiveAmount(base, 2026, 7)).toBe(10)
  })
  it('месяцы до самой ранней записи используют базовую цену', () => {
    const o = { amount: 10 as number | null, amountChanges: [{ from: '2026-07', amount: 12 }] }
    expect(effectiveAmount(o, 2026, 6)).toBe(10) // июнь — прошлое, не затронуто
  })
  it('с месяца изменения и далее — новая цена', () => {
    const o = { amount: 10 as number | null, amountChanges: [{ from: '2026-07', amount: 12 }] }
    expect(effectiveAmount(o, 2026, 7)).toBe(12)
    expect(effectiveAmount(o, 2026, 8)).toBe(12)
    expect(effectiveAmount(o, 2027, 1)).toBe(12)
  })
  it('несколько изменений: берётся последнее с from <= месяц', () => {
    const o = {
      amount: 10 as number | null,
      amountChanges: [{ from: '2026-09', amount: 15 }, { from: '2026-07', amount: 12 }],
    }
    expect(effectiveAmount(o, 2026, 6)).toBe(10)
    expect(effectiveAmount(o, 2026, 7)).toBe(12)
    expect(effectiveAmount(o, 2026, 8)).toBe(12)
    expect(effectiveAmount(o, 2026, 9)).toBe(15)
    expect(effectiveAmount(o, 2026, 12)).toBe(15)
  })
  it('null базовая цена сохраняется без изменений', () => {
    expect(effectiveAmount({ amount: null }, 2026, 7)).toBeNull()
  })
})

// ── Fixtures ──────────────────────────────────────────────
function makeAppData(overrides: Partial<AppDataExtended> = {}): AppDataExtended {
  return {
    transactions: [],
    obligations: [],
    obligationMonths: [],
    importHistory: [],
    debtResolutions: [],
    ollamaSettings: { baseUrl: 'http://localhost:11434', model: 'qwen2.5:7b', availableModels: [] },
    accountBalances: [],
    financialSnapshot: null,
    financialBrainCache: null,
    undoHistory: [],
    errorRegistry: [],
    pinSettings: { enabled: false, pinHash: null, lockoutUntil: null, failedAttempts: 0 },
    breadcrumbBuffer: [],
    customSections: [],
    changeLog: [],
    ...overrides,
  }
}

function makeBalance(
  source: 'sparkasse' | 'revolut' | 'paypal',
  balance: number,
  daysOld = 0
): AccountBalance {
  const d = new Date()
  d.setDate(d.getDate() - daysOld)
  const dateStr = d.toISOString().split('T')[0]
  // Для missing баланса updatedAt должен совпадать с balanceDate (строка YYYY-MM-DD)
  const updatedAt = balance === 0 && daysOld === 0 ? dateStr : d.toISOString()
  return {
    id: `acc-${source}`,
    source,
    balance,
    balanceDate: dateStr,
    confidence: 'ok',
    updatedAt,
  }
}

function makeObligation(overrides: Partial<Obligation> = {}): Obligation {
  return {
    id: 'ob-1',
    name: 'Netflix',
    type: 'subscription',
    amount: 15.99,
    approximateDay: 15,
    billingChain: 'sparkasse_direct',
    source: 'Sparkasse',
    isActive: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

// Создаёт ObligationMonth записи для текущего месяца со статусом 'paid',
// чтобы computeSnapshot учитывал их в knownObligations.
function paidMonthsFor(obligations: Obligation[]): ObligationMonth[] {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  return obligations.map((o) => ({
    obligationId: o.id,
    year,
    month,
    status: 'paid' as const,
    actualAmount: o.amount ?? 0,
    paidDate: now.toISOString().split('T')[0],
  }))
}

// ── Tests ─────────────────────────────────────────────────
describe('computeSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('балансы счетов', () => {
    it('возвращает riskLevel=unknown если балансы не введены', () => {
      const snap = computeSnapshot(makeAppData())
      expect(snap.riskLevel).toBe('unknown')
    })

    it('помечает баланс как missing если balance=0 и дата совпадает с updatedAt', () => {
      const data = makeAppData({ accountBalances: [makeBalance('sparkasse', 0)] })
      const snap = computeSnapshot(data)
      expect(snap.accounts[0].confidence).toBe('missing')
    })

    it('помечает баланс как stale если данные старше 14 дней', () => {
      const data = makeAppData({ accountBalances: [makeBalance('sparkasse', 1000, 15)] })
      const snap = computeSnapshot(data)
      expect(snap.accounts[0].confidence).toBe('stale')
      expect(snap.warnings.some((w) => w.code === 'BALANCE_STALE')).toBe(true)
    })

    it('не помечает как stale если данным ровно 14 дней', () => {
      const data = makeAppData({ accountBalances: [makeBalance('sparkasse', 1000, 14)] })
      const snap = computeSnapshot(data)
      expect(snap.accounts[0].confidence).toBe('ok')
    })

    it('суммирует балансы всех счетов', () => {
      const data = makeAppData({
        accountBalances: [
          makeBalance('sparkasse', 1000),
          makeBalance('revolut', 500),
          makeBalance('paypal', 200),
        ],
      })
      const snap = computeSnapshot(data)
      expect(snap.totalLiquid).toBe(1700)
    })

    it('добавляет предупреждение BALANCE_MISSING для каждого пустого счёта', () => {
      const data = makeAppData({ accountBalances: [makeBalance('sparkasse', 0)] })
      const snap = computeSnapshot(data)
      const warn = snap.warnings.find((w) => w.code === 'BALANCE_MISSING')
      expect(warn).toBeDefined()
      expect(warn?.affectedId).toBe('acc-sparkasse')
    })
  })

  describe('обязательства', () => {
    it('исключает klarna обязательства из monthlyObligations', () => {
      const obligations = [
        makeObligation({ id: 'ob-1', billingChain: 'sparkasse_direct', amount: 100 }),
        makeObligation({ id: 'ob-2', billingChain: 'klarna', amount: 50 }),
      ]
      const data = makeAppData({
        accountBalances: [makeBalance('sparkasse', 2000)],
        obligations,
        obligationMonths: paidMonthsFor(obligations),
      })
      const snap = computeSnapshot(data)
      expect(snap.monthlyObligations).toBe(100)
      expect(snap.monthlyObligationsCount).toBe(1)
    })

    it('исключает неактивные обязательства', () => {
      const obligations = [
        makeObligation({ id: 'ob-1', isActive: true, amount: 100 }),
        makeObligation({ id: 'ob-2', isActive: false, amount: 999 }),
      ]
      const data = makeAppData({
        accountBalances: [makeBalance('sparkasse', 2000)],
        obligations,
        obligationMonths: paidMonthsFor(obligations.filter((o) => o.isActive)),
      })
      const snap = computeSnapshot(data)
      expect(snap.monthlyObligations).toBe(100)
    })

    it('корректно считает monthlyObligationsCount', () => {
      const obligations = [
        makeObligation({ id: 'ob-1', amount: 10 }),
        makeObligation({ id: 'ob-2', amount: 20 }),
        makeObligation({ id: 'ob-3', amount: 30 }),
      ]
      const data = makeAppData({
        accountBalances: [makeBalance('sparkasse', 2000)],
        obligations,
        obligationMonths: paidMonthsFor(obligations),
      })
      const snap = computeSnapshot(data)
      expect(snap.monthlyObligationsCount).toBe(3)
    })

    // BUG-022: согласование движка со страницей обязательств.
    it('monthly без записи за текущий месяц считается как owed (дефолт unpaid)', () => {
      const obligations = [makeObligation({ id: 'ob-1', amount: 40, frequency: 'monthly' })]
      const data = makeAppData({
        accountBalances: [makeBalance('sparkasse', 1000)],
        obligations,
        // нет obligationMonths вообще
      })
      const snap = computeSnapshot(data)
      expect(snap.monthlyObligations).toBe(40)
      expect(snap.monthlyObligationsCount).toBe(1)
    })

    it('yearly без записи за текущий месяц НЕ считается (дефолт unknown)', () => {
      const obligations = [makeObligation({ id: 'ob-1', amount: 120, frequency: 'yearly' })]
      const data = makeAppData({
        accountBalances: [makeBalance('sparkasse', 1000)],
        obligations,
      })
      const snap = computeSnapshot(data)
      expect(snap.monthlyObligations).toBe(0)
      expect(snap.monthlyObligationsCount).toBe(0)
    })

    it('skipped обязательство исключается из месячной суммы', () => {
      const now = new Date()
      const obligations = [makeObligation({ id: 'ob-1', amount: 50, frequency: 'monthly' })]
      const data = makeAppData({
        accountBalances: [makeBalance('sparkasse', 1000)],
        obligations,
        obligationMonths: [
          {
            obligationId: 'ob-1',
            year: now.getFullYear(),
            month: now.getMonth() + 1,
            status: 'skipped',
            actualAmount: null,
          },
        ],
      })
      const snap = computeSnapshot(data)
      expect(snap.monthlyObligations).toBe(0)
      expect(snap.monthlyObligationsCount).toBe(0)
    })
  })

  describe('Klarna обязательства', () => {
    it('суммирует только активные klarna обязательства', () => {
      const data = makeAppData({
        accountBalances: [makeBalance('sparkasse', 2000)],
        obligations: [
          makeObligation({ id: 'kl-1', billingChain: 'klarna', amount: 22.19, isActive: true }),
          makeObligation({ id: 'kl-2', billingChain: 'klarna', amount: 50, isActive: false }),
        ],
      })
      const snap = computeSnapshot(data)
      expect(snap.monthlyKlarna).toBeCloseTo(22.19)
      expect(snap.monthlyKlarnaCount).toBe(1)
    })

    // BUG-022: завершённая рассрочка (оплачено >= всего платежей) не должна вычитаться
    // из «свободных денег» в месяцах после последнего платежа.
    it('исключает завершённую рассрочку Klarna из monthlyKlarna', () => {
      const now = new Date()
      const y = now.getFullYear()
      const m = now.getMonth() + 1
      const data = makeAppData({
        accountBalances: [makeBalance('sparkasse', 2000)],
        obligations: [
          makeObligation({
            id: 'kl-1',
            billingChain: 'klarna',
            amount: 25,
            isActive: true,
            frequency: 'monthly',
            totalInstallments: 2,
          }),
        ],
        obligationMonths: [
          { obligationId: 'kl-1', year: y, month: m, status: 'paid', actualAmount: 25 },
          { obligationId: 'kl-1', year: y, month: m === 1 ? 12 : m - 1, status: 'paid', actualAmount: 25 },
        ],
      })
      const snap = computeSnapshot(data)
      expect(snap.monthlyKlarna).toBe(0)
      expect(snap.monthlyKlarnaCount).toBe(0)
    })
  })

  describe('свободные средства и уровень риска', () => {
    it('правильно считает freeThisMonth', () => {
      const obligations = [makeObligation({ id: 'ob-1', amount: 200 })]
      const data = makeAppData({
        accountBalances: [makeBalance('sparkasse', 1000)],
        obligations: [
          ...obligations,
          makeObligation({ id: 'kl-1', billingChain: 'klarna', amount: 100 }),
        ],
        obligationMonths: paidMonthsFor(obligations),
      })
      const snap = computeSnapshot(data)
      expect(snap.freeThisMonth).toBeCloseTo(700)
    })

    it('добавляет предупреждение DEFICIT если freeThisMonth < 0', () => {
      const obligations = [makeObligation({ amount: 500 })]
      const data = makeAppData({
        accountBalances: [makeBalance('sparkasse', 100)],
        obligations,
        obligationMonths: paidMonthsFor(obligations),
      })
      const snap = computeSnapshot(data)
      expect(snap.freeThisMonth).toBeLessThan(0)
      expect(snap.warnings.some((w) => w.code === 'DEFICIT')).toBe(true)
    })

    it('riskLevel=safe если freeThisMonth > 15% от totalLiquid', () => {
      const obligations = [makeObligation({ amount: 100 })]
      const data = makeAppData({
        accountBalances: [makeBalance('sparkasse', 1000)],
        obligations,
        obligationMonths: paidMonthsFor(obligations),
      })
      const snap = computeSnapshot(data)
      expect(snap.riskLevel).toBe('safe')
    })

    it('riskLevel=tight если freeThisMonth < 15% от totalLiquid', () => {
      const obligations = [makeObligation({ amount: 870 })]
      const data = makeAppData({
        accountBalances: [makeBalance('sparkasse', 1000)],
        obligations,
        obligationMonths: paidMonthsFor(obligations),
      })
      const snap = computeSnapshot(data)
      expect(snap.riskLevel).toBe('tight')
    })

    it('riskLevel=critical если freeThisMonth < 0', () => {
      const obligations = [makeObligation({ amount: 500 })]
      const data = makeAppData({
        accountBalances: [makeBalance('sparkasse', 100)],
        obligations,
        obligationMonths: paidMonthsFor(obligations),
      })
      const snap = computeSnapshot(data)
      expect(snap.riskLevel).toBe('critical')
    })

    it('riskLevel=unknown если нет реального баланса', () => {
      const snap = computeSnapshot(makeAppData())
      expect(snap.riskLevel).toBe('unknown')
      expect(snap.warnings.some((w) => w.code === 'RISK_UNKNOWN')).toBe(true)
    })
  })
})
