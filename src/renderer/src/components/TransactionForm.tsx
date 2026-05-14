import { useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import type { Transaction } from '../types'
import { Button } from './ui/button'
import { SourceLogo } from './SourceLogo'
import { formatLocalDate } from '../utils/financialEngine'

interface TransactionFormProps {
  onSave: (t: Omit<Transaction, 'id' | 'createdAt'>) => Promise<void>
}

const sourceOptions: Transaction['source'][] = ['Sparkasse', 'Revolut', 'PayPal']

const typeOptions: { value: Transaction['type']; label: string }[] = [
  { value: 'payment', label: 'Оплата' },
  { value: 'income', label: 'Доход' },
  { value: 'failed_debit', label: 'Lastschrift-Rückgabe' },
  { value: 'penalty', label: 'Штраф' }
]

const fieldVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.35, ease: [0.4, 0, 0.2, 1] }
  })
}

export function TransactionForm({ onSave }: TransactionFormProps): React.JSX.Element {
  const [date, setDate] = useState(formatLocalDate(new Date()))
  const [amount, setAmount] = useState('')
  const [source, setSource] = useState<Transaction['source']>('Sparkasse')
  const [type, setType] = useState<Transaction['type']>('payment')
  const [penaltySource, setPenaltySource] = useState<'bank' | 'service'>('bank')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const parsedAmount = parseFloat(amount.replace(',', '.'))
    if (isNaN(parsedAmount) || parsedAmount <= 0) return

    setSaving(true)
    await onSave({
      date,
      amount: parsedAmount,
      source,
      type,
      ...(type === 'penalty' ? { penaltySource } : {}),
      description: description || undefined
    })
    setAmount('')
    setDescription('')
    setSaving(false)
  }

  return (
    <div className="mx-auto max-w-lg">
      <motion.h2
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mb-6 text-xl font-semibold text-neutral-200"
      >
        Новая транзакция
      </motion.h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <motion.div custom={0} variants={fieldVariants} initial="hidden" animate="visible">
          <label className="mb-1 block text-sm text-neutral-400">Дата</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            title="Дата транзакции"
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-200 focus:border-neutral-500 focus:outline-none [&::-webkit-calendar-picker-indicator]:invert"
          />
        </motion.div>

        <motion.div custom={1} variants={fieldVariants} initial="hidden" animate="visible">
          <label className="mb-1 block text-sm text-neutral-400">Сумма (€)</label>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-200 focus:border-neutral-500 focus:outline-none"
          />
        </motion.div>

        <motion.div custom={2} variants={fieldVariants} initial="hidden" animate="visible">
          <label className="mb-1 block text-sm text-neutral-400">Источник</label>
          <div className="flex gap-2">
            {sourceOptions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSource(s)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-all duration-200 ${
                  source === s
                    ? 'border-blue-500/50 bg-blue-950/30 text-white'
                    : 'border-neutral-700 bg-neutral-900 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200'
                }`}
              >
                <SourceLogo source={s} size="sm" />
                {s}
              </button>
            ))}
          </div>
        </motion.div>

        <motion.div custom={3} variants={fieldVariants} initial="hidden" animate="visible">
          <label className="mb-1 block text-sm text-neutral-400">Тип</label>
          <div className="relative">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as Transaction['type'])}
              title="Тип транзакции"
              className="w-full appearance-none rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 pr-9 text-neutral-200 focus:border-neutral-500 focus:outline-none"
            >
              {typeOptions.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          </div>
        </motion.div>

        {type === 'penalty' && (
          <motion.div custom={4} variants={fieldVariants} initial="hidden" animate="visible">
            <label className="mb-1 block text-sm text-neutral-400">Источник штрафа</label>
            <div className="relative">
              <select
                value={penaltySource}
                onChange={(e) => setPenaltySource(e.target.value as 'bank' | 'service')}
                title="Источник штрафа"
                className="w-full appearance-none rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 pr-9 text-neutral-200 focus:border-neutral-500 focus:outline-none"
              >
                <option value="bank">Bank (Lastschrift-Rückgabe Gebühr)</option>
                <option value="service">Dienstleister (z.B. DVB, Vodafone Mahngebühr)</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            </div>
          </motion.div>
        )}

        <motion.div custom={5} variants={fieldVariants} initial="hidden" animate="visible">
          <label className="mb-1 block text-sm text-neutral-400">Описание (необязательно)</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="напр. Rechnung März"
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-200 focus:border-neutral-500 focus:outline-none"
          />
        </motion.div>

        <motion.div custom={6} variants={fieldVariants} initial="hidden" animate="visible" whileTap={{ scale: 0.97 }}>
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </motion.div>
      </form>
    </div>
  )
}
