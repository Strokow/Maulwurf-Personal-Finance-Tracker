import type { Transaction } from '../types'
import type { BankFormat } from './bankDetector'
import { parseImportText } from './parseImport'
import { stripSensitive } from './sanitize'

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic raw-statement parser.
//
// Converts a pasted *raw* bank statement (Sparkasse or Revolut) into the
// canonical pipe-delimited intermediate format, then reuses the validated
// `parseImportText` to build `Transaction[]`. This keeps all the type/chain/
// penalty/grouping logic in one place.
//
// Privacy: descriptions are built ONLY from the merchant/payee name (+ a clean
// purpose for PayPal/Klarna). Every assembled description is passed through
// `stripSensitive`, and the store applies the same filter again on save.
// No raw text is persisted.
// ─────────────────────────────────────────────────────────────────────────────

type TxType = Transaction['type']
type SparkasseType = NonNullable<Transaction['sparkasseType']>

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', mär: '03', maer: '03', apr: '04',
  may: '05', mai: '05', jun: '06', jul: '07', aug: '08', sep: '09',
  oct: '10', okt: '10', nov: '11', dec: '12', dez: '12'
}

/** German amount string → absolute number ("1.234,56" → 1234.56, "-2,99" → 2.99). */
function parseGermanAmount(s: string): number {
  const cleaned = s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  return Math.abs(parseFloat(cleaned))
}

/** "12.06.2026" → "2026-06-12". */
function deDateToIso(dd: string, mm: string, yyyy: string): string {
  return `${yyyy}-${mm}-${dd}`
}

/** Loose merchant equality (ignores case / punctuation / digits). */
function sameMerchant(a: string, b: string): boolean {
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-zäöüß]/g, '')
  const x = norm(a)
  const y = norm(b)
  return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x))
}

// ── Sparkasse ────────────────────────────────────────────────────────────────

interface SRec {
  date: string
  amountAbs: number
  type: TxType
  sparkasseType: SparkasseType
  chain: string
  merchant: string
  bookingType: string
  description: string
  ueberAmount?: number
  groupId?: string
}

/** Map a payee line to a known processor (fixed name + chain) or a cleaned merchant. */
function resolveMerchant(firstHead: string, headText: string): { merchant: string; chain: string } {
  const h = `${firstHead} ${headText}`.toLowerCase()
  if (/paypal/.test(h)) return { merchant: 'PayPal Europe', chain: 'paypal' }
  if (/klarna/.test(h)) return { merchant: 'Klarna Bank AB', chain: 'klarna' }
  if (/vodafone/.test(h)) return { merchant: 'Vodafone', chain: 'vodafone_contract' }
  if (/amazon/.test(h)) return { merchant: 'Amazon', chain: 'sparkasse_direct' }
  if (/\bpyur\b/.test(h)) return { merchant: 'PYUR', chain: 'sparkasse_direct' }
  return { merchant: cleanMerchant(firstHead), chain: 'sparkasse_direct' }
}

/** Strip address / street / store-number noise from a payee line. */
function cleanMerchant(firstHead: string): string {
  let m = firstHead.split('/')[0]
  m = m.split(',')[0]
  m = m.replace(/\s+\S*str(?:\.|aße|asse).*$/i, '') // drop "…str. 33 …" (street + rest)
  m = m.replace(/\s*\d{2,}\s*$/, '') // drop trailing store number ("NEW YORKER22714")
  m = stripSensitive(m)
  return m.trim()
}

/** Short name for an Einreicher / counterparty. */
function shortName(s: string): string {
  if (/amazon/i.test(s)) return 'Amazon'
  if (/paypal/i.test(s)) return 'PayPal'
  if (/klarna/i.test(s)) return 'Klarna'
  if (/vodafone/i.test(s)) return 'Vodafone'
  if (/pyur/i.test(s)) return 'PYUR'
  return cleanMerchant(s)
}

/** Clean purpose for PayPal ("Ihr Einkauf bei X") / Klarna ("Purchase at X"). */
function extractPurpose(headText: string): string {
  let m = headText.match(/Ihr Einkauf bei\s+(.+?)\s+\d{2}\.\d{2}\.\d{4}/i)
  if (m && m[1].trim()) return m[1].trim()
  m = headText.match(/Purchase at\s+(.+?)\s+\d{2}\.\d{2}\.\d{4}/i)
  if (m && m[1].trim()) return `Purchase at ${m[1].trim()}`
  return ''
}

function buildSparkasseRecord(buf: string[], amountStr: string): SRec | null {
  const dateOnlyRe = /^(\d{2})\.(\d{2})\.(\d{4})$/
  const headLines: string[] = []
  let buchung = ''
  for (const l of buf) {
    const d = l.match(dateOnlyRe)
    if (d) {
      if (!buchung) buchung = deDateToIso(d[1], d[2], d[3])
      continue
    }
    if (!buchung) headLines.push(l) // head = lines before the first booking date
  }
  if (!buchung || headLines.length === 0) return null

  const headText = headLines.join(' ')
  const firstHead = headLines[0]
  const segs = headText.split('|')
  const bookingType = (segs[segs.length - 1] || '').trim()

  const sign = amountStr.trim().startsWith('-') ? -1 : 1
  const amountAbs = parseGermanAmount(amountStr)
  const { merchant, chain } = resolveMerchant(firstHead, headText)
  const purpose = extractPurpose(headText)

  let type: TxType
  let sparkasseType: SparkasseType
  let description: string
  let ueberAmount: number | undefined

  if (sign > 0) {
    type = 'income'
    sparkasseType = /WIEDERGUTSCHRIFT/i.test(bookingType) ? 'wiedergutschrift' : 'normal'
    description = sparkasseType === 'wiedergutschrift' ? `${merchant} Wiedergutschrift` : merchant
  } else if (/RECHNUNG/i.test(bookingType) && /R(?:ü|ue|u)ckgabe/i.test(headText) && /Lastschrift/i.test(headText)) {
    type = 'penalty'
    sparkasseType = 'entgelt'
    const ueber = headText.match(/(?:über|ueber)\s+(\d{1,3}(?:\.\d{3})*,\d{2})/i)
    ueberAmount = ueber ? parseGermanAmount(ueber[1]) : undefined
    const einr = headText.match(/Einreicher:?\s*([A-Za-zÄÖÜäöüß .&-]+?)(?:Verwendungszweck|\s\d|$)/i)
    const einreicher = einr ? shortName(einr[1]) : merchant
    description = `${einreicher} Rückgabe [bank]`
  } else {
    type = 'payment'
    sparkasseType = 'normal'
    description = purpose ? `${merchant} - ${purpose}` : merchant
  }

  return {
    date: buchung,
    amountAbs,
    type,
    sparkasseType,
    chain,
    merchant,
    bookingType,
    description,
    ueberAmount
  }
}

/** Resolve failed-debit groups: FOLGELASTSCHRIFT ↔ LS WIEDERGUTSCHRIFT ↔ Rückgabe-Gebühr. */
function resolveSparkasseGroups(records: SRec[]): void {
  let counter = 0
  for (const w of records) {
    if (w.sparkasseType !== 'wiedergutschrift' || w.groupId) continue
    const cands = records.filter(
      (r) => !r.groupId && r.type !== 'income' && /LASTSCHRIFT/i.test(r.bookingType) && r.amountAbs === w.amountAbs
    )
    const cand = cands.find((r) => sameMerchant(r.merchant, w.merchant)) || cands[0]
    if (!cand) continue

    counter += 1
    const gid = `G${counter}`
    w.groupId = gid
    cand.groupId = gid
    cand.type = 'failed_debit'
    cand.sparkasseType = 'ruecklastschrift'
    cand.description = `${cand.merchant} Lastschrift`

    const pen = records.find((r) => r.type === 'penalty' && !r.groupId && r.ueberAmount === w.amountAbs)
    if (pen) pen.groupId = gid
  }
}

function sparkasseRawToPipe(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n')
  const amountLineRe =
    /^(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*EUR(?:Betrag:\s*-?\d{1,3}(?:\.\d{3})*,\d{2}\s*EUR)?\s*$/
  const records: SRec[] = []
  let buf: string[] = []

  for (const raw of lines) {
    const line = raw.trim()
    const am = line.match(amountLineRe)
    if (am) {
      const rec = buildSparkasseRecord(buf, am[1])
      if (rec) records.push(rec)
      buf = []
      continue
    }
    if (line) buf.push(line)
  }

  resolveSparkasseGroups(records)

  return records
    .map((r) =>
      [
        r.date,
        r.amountAbs.toFixed(2),
        r.type,
        'Sparkasse',
        stripSensitive(r.description),
        r.sparkasseType,
        r.chain,
        r.groupId || '-'
      ].join('|')
    )
    .join('\n')
}

// ── Revolut ────────────────────────────────────────────────────────────────

function revolutChunkToPipe(chunk: string, amountStr: string): string | null {
  const dm = chunk.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/)
  if (!dm) return null
  const mm = MONTHS[dm[2].toLowerCase()]
  if (!mm) return null
  const iso = `${dm[3]}-${mm}-${dm[1].padStart(2, '0')}`

  let after = chunk.slice((dm.index ?? 0) + dm[0].length).trim()
  const statusM = after.match(/\b(Completed|Pending|Reverted|Declined|Failed)\b/i)
  const status = statusM ? statusM[1].toLowerCase() : ''
  after = after.replace(/\s*\b(Completed|Pending|Reverted|Declined|Failed)\b.*$/i, '').trim()

  const description = stripSensitive(after)
  if (!description) return null

  const prefix = (description.match(/^([A-Z]{2,4})\b/) || [])[1] || ''
  let type: TxType = 'payment'
  if (status === 'declined' || status === 'failed') type = 'failed_debit'
  else if (status === 'reverted') type = 'income'
  else if (prefix === 'MOA' || prefix === 'MOR') type = 'income'

  const amount = parseFloat(amountStr.replace(/,/g, ''))
  if (isNaN(amount)) return null

  return [iso, amount.toFixed(2), type, 'Revolut', description].join('|')
}

function revolutRawToPipe(text: string): string {
  const normalized = text.replace(/\r/g, '')
  // Collapse wrapped dates: "10 Jun\n2026" → "10 Jun 2026"
  const collapsed = normalized.replace(/(\d{1,2}\s+[A-Za-z]{3})\s*\n\s*(\d{4})/g, '$1 $2')
  const lines = collapsed.split('\n').map((l) => l.trim()).filter(Boolean)

  const amountRe = /^€\s*([\d.,]+)$/
  const out: string[] = []
  let buf: string[] = []

  for (const line of lines) {
    const m = line.match(amountRe)
    if (m) {
      const chunk = buf.join(' ').replace(/\s+/g, ' ').trim()
      buf = []
      const pipe = revolutChunkToPipe(chunk, m[1])
      if (pipe) out.push(pipe)
      continue
    }
    if (line === 'EUR' || line === '·') continue
    buf.push(line)
  }

  return out.join('\n')
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Parse a raw pasted statement into transactions. Supports Sparkasse and Revolut;
 * returns [] for any other bank format (caller decides on a fallback).
 */
export function parseRawStatement(text: string, bank: BankFormat): Transaction[] {
  let pipe = ''
  if (bank === 'sparkasse') pipe = sparkasseRawToPipe(text)
  else if (bank === 'revolut') pipe = revolutRawToPipe(text)
  else return []

  if (!pipe.trim()) return []
  return parseImportText(pipe)
}
