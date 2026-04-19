import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { X, Lock, AlertTriangle } from 'lucide-react'

interface PinLockProps {
  onUnlock: () => void
  onSetup: (pin: string) => Promise<void>
  onDisable: (pin: string) => Promise<boolean>
  status: {
    enabled: boolean
    locked: boolean
    lockoutUntil: string | null
    attemptsLeft: number
  }
  isGate?: boolean
}

export function PinLock({ onUnlock, onSetup, onDisable, status, isGate = false }: PinLockProps) {
  const [inputPin, setInputPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [mode, setMode] = useState<'verify' | 'setup' | 'disable'>('verify')
  const [error, setError] = useState('')
  const [countdown, setCountdown] = useState('')
  const gateInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isGate && mode === 'verify' && !status.locked) {
      gateInputRef.current?.focus()
    }
  }, [isGate, mode, status.locked])

  useEffect(() => {
    if (status.locked && status.lockoutUntil) {
      const updateCountdown = () => {
        const now = Date.now()
        const lockoutTime = new Date(status.lockoutUntil!).getTime()
        const diff = lockoutTime - now
        if (diff <= 0) {
          setCountdown('')
          return
        }
        const mins = Math.floor(diff / 60000)
        const secs = Math.floor((diff % 60000) / 1000)
        setCountdown(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`)
      }
      updateCountdown()
      const interval = setInterval(updateCountdown, 1000)
      return () => clearInterval(interval)
    }
    return undefined
  }, [status.locked, status.lockoutUntil])

  const handleVerify = async () => {
    if (inputPin.length !== 6) {
      setError('PIN должен содержать 6 цифр')
      return
    }
    try {
      const result = await window.api.pin.verify(inputPin) as {
        success: boolean
        locked: boolean
        attemptsLeft: number
        lockoutUntil?: string
      }
      if (result.success) {
        onUnlock()
      } else if (result.locked) {
        setError('Слишком много попыток. Попробуйте позже.')
      } else {
        setError(`Неверный PIN. Осталось попыток: ${result.attemptsLeft}`)
      }
    } catch (e) {
      setError(`Ошибка: ${e instanceof Error ? e.message : String(e)}`)
    }
    setInputPin('')
  }

  const handleSetup = async () => {
    if (newPin.length !== 6) {
      setError('PIN должен содержать 6 цифр')
      return
    }
    if (newPin !== confirmPin) {
      setError('PIN не совпадает')
      return
    }
    try {
      await onSetup(newPin)
      onUnlock()
    } catch (e) {
      setError(`Ошибка: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handleDisable = async () => {
    try {
      const success = await onDisable(newPin)
      if (success) {
        onUnlock()
      } else {
        setError('Неверный PIN')
      }
    } catch (e) {
      setError(`Ошибка: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handleNumericClick = (digit: string) => {
    if (mode === 'verify') {
      if (inputPin.length < 6) setInputPin(inputPin + digit)
    } else if (mode === 'setup') {
      if (newPin.length < 6) setNewPin(newPin + digit)
    } else if (mode === 'disable') {
      if (inputPin.length < 6) setInputPin(inputPin + digit)
    }
    setError('')
  }

  const handleBackspace = () => {
    if (mode === 'verify') {
      setInputPin(inputPin.slice(0, -1))
    } else if (mode === 'setup') {
      setNewPin(newPin.slice(0, -1))
    } else if (mode === 'disable') {
      setInputPin(inputPin.slice(0, -1))
    }
  }

  if (!status.enabled && mode !== 'setup') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-neutral-200">Настройка PIN</h2>
            {!isGate && (
              <button onClick={onUnlock} className="text-neutral-400 hover:text-neutral-200">
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
          <p className="text-sm text-neutral-400 mb-4">
            Придумайте 6-значный PIN для защиты приложения
          </p>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-neutral-500">Новый PIN</label>
              <input
                type="password"
                maxLength={6}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-center text-2xl tracking-widest text-neutral-200"
                placeholder="••••••"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-500">Подтвердите PIN</label>
              <input
                type="password"
                maxLength={6}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-center text-2xl tracking-widest text-neutral-200"
                placeholder="••••••"
              />
            </div>
            {error && (
              <p className="text-sm text-red-400 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                {error}
              </p>
            )}
            <button
              onClick={handleSetup}
              disabled={newPin.length !== 6 || confirmPin.length !== 6}
              className="w-full rounded bg-green-900/50 py-2.5 text-sm font-medium text-green-300 hover:bg-green-900 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Установить PIN
            </button>
          </div>
        </motion.div>
      </div>
    )
  }

  if (isGate && mode === 'verify') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-8"
        >
          {status.locked && countdown ? (
            <div className="text-center py-4">
              <AlertTriangle className="h-12 w-12 text-orange-500 mx-auto mb-4" />
              <p className="text-neutral-300 mb-2">Слишком много неудачных попыток</p>
              <p className="text-3xl font-mono text-orange-400">{countdown}</p>
            </div>
          ) : (
            <>
              <h2 className="text-center text-lg font-medium text-neutral-200 mb-6">
                Ввести PIN
              </h2>
              <input
                ref={gateInputRef}
                type="password"
                inputMode="numeric"
                autoFocus
                maxLength={6}
                value={inputPin}
                onChange={(e) => {
                  setInputPin(e.target.value.replace(/\D/g, '').slice(0, 6))
                  setError('')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && inputPin.length === 6) {
                    handleVerify()
                  }
                }}
                className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-3 text-center text-2xl tracking-[0.5em] text-neutral-200 mb-4 focus:border-green-600 focus:outline-none"
                placeholder="••••••"
              />
              <button
                type="button"
                onClick={handleVerify}
                disabled={inputPin.length !== 6}
                className="w-full rounded bg-green-900/50 py-2.5 text-sm font-medium text-green-300 hover:bg-green-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Войти
              </button>
              {error && (
                <p className="text-sm text-red-400 text-center mt-4 flex items-center justify-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  {error}
                </p>
              )}
            </>
          )}
        </motion.div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-200 flex items-center gap-2">
            <Lock className="h-5 w-5" />
            {mode === 'verify' ? 'Введите PIN' : mode === 'setup' ? 'Новый PIN' : 'Отключить PIN'}
          </h2>
          {!isGate && (
            <button onClick={onUnlock} className="text-neutral-400 hover:text-neutral-200">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {status.locked && countdown ? (
          <div className="text-center py-8">
            <AlertTriangle className="h-12 w-12 text-orange-500 mx-auto mb-4" />
            <p className="text-neutral-300 mb-2">Слишком много неудачных попыток</p>
            <p className="text-3xl font-mono text-orange-400">{countdown}</p>
          </div>
        ) : (
          <>
            {/* PIN display */}
            <div className="flex justify-center gap-2 mb-6">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className={`w-10 h-12 rounded-lg border-2 flex items-center justify-center text-2xl font-bold transition-all ${
                    (mode === 'verify' ? inputPin : newPin).length > i
                      ? 'border-green-600 bg-green-900/20 text-green-400'
                      : 'border-neutral-700 bg-neutral-800 text-transparent'
                  }`}
                >
                  •
                </div>
              ))}
            </div>

            {/* Numeric keypad */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                <button
                  key={digit}
                  onClick={() => handleNumericClick(digit)}
                  className="h-14 rounded-lg bg-neutral-800 text-xl font-medium text-neutral-200 hover:bg-neutral-700 transition-colors"
                >
                  {digit}
                </button>
              ))}
              <button
                onClick={handleBackspace}
                className="h-14 rounded-lg bg-neutral-800 text-neutral-400 hover:bg-neutral-700 transition-colors"
              >
                ←
              </button>
              <button
                onClick={() => handleNumericClick('0')}
                className="h-14 rounded-lg bg-neutral-800 text-xl font-medium text-neutral-200 hover:bg-neutral-700 transition-colors"
              >
                0
              </button>
              <button
                onClick={mode === 'verify' ? handleVerify : mode === 'setup' ? handleSetup : handleDisable}
                className="h-14 rounded-lg bg-green-900/50 text-green-300 hover:bg-green-900 transition-colors font-medium"
              >
                OK
              </button>
            </div>

            {error && (
              <p className="text-sm text-red-400 text-center mb-4 flex items-center justify-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                {error}
              </p>
            )}

            {!status.locked && (
              <div className="flex items-center justify-between text-xs text-neutral-500">
                <span>Осталось попыток: {status.attemptsLeft}</span>
                {!isGate && (
                  <button
                    onClick={() => {
                      setMode('setup')
                      setError('')
                      setInputPin('')
                      setNewPin('')
                      setConfirmPin('')
                    }}
                    className="text-neutral-400 hover:text-neutral-200"
                  >
                    Сменить PIN
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </motion.div>
    </div>
  )
}
