import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Loader2, ChevronDown, ChevronUp, Trash2, Settings2 } from 'lucide-react'
import type { Transaction, ImportRecord } from '../types'
import { parseImportText } from '../utils/parseImport'
import { parseRawStatement } from '../utils/parseRawStatement'
import { getTransactionGroups } from '../store/useStore'
import { detectBankFormat, bankLabels, bankColors, type BankFormat } from '../utils/bankDetector'
import { Button } from './ui/button'
import { SourceLogo } from './SourceLogo'
import { TransactionGroupCard } from './TransactionGroupCard'

type ImportTab = 'manual' | 'ai'

const overrideOptions: BankFormat[] = ['sparkasse', 'revolut', 'paypal', 'klarna', 'generic']

const SPARKASSE_SYSTEM_PROMPT = `Ты извлекаешь транзакции из выписок Sparkasse (Германия). Ответ СТРОГО в формате ниже, без пояснений.

ФОРМАТ — ровно 2 секции:

=== TRANSACTIONS ===
YYYY-MM-DD | СУММА | ТИП | Sparkasse | ОПИСАНИЕ | SPARKASSE_TYP | ЦЕПОЧКА | GROUP_ID

Поля:
- СУММА: положительное число, точка-разделитель, без € (напр. 137.60)
- ТИП (одно из): payment / income / failed_debit / penalty
- SPARKASSE_TYP (одно из): normal / ruecklastschrift / wiedergutschrift / entgelt
- ЦЕПОЧКА (одно из): sparkasse_direct / paypal / vodafone_contract / klarna
- GROUP_ID: G1, G2... — объединяй связанные операции (failed_debit + Wiedergutschrift + Entgelt)
- ОПИСАНИЕ: краткое, макс 5 слов. Для penalty дописывай [bank] или [service]

КРИТИЧЕСКОЕ ПРАВИЛО — обнаружение НЕУДАЧНЫХ ПЛАТЕЖЕЙ:
Неудачный платёж = это ЛЮБОЕ отрицательное списание (FOLGELASTSCHRIFT / LASTSCHRIFT / BASISLASTSCHRIFT),
для которого в этой же выписке есть ПАРНАЯ положительная запись "LS WIEDERGUTSCHRIFT" с ТОЙ ЖЕ суммой.
Проверка: сумма отрицательного списания по модулю должна ТОЧНО совпадать с суммой LS WIEDERGUTSCHRIFT.

Если такая пара найдена:
1. Отрицательное списание → ТИП = failed_debit, SPARKASSE_TYP = ruecklastschrift
2. LS WIEDERGUTSCHRIFT → ТИП = income, SPARKASSE_TYP = wiedergutschrift
3. Если есть запись "Rechnung Rückgabe Lastschrift über X,XX EUR Einreicher: ..." (−1.50 EUR)
   где X,XX совпадает с суммой неудачного платежа И Einreicher совпадает с получателем оригинала →
   → ТИП = penalty, SPARKASSE_TYP = entgelt
4. Всем трём записям присвой ОДИН общий GROUP_ID.

Если FOLGELASTSCHRIFT БЕЗ парной LS WIEDERGUTSCHRIFT → это успешное списание → payment, normal.

Прочая классификация:
- ECHTZEIT-GUTSCHRIFT → income, normal
- KARTENZAHLUNG / DIG. KARTE / GIRO E-COM → payment, normal
- BARGELDEINZAHLUNG SB → income, normal
- Обычное списание без пары Wiedergutschrift → payment, normal
- Дата: всегда Buchungsdatum (первая дата в строке)

ПРИМЕР ТРОЙКИ (PYUR 41,43 EUR списание которое вернулось):

В выписке присутствуют три связанные записи:
  01.04.2026 | −41,43 | FOLGELASTSCHRIFT | PYUR Vertrieb + Service GmbH | KD-NR . 00001234567
  02.04.2026 | +41,43 | LS WIEDERGUTSCHRIFT | PYUR Vertrieb + Service GmbH | KD-NR . 00001234567
  02.04.2026 | −1,50  | RECHNUNG | Rechnung Rückgabe Lastschrift über 41,43 EUR Einreicher: PYUR ...

Выход:
2026-04-01 | 41.43 | failed_debit | Sparkasse | PYUR Lastschrift | ruecklastschrift | sparkasse_direct | G1
2026-04-02 | 41.43 | income | Sparkasse | PYUR Wiedergutschrift | wiedergutschrift | sparkasse_direct | G1
2026-04-02 | 1.50 | penalty | Sparkasse | PYUR Rückgabe [bank] | entgelt | sparkasse_direct | G1

ПРИМЕР (несколько групп + обычные операции):

=== TRANSACTIONS ===
2026-03-18 | 15.75 | failed_debit | Sparkasse | agencio Lastschrift | ruecklastschrift | sparkasse_direct | G1
2026-03-19 | 15.75 | income | Sparkasse | agencio Wiedergutschrift | wiedergutschrift | sparkasse_direct | G1
2026-03-19 | 1.50 | penalty | Sparkasse | agencio Rückgabe [bank] | entgelt | sparkasse_direct | G1
2026-03-02 | 94.95 | payment | Sparkasse | Vodafone Apple Pay | normal | vodafone_contract | G5
2026-03-05 | 13.98 | payment | Sparkasse | Netflix PayPal | normal | paypal | G6
2026-03-02 | 100.00 | income | Sparkasse | Max Mustermann Gutschrift | normal | sparkasse_direct | G7

=== ANALYTICS ===
Краткая аналитика: всего платежей, неудачных, комиссии, реальные потери.

ПРАВИЛА:
- Начинай ответ СРАЗУ с === TRANSACTIONS ===
- Каждая строка — ровно 8 полей через |
- Не пропускай транзакции
- Сначала сопоставь все пары FOLGELASTSCHRIFT ↔ LS WIEDERGUTSCHRIFT, только потом классифицируй остальные
- Не пиши ничего кроме двух секций`

const REVOLUT_SYSTEM_PROMPT = `Ты извлекаешь транзакции из выписок Revolut. Ответ СТРОГО в формате ниже, без пояснений.

Все суммы конвертируй в EUR если они в другой валюте.

ФОРМАТ — ровно 2 секции:

=== TRANSACTIONS ===
YYYY-MM-DD | СУММА | ТИП | Revolut | ОПИСАНИЕ | normal | revolut_direct | GROUP_ID

Поля:
- СУММА: положительное число в EUR, точка-разделитель (напр. 49.90)
- ТИП (одно из): payment / income / failed_debit / penalty
- ОПИСАНИЕ: краткое, макс 5 слов. Для penalty дописывай [bank]
- GROUP_ID: G1, G2...

Классификация:
- Card payment / Purchase → payment
- Transfer received / Top-Up → income
- Transfer sent → payment
- Declined / Failed → failed_debit
- Refund / Reverted → income
- Fee → penalty

ПРИМЕР:
=== TRANSACTIONS ===
2026-03-01 | 25.00 | payment | Revolut | Amazon Purchase | normal | revolut_direct | G1
2026-03-02 | 10.00 | income | Revolut | Transfer John | normal | revolut_direct | G2

=== ANALYTICS ===
Краткая аналитика текстом.

ПРАВИЛА:
- Начинай СРАЗУ с === TRANSACTIONS ===
- Каждая строка — ровно 8 полей через |
- Не пропускай транзакции`

const GENERIC_SYSTEM_PROMPT = `Ты извлекаешь транзакции из банковских выписок. Ответ СТРОГО в формате ниже, без пояснений.

ФОРМАТ — ровно 2 секции:

=== TRANSACTIONS ===
YYYY-MM-DD | СУММА | ТИП | ИСТОЧНИК | ОПИСАНИЕ | normal | sparkasse_direct | GROUP_ID

- СУММА: положительное число, точка-разделитель (напр. 49.90)
- ТИП: payment / income / failed_debit / penalty
- ИСТОЧНИК: Deutsche Bank / Sparkasse / Revolut / PayPal / Klarna / Vodafone / Other

=== ANALYTICS ===
Краткая аналитика.

Начинай СРАЗУ с === TRANSACTIONS ===. Каждая строка — 8 полей через |.`

function buildPrompt(bank: BankFormat, userInput: string, extraConditions: string): { system: string; prompt: string } {
  let systemPrompt: string

  if (bank === 'sparkasse') {
    systemPrompt = SPARKASSE_SYSTEM_PROMPT
  } else if (bank === 'revolut') {
    systemPrompt = REVOLUT_SYSTEM_PROMPT
  } else {
    systemPrompt = GENERIC_SYSTEM_PROMPT
  }

  if (extraConditions.trim()) {
    systemPrompt += `\n\n--- ДОПОЛНИТЕЛЬНЫЕ УСЛОВИЯ ---\n${extraConditions.trim()}`
  }

  return { system: systemPrompt, prompt: userInput }
}

function parseAiResponse(response: string): { transactionLines: string; analytics: string } {
  const txMarker = '=== TRANSACTIONS ==='
  const analyticsMarker = '=== ANALYTICS ==='

  const txIdx = response.indexOf(txMarker)
  const anIdx = response.indexOf(analyticsMarker)

  if (txIdx !== -1 && anIdx !== -1) {
    const transactionLines = response.slice(txIdx + txMarker.length, anIdx).trim()
    const analytics = response.slice(anIdx + analyticsMarker.length).trim()
    return { transactionLines, analytics }
  }

  if (txIdx !== -1) {
    const transactionLines = response.slice(txIdx + txMarker.length).trim()
    return { transactionLines, analytics: '' }
  }

  // Fallback: try to find lines that look like transaction data
  return { transactionLines: response, analytics: '' }
}

const rowBorderColor: Record<Transaction['type'], string> = {
  income: 'border-l-2 border-l-green-500/60',
  failed_debit: 'border-l-2 border-l-red-500/60',
  penalty: 'border-l-2 border-l-orange-500/60',
  payment: ''
}

interface ImportPasteProps {
  onImport: (transactions: Transaction[]) => Promise<void>
  onAddImportRecord: (record: ImportRecord) => Promise<void>
  onDeleteBatch: (batchId: string) => Promise<void>
  importHistory: ImportRecord[]
}

function detectPeriodFromTransactions(txs: Transaction[]): string {
  if (txs.length === 0) return 'Unbekannt'
  const months = new Set(txs.map((t) => t.date.slice(0, 7)))
  const sorted = [...months].sort()
  const germanMonths = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
  return sorted
    .map((m) => {
      const [year, month] = m.split('-')
      return `${germanMonths[parseInt(month, 10) - 1]} ${year}`
    })
    .join(', ')
}

export function ImportPaste({ onImport, onAddImportRecord, onDeleteBatch, importHistory }: ImportPasteProps): React.JSX.Element {
  const [tab, setTab] = useState<ImportTab>('manual')
  const [text, setText] = useState('')
  const [aiText, setAiText] = useState('')
  const [extraConditions, setExtraConditions] = useState('')
  const [showExtraConditions, setShowExtraConditions] = useState(false)
  const [detectedBank, setDetectedBank] = useState<BankFormat>('generic')
  const [bankOverride, setBankOverride] = useState<BankFormat | null>(null)
  const [preview, setPreview] = useState<Transaction[]>([])
  const [analytics, setAnalytics] = useState('')
  const [imported, setImported] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')

  const activeBank = bankOverride ?? detectedBank

  const previewSummary = useMemo(() => {
    const payments = preview.filter((t) => t.type === 'payment').length
    const incomes = preview.filter((t) => t.type === 'income').length
    const failedDebits = preview.filter((t) => t.type === 'failed_debit').length
    const penalties = preview.filter((t) => t.type === 'penalty').length
    return { payments, incomes, failedDebits, penalties }
  }, [preview])

  const handleAiTextChange = (value: string): void => {
    setAiText(value)
    if (value.trim().length > 20) {
      const detected = detectBankFormat(value)
      setDetectedBank(detected)
    } else {
      setDetectedBank('generic')
    }
  }

  const handleParse = (): void => {
    // Try the pipe-delimited format first; if it's a raw statement, parse it deterministically.
    let parsed = parseImportText(text)
    if (parsed.length === 0) {
      parsed = parseRawStatement(text, detectBankFormat(text))
    }
    setPreview(parsed)
    setImported(false)
  }

  const handleAiParse = async (): Promise<void> => {
    setAiLoading(true)
    setAiError('')
    setPreview([])
    setAnalytics('')
    setImported(false)

    // Smart detection: if text is already pipe-delimited, parse directly
    const lines = aiText.trim().split('\n').filter((l) => l.trim())
    const pipeLines = lines.filter((l) => l.split('|').length >= 5 && /^\d{4}-\d{2}-\d{2}/.test(l.trim()))
    if (pipeLines.length >= lines.length * 0.6 && pipeLines.length >= 1) {
      const parsed = parseImportText(aiText)
      if (parsed.length > 0) {
        setPreview(parsed)
        setAiLoading(false)
        return
      }
    }

    // Deterministic raw-statement parser (offline, no AI) for Sparkasse / Revolut.
    const rawParsed = parseRawStatement(aiText, activeBank)
    if (rawParsed.length > 0) {
      setPreview(rawParsed)
      setAiLoading(false)
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 300_000) // 5 min

    try {
      const { system, prompt } = buildPrompt(activeBank, aiText, extraConditions)

      const res = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'llama3.1:latest',
          stream: false,
          system,
          prompt,
          options: { temperature: 0.1, num_predict: 4096 }
        })
      })

      clearTimeout(timeout)

      if (!res.ok) {
        throw new Error(`Ollama Fehler: ${res.status}`)
      }

      const data: { response: string } = await res.json()
      const { transactionLines, analytics: analyticsText } = parseAiResponse(data.response)
      const parsed = parseImportText(transactionLines)

      if (parsed.length === 0) {
        const preview = data.response.slice(0, 300)
        setAiError(`ИИ не смог распознать транзакции. Ответ модели:\n${preview}`)
      } else {
        setPreview(parsed)
        setAnalytics(analyticsText)
      }
    } catch (err) {
      clearTimeout(timeout)
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('abort') || message.includes('Abort')) {
        setAiError('Таймаут: ИИ не ответил за 5 минут. Попробуй вставить меньше текста.')
      } else if (message.includes('fetch') || message.includes('network') || message.includes('Failed')) {
        setAiError('ИИ недоступен. Убедись, что Ollama запущена (ollama serve).')
      } else {
        setAiError(`Ошибка: ${message}`)
      }
    } finally {
      setAiLoading(false)
    }
  }

  const handleConfirm = async (): Promise<void> => {
    const batchId = crypto.randomUUID()
    const tagged = preview.map((t) => ({ ...t, batchId }))
    await onImport(tagged)

    const record: ImportRecord = {
      id: batchId,
      date: new Date().toISOString(),
      bank: activeBank,
      transactionCount: tagged.length,
      period: detectPeriodFromTransactions(tagged)
    }
    await onAddImportRecord(record)

    setImported(true)
    setText('')
    setAiText('')
    setPreview([])
    setAnalytics('')
    setDetectedBank('generic')
    setBankOverride(null)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h2 className="text-xl font-semibold text-neutral-200">Импорт текста</h2>

      <div className="flex gap-1 rounded-lg bg-neutral-800/50 p-1">
        <button
          onClick={() => { setTab('manual'); setPreview([]); setAiError(''); setImported(false); setAnalytics('') }}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
            tab === 'manual'
              ? 'bg-neutral-700 text-white'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          Вручную
        </button>
        <button
          onClick={() => { setTab('ai'); setPreview([]); setAiError(''); setImported(false); setAnalytics('') }}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
            tab === 'ai'
              ? 'bg-neutral-700 text-white'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          ИИ-импорт
        </button>
      </div>

      {tab === 'manual' && (
        <>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Вставь сырую выписку Sparkasse/Revolut — распознается автоматически.&#10;&#10;Или готовый формат: ДАТА | СУММА | ТИП | ИСТОЧНИК | ОПИСАНИЕ&#10;2024-03-15 | 49.90 | payment | Klarna | Rechnung März"
            rows={10}
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 p-3 font-mono text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
          />
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1 }}>
          <Button onClick={handleParse} disabled={!text.trim()}>
            Импортировать
          </Button>
          </motion.div>
        </>
      )}

      {tab === 'ai' && (
        <>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 }}>
          <textarea
            value={aiText}
            onChange={(e) => handleAiTextChange(e.target.value)}
            placeholder="Вставь сюда любой текст из банковской выписки —&#10;ИИ распознает транзакции автоматически..."
            rows={10}
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 p-3 font-mono text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
          />
          </motion.div>

          {/* Bank detection badge + manual override */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1 }}>
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${bankColors[activeBank]}`}>
              <span>🏦</span>
              Erkannte Bank: {bankLabels[activeBank]}
            </span>

            <select
              value={bankOverride ?? ''}
              onChange={(e) => setBankOverride(e.target.value ? (e.target.value as BankFormat) : null)}
              title="Bank manuell auswählen"
              className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 focus:border-neutral-500 focus:outline-none"
            >
              <option value="">Auto-Erkennung</option>
              {overrideOptions.map((b) => (
                <option key={b} value={b}>{bankLabels[b]}</option>
              ))}
            </select>
          </div>

          {/* Extra conditions toggle + textarea */}
          <div className="space-y-2">
            <button
              onClick={() => setShowExtraConditions(!showExtraConditions)}
              className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Дополнительные условия
              {showExtraConditions ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            {showExtraConditions && (
              <textarea
                value={extraConditions}
                onChange={(e) => setExtraConditions(e.target.value)}
                placeholder="Дополнительные инструкции для ИИ...&#10;&#10;Напр.: Все платежи с Netflix считай подпиской.&#10;Vodafone через PayPal — это Spotify."
                rows={4}
                className="w-full rounded-md border border-neutral-700/50 bg-neutral-800/50 p-3 text-xs text-neutral-300 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
              />
            )}
          </div>

          <Button onClick={handleAiParse} disabled={!aiText.trim() || aiLoading}>
            {aiLoading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                ИИ анализирует...
              </span>
            ) : (
              'Анализировать'
            )}
          </Button>
          {aiError && (
            <p className="text-sm text-red-400">{aiError}</p>
          )}
          </motion.div>
        </>
      )}

      {preview.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-3"
        >
          <p className="text-sm text-neutral-400">
            <span className="font-medium text-neutral-200">{preview.length}</span> транзакций
            распознано
          </p>

          {/* Grouped operations preview */}
          <PreviewGrouped transactions={preview} />

          {/* Summary line */}
          <p className="text-xs text-neutral-500">
            {preview.length} Transaktionen erkannt:{' '}
            {previewSummary.payments} Zahlungen &middot;{' '}
            {previewSummary.incomes} Gutschriften &middot;{' '}
            {previewSummary.failedDebits} Rücklastschriften &middot;{' '}
            {previewSummary.penalties} Gebühren
          </p>

          {/* AI Analytics block */}
          {analytics && (
            <div className="rounded-xl border border-purple-800/40 bg-purple-950/20 p-4">
              <h4 className="mb-2 text-xs font-medium text-purple-400">ИИ-аналитика</h4>
              <p className="whitespace-pre-line text-xs leading-relaxed text-neutral-300">{analytics}</p>
            </div>
          )}

          <motion.div whileTap={{ scale: 0.97 }}>
            <Button onClick={handleConfirm}>Подтвердить и сохранить</Button>
          </motion.div>
        </motion.div>
      )}

      {imported && (
        <p className="text-sm text-green-400">Транзакции успешно сохранены!</p>
      )}

      {/* Import history */}
      <ImportHistory history={importHistory} onDeleteBatch={onDeleteBatch} />
    </div>
  )
}

function PreviewGrouped({ transactions }: { transactions: Transaction[] }): React.JSX.Element {
  const { groups, ungrouped } = useMemo(() => getTransactionGroups(transactions), [transactions])

  return (
    <div className="space-y-3">
      {/* Grouped operations */}
      {groups.map((g) => (
        <TransactionGroupCard key={g.id} group={g} defaultOpen />
      ))}

      {/* Ungrouped as simple table */}
      {ungrouped.length > 0 && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50">
          {groups.length > 0 && (
            <div className="border-b border-neutral-800 px-4 py-2">
              <span className="text-xs text-neutral-500">Одиночные транзакции</span>
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-left text-neutral-400">
                <th className="px-4 py-2">Дата</th>
                <th className="px-4 py-2">Сумма</th>
                <th className="px-4 py-2">Тип</th>
                <th className="px-4 py-2">Источник</th>
                <th className="px-4 py-2">Описание</th>
              </tr>
            </thead>
            <tbody>
              {ungrouped.map((t) => (
                <tr key={t.id} className={`border-b border-neutral-800/50 ${rowBorderColor[t.type]}`}>
                  <td className="px-4 py-2 text-neutral-200">{t.date}</td>
                  <td className="px-4 py-2 text-neutral-200">
                    {t.amount.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                  </td>
                  <td className="px-4 py-2 text-neutral-300">{t.type}</td>
                  <td className="px-4 py-2 text-neutral-300">
                    <span className="flex items-center gap-2">
                      <SourceLogo source={t.source} />
                      {t.source}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-neutral-400">{t.description || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ImportHistory({
  history,
  onDeleteBatch
}: {
  history: ImportRecord[]
  onDeleteBatch: (batchId: string) => Promise<void>
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  if (history.length === 0) return null

  const sorted = [...history].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/50">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
      >
        <span>Importverlauf ({history.length})</span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="border-t border-neutral-800 px-4 py-2 space-y-1">
          {sorted.map((rec) => {
            const d = new Date(rec.date)
            const dateStr = d.toLocaleDateString('de-DE', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric'
            })
            return (
              <div key={rec.id} className="flex items-center justify-between py-1.5 text-xs">
                <span className="text-neutral-300">
                  {dateStr} — {bankLabels[rec.bank]} — {rec.transactionCount} Transaktionen — {rec.period}
                </span>
                <div className="flex items-center gap-1">
                  {confirmId === rec.id ? (
                    <>
                      <button
                        onClick={async () => { await onDeleteBatch(rec.id); setConfirmId(null) }}
                        className="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-red-900/30"
                      >
                        Löschen
                      </button>
                      <button
                        onClick={() => setConfirmId(null)}
                        className="rounded px-2 py-0.5 text-xs text-neutral-500 hover:text-neutral-300"
                      >
                        Abbrechen
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmId(rec.id)}
                      title="Import löschen"
                      className="rounded p-1 text-neutral-600 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
