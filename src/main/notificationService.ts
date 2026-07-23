import { Notification } from 'electron'
import type { FinancialSnapshot } from '../renderer/src/types'

// OS-нотификация сужена до critical-risk (Фаза 8, 2A.4): показывает ТОЛЬКО платежи
// с riskFlag (баланса может не хватить) в ближайшие 3 дня — то, ради чего стоит
// вытащить пользователя из другого окна. Информационные «за 3 дня»/«1-е число»/
// «много неоплаченного» живут исключительно как in-app тосты (renderer), поэтому
// двойного «за 3 дня» не возникает. Всё гейтится флагом notificationsEnabled.
export function checkAndNotify(snapshot: FinancialSnapshot | null, enabled: boolean): void {
  if (!enabled) return
  if (!snapshot || snapshot.riskLevel === 'unknown') return

  const risky = snapshot.upcomingPayments.filter((p) => {
    if (!p.riskFlag) return false
    const ms = new Date(p.dueDate).getTime() - Date.now()
    return ms >= 0 && ms <= 3 * 86400000
  })

  if (risky.length === 0) return

  new Notification({
    title: '⚠️ Maulwurf — риск просрочки',
    body: `${risky[0].name}: ${risky[0].amount}€ к ${risky[0].dueDate}. Проверь баланс.`,
  }).show()
}
