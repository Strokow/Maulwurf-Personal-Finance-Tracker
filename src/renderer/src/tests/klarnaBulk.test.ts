import { describe, it, expect } from 'vitest'
import { parseKlarnaBulkLines } from '../utils/klarnaBulk'

describe('parseKlarnaBulkLines (Фаза 4 — массовый ввод рассрочек)', () => {
  it('валидная строка парсится', () => {
    const { valid, errors } = parseKlarnaBulkLines('DJI | 25.00 | 12 | 5 | 2026-08-15')
    expect(errors).toHaveLength(0)
    expect(valid).toEqual([
      { name: 'DJI', monthly: 25, totalInst: 12, paid: 5, nextDate: '2026-08-15' },
    ])
  })

  it('несколько строк, пустые игнорируются', () => {
    const { valid } = parseKlarnaBulkLines(
      'DJI | 25 | 12 | 5 | 2026-08-15\n\n  \nAmazon | 14.9 | 6 | 0 | 2026-08-01'
    )
    expect(valid).toHaveLength(2)
    expect(valid[1].name).toBe('Amazon')
  })

  it('запятая как десятичный разделитель суммы', () => {
    const { valid } = parseKlarnaBulkLines('X | 14,90 | 6 | 0 | 2026-08-01')
    expect(valid[0].monthly).toBeCloseTo(14.9)
  })

  it('«оплачено» clamp в [0, total]', () => {
    expect(parseKlarnaBulkLines('X | 10 | 6 | 99 | 2026-08-01').valid[0].paid).toBe(6)
    expect(parseKlarnaBulkLines('Y | 10 | 6 | -3 | 2026-08-01').valid[0].paid).toBe(0)
  })

  it('ошибки валидации с номером строки', () => {
    expect(parseKlarnaBulkLines('DJI | 25 | 12').errors[0]).toMatch(/5 полей/)
    expect(parseKlarnaBulkLines('| 25 | 12 | 5 | 2026-08-15').errors[0]).toMatch(/название/)
    expect(parseKlarnaBulkLines('DJI | 0 | 12 | 5 | 2026-08-15').errors[0]).toMatch(/сумма/)
    expect(parseKlarnaBulkLines('DJI | 25 | 0 | 5 | 2026-08-15').errors[0]).toMatch(/всего/)
    expect(parseKlarnaBulkLines('DJI | 25 | 12 | 5 | baddate').errors[0]).toMatch(/дата/)
  })

  it('валидные и невалидные строки разделяются', () => {
    const { valid, errors } = parseKlarnaBulkLines('DJI | 25 | 12 | 5 | 2026-08-15\nbad line')
    expect(valid).toHaveLength(1)
    expect(errors).toHaveLength(1)
  })
})
