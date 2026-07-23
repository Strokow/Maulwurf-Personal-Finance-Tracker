// ── Массовый ввод рассрочек (Фаза 4): парсер структурных строк ────────────────
// Формат строки: «Название | Сумма/мес | ВсегоПлатежей | Оплачено | ДатаСледующего(YYYY-MM-DD)».
// Пустые строки игнорируются; невалидные попадают в errors с номером строки.

export interface KlarnaBulkEntry {
  name: string
  monthly: number
  totalInst: number
  paid: number
  nextDate: string
}

export function parseKlarnaBulkLines(text: string): { valid: KlarnaBulkEntry[]; errors: string[] } {
  const valid: KlarnaBulkEntry[] = []
  const errors: string[] = []
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  lines.forEach((line, idx) => {
    const n = idx + 1
    const parts = line.split('|').map((p) => p.trim())
    if (parts.length < 5) {
      errors.push(`Строка ${n}: нужно 5 полей через "|"`)
      return
    }
    const [name, monthlyStr, totalStr, paidStr, nextDate] = parts
    const monthly = parseFloat(monthlyStr.replace(',', '.'))
    const totalInst = parseInt(totalStr, 10)
    const paidRaw = parseInt(paidStr, 10)
    if (!name) {
      errors.push(`Строка ${n}: пустое название`)
      return
    }
    if (isNaN(monthly) || monthly <= 0) {
      errors.push(`Строка ${n}: сумма/мес`)
      return
    }
    if (isNaN(totalInst) || totalInst < 1) {
      errors.push(`Строка ${n}: всего платежей`)
      return
    }
    const [y, m, d] = nextDate.split('-').map(Number)
    if (!y || !m || !d || isNaN(y) || isNaN(m) || isNaN(d)) {
      errors.push(`Строка ${n}: дата YYYY-MM-DD`)
      return
    }
    // Оплачено clamp'ится в [0, totalInst].
    const paid = isNaN(paidRaw) ? 0 : Math.max(0, Math.min(paidRaw, totalInst))
    valid.push({ name, monthly, totalInst, paid, nextDate })
  })
  return { valid, errors }
}
