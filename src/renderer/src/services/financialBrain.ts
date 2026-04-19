import { safeOllamaCall, validateBrainResult } from './ollamaService'
import { FinancialSnapshot, OllamaResult, FinancialBrainResult } from '../types'

export async function analyzeFinances(
  snapshot: FinancialSnapshot,
  baseUrl: string,
  model: string
): Promise<OllamaResult<FinancialBrainResult>> {
  if (snapshot.riskLevel === 'unknown') {
    return {
      success: false,
      validationErrors: ['Невозможно запустить анализ: балансы счетов не введены.'],
      model,
      durationMs: 0,
      timestamp: new Date().toISOString(),
    }
  }
  const prompt = `Personal finance analyst. Respond ONLY with valid JSON, no markdown.

Today: ${new Date().toISOString().split('T')[0]}
Accounts: ${snapshot.accounts
    .map((a) => `${a.source}:${a.balance}€(${a.confidence})`)
    .join(', ')}
Total liquid: ${snapshot.totalLiquid}€
Monthly obligations: ${snapshot.monthlyObligations}€ (${snapshot.monthlyObligationsCount} items)
Monthly Klarna: ${snapshot.monthlyKlarna}€ (${snapshot.monthlyKlarnaCount} items)
Free this month: ${snapshot.freeThisMonth}€
Risk: ${snapshot.riskLevel}
Upcoming 14d: ${snapshot.upcomingPayments
    .map(
      (p) =>
        `${p.dueDate}:${p.name}:${p.amount}€${p.riskFlag ? ':RISK' : ''}`
    )
    .join(', ')}
Warnings: ${snapshot.warnings.map((w) => w.code).join(', ') || 'none'}

Return JSON:
{
  "priority_action": "string (max 12 words, Russian)",
  "weekly_summary": "string (max 2 sentences, Russian)",
  "alerts": [{"message":"string (max 15 words, Russian)","urgency":"high|medium|low"}],
  "tip": "string (max 15 words, Russian)"
}`
  return safeOllamaCall<FinancialBrainResult>(prompt, baseUrl, model, validateBrainResult)
}
