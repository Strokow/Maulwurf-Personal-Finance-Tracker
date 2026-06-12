import type { Transaction } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Central data sanitizer.
//
// Purpose: GUARANTEE that sensitive identifiers from bank statements
// (contract / account / customer numbers, IBANs, Gläubiger-IDs, mandate IDs,
// invoice numbers, card fragments, order numbers, transaction references …)
// never reach the persisted store / disk inside a transaction description.
//
// This is the second line of defence: the raw-statement parser already builds
// descriptions only from the merchant/payee name, and `stripSensitive` here is
// applied again to EVERY transaction (including manual entry) right before it is
// written through `useStore.addTransaction` / `addManyTransactions`.
// ─────────────────────────────────────────────────────────────────────────────

// Ordered patterns. Each matched span is replaced with a single space.
// Label+value patterns come BEFORE the generic IBAN rule so the label and its
// identifier are removed together (otherwise a bare label could swallow the next word).
const SENSITIVE_PATTERNS: RegExp[] = [
  // Gläubiger-ID with label (Glaeubiger-ID DE28ZZZ00002710809)
  /Gl(?:ä|ae)ubiger-?ID[:.\s]*[A-Z0-9]+/gi,
  // Mandate ID (Mandats-ID MC08933622-019)
  /Mandats?-?ID[:.\s]*[A-Z0-9-]+/gi,
  // IBAN / standalone Gläubiger-ID (DE28ZZZ00002710809, DE89 3704 0044 0532 0130 00, …)
  /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g,
  // Customer number (KD-NR . 00008933622, Kundennummer 123)
  /(?:KD-?NR|Kunden-?(?:Nr|nummer))\.?\s*[:.]?\s*\d+/gi,
  // Document / receipt number (BelegNr . 5000100244100)
  /Beleg-?Nr\.?\s*[:.]?\s*\d+/gi,
  // Invoice / contract numbers — value must contain a digit (R.Nr. R0000101400,
  // Vertrag P-0000179394, Vertragsnummer 1157268007059)
  /(?:R\.?Nr|Rechnungs-?(?:Nr|nummer)|Vertrags?(?:-?Nr|nummer)?|Vertrag)\b[:.\s]*[A-Z0-9-]*\d[A-Z0-9-]*/gi,
  // Account number (Konto … Nr.02010127620001, IhNr.020…, Kontonummer)
  /(?:Konto(?:nummer)?|Ih-?Nr|Konto-?Nr)\.?\s*[:.]?\s*\d+/gi,
  // PayPal transaction reference (1050897465236/PP.5783.PP/.)
  /\d{8,}\/PP\.\d+\.PP\/?\.?/gi,
  // Generic "<long digits>/." reference tails
  /\b\d{10,}\/\.?/g,
  // Insurance / policy number (PN90002681596)
  /\bPN\d{6,}\b/g,
  // Amazon order numbers (305-8768624-7335538) and AMZN refs
  /\b\d{3}-\d{7}-\d{7}\b/g,
  /\bAMZN[A-Za-z0-9-]*\b/gi,
  // Card fragment + expiry (Debitk.11 2028-12)
  /Debitk\.?\s*\d+(?:\s*\d{4}-\d{2})?/gi,
  // ISO timestamps from card rows (2026-06-08T15:37[:00])
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?/g,
  // Standalone alphanumeric IDs (mixed letters+digits, ≥10 chars) e.g. 4MUFNOOMH6TV7CBT
  /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{10,}\b/gi,
  // Any remaining long digit run (≥6) — account / customer / Abo numbers
  /\b\d{6,}\b/g
]

/** Remove every sensitive identifier from a free-text string and tidy leftovers. */
export function stripSensitive(text: string): string {
  let out = text
  for (const re of SENSITIVE_PATTERNS) {
    out = out.replace(re, ' ')
  }
  out = out
    .replace(/[•|]/g, ' - ') // bullets / pipes → readable separator
    .replace(/\s{2,}/g, ' ')
    .replace(/(?:\s*-\s*){2,}/g, ' - ') // collapse runs of dashes left by removals
    .replace(/^[\s,;:.\-–]+/, '')
    .replace(/[\s,;:.\-–]+$/, '')
    .trim()
  return out
}

/** Sanitize a description for storage; empty result becomes `undefined`. */
export function sanitizeDescription(desc?: string): string | undefined {
  if (!desc) return desc
  const cleaned = stripSensitive(desc)
  return cleaned.length > 0 ? cleaned : undefined
}

/** Return a copy of the transaction with a sanitized description (or the same object if unchanged). */
export function sanitizeTransaction<T extends Transaction>(t: T): T {
  if (t.description === undefined) return t
  const cleaned = sanitizeDescription(t.description)
  if (cleaned === t.description) return t
  return { ...t, description: cleaned }
}

/** Sanitize a batch of transactions before persistence. */
export function sanitizeTransactions<T extends Transaction>(ts: T[]): T[] {
  return ts.map(sanitizeTransaction)
}
