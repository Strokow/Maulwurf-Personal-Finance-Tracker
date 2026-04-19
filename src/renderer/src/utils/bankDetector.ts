export type BankFormat = 'sparkasse' | 'revolut' | 'paypal' | 'klarna' | 'vodafone' | 'generic'

export function detectBankFormat(text: string): BankFormat {
  const lower = text.toLowerCase()

  if (
    lower.includes('sparkasse') ||
    lower.includes('iban de') ||
    lower.includes('kontonummer') ||
    lower.includes('blz') ||
    lower.includes('buchungsdatum')
  ) {
    return 'sparkasse'
  }

  if (
    lower.includes('revolut') ||
    lower.includes('exchange rate') ||
    lower.includes('completed') ||
    lower.includes('declined')
  ) {
    return 'revolut'
  }

  if (lower.includes('paypal') && lower.includes('transaction id')) {
    return 'paypal'
  }

  if (lower.includes('klarna') && lower.includes('ratenzahlung')) {
    return 'klarna'
  }

  return 'generic'
}

export const bankLabels: Record<BankFormat, string> = {
  sparkasse: 'Sparkasse',
  revolut: 'Revolut',
  paypal: 'PayPal',
  klarna: 'Klarna',
  vodafone: 'Vodafone',
  generic: 'Generisch'
}

export const bankColors: Record<BankFormat, string> = {
  sparkasse: 'bg-green-900/50 text-green-400 border-green-700/50',
  revolut: 'bg-blue-900/50 text-blue-400 border-blue-700/50',
  paypal: 'bg-blue-900/50 text-blue-300 border-blue-700/50',
  klarna: 'bg-pink-900/50 text-pink-400 border-pink-700/50',
  vodafone: 'bg-red-900/50 text-red-400 border-red-700/50',
  generic: 'bg-neutral-800/50 text-neutral-400 border-neutral-700/50'
}
