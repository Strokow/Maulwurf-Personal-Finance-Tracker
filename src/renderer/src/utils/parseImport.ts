import type { Transaction } from '../types'

const VALID_SOURCES = new Set([
  'Deutsche Bank',
  'Sparkasse',
  'Revolut',
  'PayPal',
  'Klarna',
  'Vodafone',
  'Пятак',
  'Other'
])

const VALID_TYPES = new Set(['payment', 'income', 'failed_debit', 'penalty'])

const VALID_SPARKASSE_TYPES = new Set(['ruecklastschrift', 'wiedergutschrift', 'entgelt', 'normal'])
const VALID_CHAINS = new Set(['sparkasse_direct', 'paypal', 'vodafone_contract', 'klarna', 'revolut_paypal'])

function detectSparkasseType(desc: string): Transaction['sparkasseType'] {
  const upper = desc.toUpperCase()
  const hasRueck =
    upper.includes('RÜCKLASTSCHRIFT') ||
    upper.includes('RUECKLASTSCHRIFT') ||
    upper.includes('RUCKLASTSCHRIFT')

  // ENTGELT: compound word or standalone fee (but not inside a Rücklastschrift row itself)
  if (
    upper.includes('RÜCKLASTSCHRIFTENTGELT') ||
    upper.includes('RUECKLASTSCHRIFTENTGELT') ||
    upper.includes('RUCKLASTSCHRIFTENTGELT')
  ) {
    return 'entgelt'
  }
  if (upper.includes('ENTGELT') && !hasRueck) return 'entgelt'

  // WIEDERGUTSCHRIFT: reversal / credit back (covers "LS WIEDERGUTSCHRIFT", "EINMAL-LS WIEDERGUTSCHRIFT", etc.)
  if (upper.includes('WIEDERGUTSCHRIFT')) return 'wiedergutschrift'

  // RÜCKLASTSCHRIFT: failed direct debit (various German phrasings)
  if (
    hasRueck ||
    upper.includes('LASTSCHRIFTRÜCKGABE') ||
    upper.includes('LASTSCHRIFTRUECKGABE') ||
    upper.includes('LASTSCHRIFTRUCKGABE') ||
    upper.includes('NICHT EINGELÖST') ||
    upper.includes('NICHT EINGELOST') ||
    upper.includes('NICHT AUSGEFÜHRT') ||
    upper.includes('NICHT AUSGEFUHRT')
  ) {
    return 'ruecklastschrift'
  }

  return 'normal'
}

function detectPaymentChain(desc: string): Transaction['paymentChain'] {
  const upper = desc.toUpperCase()
  if (upper.includes('PAYPAL')) return 'paypal'
  if (upper.includes('VODAFONE')) return 'vodafone_contract'
  if (upper.includes('KLARNA')) return 'klarna'
  return 'sparkasse_direct'
}

export function parseImportText(text: string): Transaction[] {
  const lines = text.trim().split('\n')
  const transactions: Transaction[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('ДАТА') || trimmed.startsWith('YYYY') || trimmed.startsWith('---') || trimmed.startsWith('===')) continue

    const parts = trimmed.split('|').map((p) => p.trim())
    if (parts.length < 4) continue

    const [dateStr, amountStr, typeStr, sourceStr] = parts

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue

    // Clean amount: strip +, -, €, EUR, spaces, then parse
    const cleanAmount = amountStr.replace(/[+\-€EUR\s]/g, '').replace(',', '.')
    const amount = parseFloat(cleanAmount)
    if (isNaN(amount) || amount <= 0) continue

    const normalizedType = typeStr.toLowerCase().trim()
    if (!VALID_TYPES.has(normalizedType)) continue

    const source = VALID_SOURCES.has(sourceStr) ? sourceStr : 'Other'

    // Detect 7-column or 8-column format (with optional GROUP_ID)
    let description: string | undefined
    let sparkasseType: Transaction['sparkasseType'] | undefined
    let paymentChain: Transaction['paymentChain'] | undefined
    let paymentGroupId: string | undefined

    if (parts.length >= 8) {
      description = parts[4] || undefined
      const rawSparkasseType = parts[5]
      const rawChain = parts[6]
      const rawGroup = parts[7]
      sparkasseType = VALID_SPARKASSE_TYPES.has(rawSparkasseType)
        ? (rawSparkasseType as Transaction['sparkasseType'])
        : undefined
      paymentChain = VALID_CHAINS.has(rawChain)
        ? (rawChain as Transaction['paymentChain'])
        : undefined
      paymentGroupId = rawGroup && rawGroup !== '-' ? rawGroup : undefined
    } else if (parts.length >= 7) {
      description = parts[4] || undefined
      const rawSparkasseType = parts[5]
      const rawChain = parts[6]
      sparkasseType = VALID_SPARKASSE_TYPES.has(rawSparkasseType)
        ? (rawSparkasseType as Transaction['sparkasseType'])
        : undefined
      paymentChain = VALID_CHAINS.has(rawChain)
        ? (rawChain as Transaction['paymentChain'])
        : undefined
    } else {
      description = parts[4] || undefined
    }

    // Auto-detect from description if not set by columns
    if (description) {
      if (!sparkasseType || sparkasseType === 'normal') {
        const detected = detectSparkasseType(description)
        if (detected !== 'normal') sparkasseType = detected
      }
      if (!paymentChain) {
        paymentChain = detectPaymentChain(description)
      }
    }

    let finalDescription = description
    let penaltySource: 'bank' | 'service' | undefined

    if (normalizedType === 'penalty') {
      if (finalDescription) {
        if (finalDescription.includes('[bank]')) {
          penaltySource = 'bank'
          finalDescription = finalDescription.replace('[bank]', '').trim() || undefined
        } else if (finalDescription.includes('[service]')) {
          penaltySource = 'service'
          finalDescription = finalDescription.replace('[service]', '').trim() || undefined
        } else if (/Bank|Gebühr|Rückgabe|Lastschrift/i.test(finalDescription)) {
          penaltySource = 'bank'
        } else {
          penaltySource = 'service'
        }
      } else {
        penaltySource = 'bank'
      }
    }

    transactions.push({
      id: crypto.randomUUID(),
      date: dateStr,
      amount,
      source: source as Transaction['source'],
      type: normalizedType as Transaction['type'],
      ...(penaltySource ? { penaltySource } : {}),
      ...(sparkasseType && sparkasseType !== 'normal' ? { sparkasseType } : {}),
      ...(paymentChain ? { paymentChain } : {}),
      ...(paymentGroupId ? { paymentGroupId } : {}),
      description: finalDescription,
      createdAt: new Date().toISOString()
    })
  }

  return transactions
}
