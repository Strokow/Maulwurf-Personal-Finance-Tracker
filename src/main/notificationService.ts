import { Notification } from 'electron'
import type { FinancialSnapshot } from '../renderer/src/types'

export function checkAndNotify(snapshot: FinancialSnapshot | null): void {
  if (!snapshot || snapshot.riskLevel === 'unknown') return

  const urgent = snapshot.upcomingPayments.filter((p) => {
    const ms = new Date(p.dueDate).getTime() - Date.now()
    return ms >= 0 && ms <= 3 * 86400000
  })

  if (urgent.length === 0) return

  const risky = urgent.filter((p) => p.riskFlag)
  if (risky.length > 0) {
    new Notification({
      title: '⚠️ Maulwurf — риск просрочки',
      body: `${risky[0].name}: ${risky[0].amount}€ к ${risky[0].dueDate}. Проверь баланс.`,
    }).show()
  } else {
    new Notification({
      title: 'Maulwurf — платежи на этой неделе',
      body: urgent.map((p) => `${p.name} ${p.amount}€`).join(' · '),
    }).show()
  }
}
