import { createHash } from 'crypto'

const LOCKOUT_MINUTES = 5
const MAX_ATTEMPTS = 3
const SALT = 'finance-tracker-salt-2026'

export interface PinSettings {
  enabled: boolean
  pinHash: string | null
  lockoutUntil: string | null
  failedAttempts: number
}

export function hashPin(pin: string): string {
  return createHash('sha256').update(pin + SALT).digest('hex')
}

export function verifyPin(
  input: string,
  stored: PinSettings
): {
  success: boolean
  locked: boolean
  attemptsLeft: number
  lockoutUntil?: string
} {
  if (stored.lockoutUntil) {
    if (new Date(stored.lockoutUntil) > new Date()) {
      return {
        success: false,
        locked: true,
        attemptsLeft: 0,
        lockoutUntil: stored.lockoutUntil,
      }
    }
  }
  if (hashPin(input) === stored.pinHash) {
    return { success: true, locked: false, attemptsLeft: MAX_ATTEMPTS }
  }
  const attempts = stored.failedAttempts + 1
  const locked = attempts >= MAX_ATTEMPTS
  const lockoutUntil = locked
    ? new Date(Date.now() + LOCKOUT_MINUTES * 60000).toISOString()
    : undefined
  return {
    success: false,
    locked,
    attemptsLeft: MAX_ATTEMPTS - attempts,
    lockoutUntil,
  }
}
