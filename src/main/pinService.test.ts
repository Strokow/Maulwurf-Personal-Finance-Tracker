import { describe, it, expect } from 'vitest'
import { hashPin, verifyPin, type PinSettings } from './pinService'

function makePin(overrides: Partial<PinSettings> = {}): PinSettings {
  return {
    enabled: true,
    pinHash: hashPin('123456'),
    lockoutUntil: null,
    failedAttempts: 0,
    ...overrides
  }
}

describe('hashPin', () => {
  it('возвращает строку длиной 64 символа (SHA-256 hex)', () => {
    expect(hashPin('123456')).toHaveLength(64)
  })

  it('один и тот же PIN всегда даёт одинаковый хэш', () => {
    expect(hashPin('123456')).toBe(hashPin('123456'))
  })

  it('разные PIN дают разные хэши', () => {
    expect(hashPin('123456')).not.toBe(hashPin('567890'))
  })

  it('не хранит PIN в открытом виде', () => {
    expect(hashPin('123456')).not.toContain('123456')
  })

  it('хэш одинаковый для PIN с одинаковым регистром', () => {
    expect(hashPin('ABCD')).toBe(hashPin('ABCD'))
  })

  it('хэш разный для PIN с разным регистром', () => {
    expect(hashPin('abcd')).not.toBe(hashPin('ABCD'))
  })

  it('работает с специальными символами', () => {
    const hash1 = hashPin('12!@34')
    const hash2 = hashPin('12!@34')
    expect(hash1).toBe(hash2)
    expect(hash1).toHaveLength(64)
  })

  it('работает с пустым PIN', () => {
    const hash = hashPin('')
    expect(hash).toHaveLength(64)
  })

  it('работает с длинным PIN', () => {
    const hash = hashPin('1234567890123456')
    expect(hash).toHaveLength(64)
  })
})

describe('verifyPin', () => {
  it('возвращает success=true для верного PIN', () => {
    const result = verifyPin('123456', makePin())
    expect(result.success).toBe(true)
    expect(result.locked).toBe(false)
  })

  it('возвращает success=false для неверного PIN', () => {
    const result = verifyPin('999999', makePin())
    expect(result.success).toBe(false)
  })

  it('уменьшает attemptsLeft при неверном вводе', () => {
    const result = verifyPin('999999', makePin({ failedAttempts: 1 }))
    expect(result.attemptsLeft).toBe(1)
  })

  it('возвращает attemptsLeft=2 после первой неудачной попытки', () => {
    const result = verifyPin('999999', makePin({ failedAttempts: 0 }))
    expect(result.attemptsLeft).toBe(2)
  })

  it('возвращает attemptsLeft=1 после второй неудачной попытки', () => {
    const result = verifyPin('999999', makePin({ failedAttempts: 1 }))
    expect(result.attemptsLeft).toBe(1)
  })

  it('возвращает attemptsLeft=0 после третьей неудачной попытки', () => {
    const result = verifyPin('999999', makePin({ failedAttempts: 2 }))
    expect(result.attemptsLeft).toBe(0)
  })

  it('блокирует после 3 неверных попыток', () => {
    const result = verifyPin('999999', makePin({ failedAttempts: 2 }))
    expect(result.locked).toBe(true)
    expect(result.lockoutUntil).toBeDefined()
  })

  it('возвращает locked=true если lockoutUntil в будущем', () => {
    const future = new Date(Date.now() + 60000).toISOString()
    const result = verifyPin('123456', makePin({ lockoutUntil: future }))
    expect(result.locked).toBe(true)
    expect(result.success).toBe(false)
  })

  it('разрешает вход если lockoutUntil в прошлом', () => {
    const past = new Date(Date.now() - 60000).toISOString()
    const result = verifyPin('123456', makePin({ lockoutUntil: past }))
    expect(result.success).toBe(true)
  })

  it('сбрасывает блокировку после истечения lockoutUntil', () => {
    const past = new Date(Date.now() - 60000).toISOString()
    const result = verifyPin('123456', makePin({ lockoutUntil: past, failedAttempts: 3 }))
    expect(result.success).toBe(true)
    expect(result.locked).toBe(false)
  })

  it('возвращает правильный lockoutUntil при блокировке', () => {
    const result = verifyPin('999999', makePin({ failedAttempts: 2 }))
    expect(result.lockoutUntil).toBeDefined()
    const lockoutDate = new Date(result.lockoutUntil!)
    const expectedDate = new Date(Date.now() + 5 * 60000)
    expect(lockoutDate.getTime()).toBeGreaterThanOrEqual(expectedDate.getTime() - 1000)
    expect(lockoutDate.getTime()).toBeLessThanOrEqual(expectedDate.getTime() + 1000)
  })

  it('верный PIN после блокировки в прошлом не сбрасывает failedAttempts в результате', () => {
    const past = new Date(Date.now() - 60000).toISOString()
    const result = verifyPin('123456', makePin({ lockoutUntil: past, failedAttempts: 3 }))
    expect(result.success).toBe(true)
    expect(result.attemptsLeft).toBe(3)
  })
})
