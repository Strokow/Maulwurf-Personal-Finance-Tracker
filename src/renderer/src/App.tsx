import { useState, useEffect, useCallback } from 'react'
import { Home } from './pages/Home'
import { PinLock } from './components/PinLock'

interface PinStatus {
  enabled: boolean
  locked: boolean
  lockoutUntil: string | null
  attemptsLeft: number
}

function App(): React.JSX.Element {
  const [unlocked, setUnlocked] = useState(false)
  const [status, setStatus] = useState<PinStatus | null>(null)

  const refreshStatus = useCallback(async () => {
    const s = (await window.api.pin.status()) as PinStatus
    setStatus(s)
  }, [])

  useEffect(() => {
    refreshStatus()
  }, [refreshStatus])

  if (!status) {
    return <div className="h-screen w-screen bg-neutral-950" />
  }

  if (!unlocked) {
    return (
      <PinLock
        isGate
        status={status}
        onUnlock={() => setUnlocked(true)}
        onSetup={async (pin) => {
          await window.api.pin.set(pin)
          await refreshStatus()
        }}
        onDisable={async (pin) => {
          const result = (await window.api.pin.disable(pin)) as { success: boolean }
          return result.success
        }}
      />
    )
  }

  return <Home />
}

export default App
