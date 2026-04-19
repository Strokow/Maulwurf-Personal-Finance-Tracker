/**
 * Hybrid chat engine: deterministic answers for factual questions,
 * AI (Ollama) only for advice and complex reasoning.
 */
import type { Obligation, ObligationMonth, ObligationSection, FinancialSnapshot } from '../types'

const GENITIVE_MONTHS = [
  '',
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря'
]

const NOM_MONTHS = [
  '',
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь'
]

// ── Types ──────────────────────────────────────────────────
export interface ChatContext {
  obligations: Obligation[]
  obligationMonths: ObligationMonth[]
  customSections: ObligationSection[]
  snapshot: FinancialSnapshot | null
  year: number
  month: number
}

interface ObligationWithStatus {
  name: string
  amount: number | null
  status: 'paid' | 'unpaid' | 'unknown'
  frequency: string
  section: string
}

export interface DeterministicResult {
  answer: string
  handled: boolean // true = no need to call AI
}

// ── Helpers ────────────────────────────────────────────────
function fmt(n: number): string {
  return n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
}

/** Maps all common Russian month forms (nominative, genitive, prepositional) to 1-12 */
const MONTH_FORMS: Record<string, number> = {
  январь: 1, января: 1, январе: 1,
  февраль: 2, февраля: 2, феврале: 2,
  март: 3, марта: 3, марте: 3,
  апрель: 4, апреля: 4, апреле: 4,
  май: 5, мая: 5, мае: 5,
  июнь: 6, июня: 6, июне: 6,
  июль: 7, июля: 7, июле: 7,
  август: 8, августа: 8, августе: 8,
  сентябрь: 9, сентября: 9, сентябре: 9,
  октябрь: 10, октября: 10, октябре: 10,
  ноябрь: 11, ноября: 11, ноябре: 11,
  декабрь: 12, декабря: 12, декабре: 12,
}

/** Detect explicit month (and optional year) in query; returns overridden {year, month} or null */
function parseMonthFromQuery(q: string, defaultYear: number): { year: number; month: number } | null {
  const monthPattern = Object.keys(MONTH_FORMS).join('|')
  const re = new RegExp(`(?:${monthPattern})(?:\\s+(\\d{4}))?`, 'i')
  const m = re.exec(q)
  if (!m) return null
  const monthWord = m[0].replace(/\s+\d{4}$/, '').toLowerCase()
  const month = MONTH_FORMS[monthWord]
  if (!month) return null
  const year = m[1] ? parseInt(m[1], 10) : defaultYear
  return { year, month }
}

function getObligationsWithStatus(ctx: ChatContext): ObligationWithStatus[] {
  const active = ctx.obligations.filter((o) => o.isActive)
  return active.map((o) => {
    const rec = ctx.obligationMonths.find(
      (m) => m.obligationId === o.id && m.year === ctx.year && m.month === ctx.month
    )
    // No record = not paid yet this month
    const status = rec?.status === 'paid' ? 'paid' : rec?.status === 'unknown' ? 'unknown' : 'unpaid'
    const freq = o.frequency ?? 'monthly'
    const section = o.sectionId
      ? (ctx.customSections.find((s) => s.id === o.sectionId)?.name ?? '')
      : freq === 'yearly'
        ? 'Ежегодные'
        : 'Ежемесячные'
    return { name: o.name, amount: o.amount, status, frequency: freq, section }
  })
}

// ── Pattern matchers ───────────────────────────────────────
const PATTERNS = {
  howMuchOwe: /сколько.*(?:долж|задолж|плат|оплат|должен|оста[лв]|неоплач)/i,
  whatUnpaid: /(?:не\s*оплач|неоплач|не\s*заплач|не\s*заплат|задолж)/i,
  whatPaid: /(?:что|какие?).*(?:оплач|заплач)/i,
  statusAll: /(?:стату[сы]|обзор|итог|список|все\s*обяз)/i,
  freeMoney: /(?:сколько.*свобод|свобод.*ден|остат|остан|хватит|бюджет|лик[ви])/i,
  summary: /(?:подведи.*итог|резюме|саммари|summary|общ[аи].*картин)/i
}

// ── Deterministic answer builder ───────────────────────────
export function tryDeterministicAnswer(query: string, ctx: ChatContext): DeterministicResult {
  const q = query.toLowerCase().trim()

  // Override month/year if the user mentions a specific month in the query
  const parsedMonth = parseMonthFromQuery(q, ctx.year)
  if (parsedMonth) {
    ctx = { ...ctx, year: parsedMonth.year, month: parsedMonth.month }
  }

  const monthLabel = `${NOM_MONTHS[ctx.month]} ${ctx.year}`
  const all = getObligationsWithStatus(ctx)
  const unpaid = all.filter((o) => o.status === 'unpaid')
  const paid = all.filter((o) => o.status === 'paid')
  const unknown = all.filter((o) => o.status === 'unknown')

  const unpaidTotal = unpaid.reduce((s, o) => s + (o.amount ?? 0), 0)
  const paidTotal = paid.reduce((s, o) => s + (o.amount ?? 0), 0)

  // How much do I owe?
  if (PATTERNS.howMuchOwe.test(q)) {
    if (unpaid.length === 0) {
      return {
        handled: true,
        answer: `📊 **${monthLabel}**\n\nВсе обязательства оплачены! ✅\nОплачено: ${paid.length} шт. на ${fmt(paidTotal)}${unknown.length > 0 ? `\nНеизвестный статус: ${unknown.length} шт.` : ''}`
      }
    }
    const list = unpaid
      .map((o) => `• ${o.name}: ${o.amount != null ? fmt(o.amount) : 'сумма ?'}`)
      .join('\n')
    return {
      handled: true,
      answer: `📊 **Неоплачено за ${monthLabel}**\n\n${list}\n\n**Итого: ${fmt(unpaidTotal)}**${unpaid.length !== unpaid.filter((o) => o.amount != null).length ? ' (у некоторых сумма неизвестна)' : ''}`
    }
  }

  // What's unpaid? (MUST be checked before whatPaid)
  if (PATTERNS.whatUnpaid.test(q)) {
    if (unpaid.length === 0) {
      return { handled: true, answer: `📊 За ${monthLabel} всё оплачено! ✅` }
    }
    const list = unpaid
      .map((o) => `❌ ${o.name}: ${o.amount != null ? fmt(o.amount) : 'сумма ?'}`)
      .join('\n')
    return {
      handled: true,
      answer: `📊 **Не оплачено за ${monthLabel}**\n\n${list}\n\n**Итого: ${fmt(unpaidTotal)}**`
    }
  }

  // What's paid?
  if (PATTERNS.whatPaid.test(q)) {
    if (paid.length === 0) {
      return { handled: true, answer: `За ${monthLabel} пока ничего не оплачено.` }
    }
    const list = paid
      .map((o) => `✅ ${o.name}: ${o.amount != null ? fmt(o.amount) : '?'}`)
      .join('\n')
    return {
      handled: true,
      answer: `📊 **Оплачено за ${monthLabel}**\n\n${list}\n\n**Итого: ${fmt(paidTotal)}** (${paid.length} шт.)`
    }
  }

  // Free money
  if (PATTERNS.freeMoney.test(q)) {
    if (!ctx.snapshot) {
      return {
        handled: true,
        answer: 'Не могу рассчитать — введите балансы счетов на вкладке Dashboard.'
      }
    }
    const s = ctx.snapshot
    const lines = [
      `📊 **Финансовая сводка — ${monthLabel}**`,
      '',
      `💰 Ликвидность: **${fmt(s.totalLiquid)}**`,
      `📋 Обязательства: **${fmt(s.monthlyObligations)}**/мес`,
      s.monthlyKlarna > 0 ? `🔄 Klarna: **${fmt(s.monthlyKlarna)}**/мес` : null,
      `💵 Свободно: **${fmt(s.freeThisMonth)}**`,
      '',
      `Риск: **${s.riskLevel === 'safe' ? '🟢 Безопасно' : s.riskLevel === 'tight' ? '🟡 Бюджет натянут' : s.riskLevel === 'critical' ? '🔴 Критично' : '⚪ Неизвестно'}**`
    ]
    return { handled: true, answer: lines.filter(Boolean).join('\n') }
  }

  // Full summary / status
  if (PATTERNS.statusAll.test(q) || PATTERNS.summary.test(q)) {
    const lines = [`📊 **Обзор обязательств — ${monthLabel}**`, '']

    if (paid.length > 0) {
      lines.push(`**Оплачено (${paid.length}):**`)
      paid.forEach((o) => lines.push(`✅ ${o.name}: ${o.amount != null ? fmt(o.amount) : '?'}`))
      lines.push('')
    }
    if (unpaid.length > 0) {
      lines.push(`**Не оплачено (${unpaid.length}):**`)
      unpaid.forEach((o) => lines.push(`❌ ${o.name}: ${o.amount != null ? fmt(o.amount) : '?'}`))
      lines.push('')
    }
    if (unknown.length > 0) {
      lines.push(`**Неизвестный статус (${unknown.length}):**`)
      unknown.forEach((o) => lines.push(`⚪ ${o.name}: ${o.amount != null ? fmt(o.amount) : '?'}`))
      lines.push('')
    }
    lines.push(`**Итого неоплачено: ${fmt(unpaidTotal)}** | Оплачено: ${fmt(paidTotal)}`)
    if (ctx.snapshot) {
      lines.push(`💵 Свободно после обязательств: **${fmt(ctx.snapshot.freeThisMonth)}**`)
    }
    return { handled: true, answer: lines.join('\n') }
  }

  // Not matched — pass to AI
  return { handled: false, answer: '' }
}

// ── Minimal AI system prompt (only for advice/complex questions) ──
export function buildAiSystemPrompt(ctx: ChatContext, query?: string): string {
  // Override month/year if the user mentions a specific month
  if (query) {
    const parsedMonth = parseMonthFromQuery(query.toLowerCase(), ctx.year)
    if (parsedMonth) {
      ctx = { ...ctx, year: parsedMonth.year, month: parsedMonth.month }
    }
  }

  const all = getObligationsWithStatus(ctx)
  const unpaid = all.filter((o) => o.status === 'unpaid')
  const paid = all.filter((o) => o.status === 'paid')
  const unpaidTotal = unpaid.reduce((s, o) => s + (o.amount ?? 0), 0)
  const paidTotal = paid.reduce((s, o) => s + (o.amount ?? 0), 0)

  const oblLines = all
    .map(
      (o) =>
        `${o.name}: ${o.amount != null ? '€' + o.amount : '?'} [${o.status === 'paid' ? 'оплачено' : o.status === 'unpaid' ? 'не оплачено' : 'неизвестно'}]`
    )
    .join('\n')

  let finCtx = ''
  if (ctx.snapshot) {
    finCtx = `Баланс: €${ctx.snapshot.totalLiquid.toFixed(0)}, свободно: €${ctx.snapshot.freeThisMonth.toFixed(0)}, риск: ${ctx.snapshot.riskLevel}`
  }

  return `Ты финансовый советник. Кратко, по-русски, 2-4 предложения.

Месяц: ${GENITIVE_MONTHS[ctx.month]} ${ctx.year}
${finCtx}

Неоплачено: ${unpaid.length} шт. на €${unpaidTotal.toFixed(2)}
Оплачено: ${paid.length} шт. на €${paidTotal.toFixed(2)}

${oblLines}

Числа уже посчитаны — НЕ пересчитывай. Просто давай совет или отвечай на вопрос.`
}
