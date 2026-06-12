import { describe, it, expect } from 'vitest'
import { parseRawStatement } from '../utils/parseRawStatement'
import { stripSensitive } from '../utils/sanitize'

const SPARKASSE_RAW = `PayPal Europe S.a.r.l. et Cie S.C.A 22-24 Boulevard Royal, 2449 Luxembourg
1050897465236/PP.5783.PP/. Apple Services, Ihr Einkauf bei Apple Services 12.06.2026 | FOLGELASTSCHRIFT
12.06.2026
12.06.2026
-2,99 EURBetrag:-2,99 EUR

Alexej Strokow Borsbergstr. 33
Personal 10.06.2026 | GUTSCHR. UEBERWEISUNG
10.06.2026
10.06.2026
0,77 EURBetrag:0,77 EUR
Kaufland Dresden-Striesen//Dresden/DE
2026-06-08T15:37 Debitk.11 2028-12 09.06.2026 | DIG. KARTE (APPLE PAY)
09.06.2026
09.06.2026
-6,71 EURBetrag:-6,71 EUR
LIDL SAGT DANKE//Dresden/DE
2026-06-08T11:57 Debitk.11 2028-12 09.06.2026 | DIG. KARTE (APPLE PAY)
09.06.2026
09.06.2026
-2,63 EURBetrag:-2,63 EUR

PayPal Europe S.a.r.l. et Cie S.C.A 22-24 Boulevard Royal, 2449 Luxembourg
1050789706484/PP.5783.PP/. Bling Services GmbH, Ihr Einkauf bei Bling Services GmbH 09.06.2026 | FOLGELASTSCHRIFT
09.06.2026
09.06.2026
-3,99 EURBetrag:-3,99 EUR
RECHNUNG
Rechnung Rückgabe Lastschrift über 23,33 EUR Einreicher: AMAZON PAYMENTS EUROPE S.C.Verwendungszweck: 305-8768624-7335538 AMZN Mk20260605-SN113-00118110880 05.06.2026 | RECHNUNG
05.06.2026
05.06.2026
-1,50 EURBetrag:-1,50 EUR
AMAZON PAYMENTS EUROPE S.C.A.
305-8768624-7335538 AMZN Mktp DE 4MUFNOOMH6TV7CBT 05.06.2026 | Wertstellung 04.06.2026 | LS WIEDERGUTSCHRIFT
05.06.2026
04.06.2026
23,33 EURBetrag:23,33 EUR
BLING DEUTSCHLA//Schonaich/DE/0
2026-06-03T11:41 Debitk.0 2028-12 Wiederkehrende Zahlung Zahl.System VISA Debit 05.06.2026 | KARTENZAHLUNG
05.06.2026
05.06.2026
-5,00 EURBetrag:-5,00 EUR
AMAZON PAYMENTS EUROPE S.C.A.
305-8768624-7335538 AMZN Mktp DE 4MUFNOOMH6TV7CBT 04.06.2026 | FOLGELASTSCHRIFT
04.06.2026
04.06.2026
-23,33 EURBetrag:-23,33 EUR
Kaufland Dresden-Striesen//Dresden/DE
2026-06-01T09:04 Debitk.11 2028-12 02.06.2026 | DIG. KARTE (APPLE PAY)
02.06.2026
02.06.2026
-18,67 EURBetrag:-18,67 EUR
BODY ATTACK FRANCHI/WALDHOFSTR. 19/ELLERBEK/DE
2026-05-29T11:20 Debitk.11 2028-12 01.06.2026 | DIG. KARTE (APPLE PAY)
01.06.2026
01.06.2026
-29,99 EURBetrag:-29,99 EUR
BLING DEUTSCHLA//Schonaich/DE/0
2026-05-29T06:05 Debitk.0 2028-12 Wiederkehrende Zahlung Zahl.System VISA Debit 01.06.2026 | KARTENZAHLUNG
01.06.2026
01.06.2026
-5,00 EURBetrag:-5,00 EUR
Vielen Dank sagt Vodafone//Duesseldorf/DE/0
2026-05-29T07:59 Debitk.11 2028-12 Teillieferung(Final) Zahl.System VISA Debit 01.06.2026 | E-COM (APPLE PAY)
01.06.2026
01.06.2026
-121,94 EURBetrag:-121,94 EUR

Klarna Bank AB Sveavägen 46
Purchase at DoktorABC 01.06.2026 | FOLGELASTSCHRIFT
01.06.2026
01.06.2026
-31,14 EURBetrag:-31,14 EUR

Klarna Bank AB Sveavägen 46
Purchase at Klarna 01.06.2026 | FOLGELASTSCHRIFT
01.06.2026
01.06.2026
-98,42 EURBetrag:-98,42 EUR

PYUR Vertrieb + Service GmbH Messe-Allee 2
PYUR - KD-NR . 00008933622, BelegNr . 5000100244100, Faelligkeit 01 . 06 . 2026, Mandats-ID MC08933622-019, Glaeubiger-ID DE28ZZZ00002710809 01.06.2026 | FOLGELASTSCHRIFT
01.06.2026
01.06.2026
-48,98 EURBetrag:-48,98 EUR

agencio Versicherungsservice AG
Versicherung R.Nr. R0000101400 f. Vertrag P-0000179394 DATUM 01.06.2026, 09.37 UHR 01.06.2026 | ECHTZEIT-UEBERWEISUNG
01.06.2026
01.06.2026
-15,75 EURBetrag:-15,75 EUR
VHV Allgemeine Versicherung AG
VHV VersicherungHAFTPFLICHTVERSICHERUNGPN90002681596 DATUM 01.06.2026, 09.32 UHR 01.06.2026 | ECHTZEIT-UEBERWEISUNG
01.06.2026
01.06.2026
-3,93 EURBetrag:-3,93 EUR`

const REVOLUT_RAW = `Date
(UTC) Description Status Account Money
out
Money
in
10 Jun
2026
MOS To Alexej Strokow • Personal Completed Main ·
EUR
€0.77
10 Jun
2026
CAR Lidl Sagt Danke Completed Main ·
EUR
€0.99
9 Jun 2026 CAR Lidl Sagt Danke Completed Main ·
EUR
€4.08
8 Jun 2026 MOR From Amélie C Completed Main ·
EUR
€16.00
1 Jun 2026 MOA Money added from CYGNUS MUSIC LTD • Music royalties Cygnus Music Ltd Label
payment for
Completed Main ·
EUR
€15.59
1 Jun 2026 MOS DB Vertrieb GmbH • Abo 688592975 zum 01.06.2026 Completed Main ·
EUR
€63.00
1 Jun 2026 MOA Money added from ALEXEJ STROKOW Completed Main ·
EUR
€20.00`

// Identifiers that must NEVER survive into a stored description.
const FORBIDDEN = [
  'PP.5783',
  '1050897465236',
  '0000179394',
  '00008933622',
  '5000100244100',
  'DE28ZZZ',
  'MC08933622',
  '305-8768624',
  '4MUFNOOMH6TV7CBT',
  'PN90002681596',
  'Debitk',
  '02010127620001',
  '688592975'
]

describe('parseRawStatement — Sparkasse', () => {
  const txs = parseRawStatement(SPARKASSE_RAW, 'sparkasse')

  it('распознаёт все блоки выписки', () => {
    expect(txs.length).toBe(18)
  })

  it('строит failed-debit группу Amazon 23,33 (G1)', () => {
    const group = txs.filter((t) => t.paymentGroupId)
    expect(group.length).toBe(3)
    const gid = group[0].paymentGroupId
    expect(group.every((t) => t.paymentGroupId === gid)).toBe(true)

    const failed = group.find((t) => t.type === 'failed_debit')
    const wieder = group.find((t) => t.sparkasseType === 'wiedergutschrift')
    const penalty = group.find((t) => t.type === 'penalty')
    expect(failed?.amount).toBe(23.33)
    expect(failed?.sparkasseType).toBe('ruecklastschrift')
    expect(wieder?.type).toBe('income')
    expect(wieder?.amount).toBe(23.33)
    expect(penalty?.amount).toBe(1.5)
    expect(penalty?.penaltySource).toBe('bank')
  })

  it('успешные FOLGELASTSCHRIFT (PayPal/Klarna/PYUR) — обычные payment', () => {
    const paypalApple = txs.find((t) => t.amount === 2.99)
    expect(paypalApple?.type).toBe('payment')
    expect(paypalApple?.paymentChain).toBe('paypal')
    expect(paypalApple?.description).toContain('Apple Services')

    const klarna = txs.find((t) => t.amount === 31.14)
    expect(klarna?.paymentChain).toBe('klarna')

    const vodafone = txs.find((t) => t.amount === 121.94)
    expect(vodafone?.paymentChain).toBe('vodafone_contract')

    const pyur = txs.find((t) => t.amount === 48.98)
    expect(pyur?.type).toBe('payment')
  })

  it('GUTSCHR. UEBERWEISUNG → income', () => {
    const inc = txs.find((t) => t.amount === 0.77)
    expect(inc?.type).toBe('income')
  })

  it('ни одно описание не содержит конфиденциальных ID', () => {
    for (const t of txs) {
      const d = t.description ?? ''
      for (const bad of FORBIDDEN) {
        expect(d.includes(bad), `description "${d}" leaks ${bad}`).toBe(false)
      }
    }
  })
})

describe('parseRawStatement — Revolut', () => {
  const txs = parseRawStatement(REVOLUT_RAW, 'revolut')

  it('распознаёт все строки (без шапки таблицы)', () => {
    expect(txs.length).toBe(7)
  })

  it('направление по префиксу: MOA/MOR=income, MOS/CAR=payment', () => {
    const added = txs.find((t) => t.description?.includes('ALEXEJ STROKOW'))
    expect(added?.type).toBe('income')
    expect(added?.amount).toBe(20)

    const card = txs.find((t) => t.description?.includes('Lidl') && t.amount === 0.99)
    expect(card?.type).toBe('payment')

    const sent = txs.find((t) => t.amount === 63)
    expect(sent?.type).toBe('payment')
  })

  it('вырезает номер договора из описания (Abo 688592975)', () => {
    const abo = txs.find((t) => t.amount === 63)
    expect(abo?.description).not.toContain('688592975')
  })
})

describe('stripSensitive', () => {
  it('убирает IBAN/Gläubiger-ID, оставляет читаемый текст', () => {
    expect(stripSensitive('PYUR Glaeubiger-ID DE28ZZZ00002710809 Rechnung')).toBe('PYUR Rechnung')
  })
  it('убирает длинные номера', () => {
    expect(stripSensitive('Abo 688592975 zum')).toBe('Abo zum')
  })
  it('не трогает обычные названия', () => {
    expect(stripSensitive('Kaufland Dresden-Striesen')).toBe('Kaufland Dresden-Striesen')
  })
})
