import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import type { Obligation, ObligationType, BillingChain, ObligationFrequency } from '../types'
import { Button } from './ui/button'

interface AddObligationModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (obligation: Omit<Obligation, 'id' | 'createdAt'>, klarnaPaidInstallments?: number) => void
  editObligation?: Obligation | null
  preselectedType?: ObligationType
  preselectedFrequency?: ObligationFrequency
  klarnaPaidCount?: number
}

const billingOptions: { value: BillingChain; label: string }[] = [
  { value: 'sparkasse_direct', label: 'Sparkasse direkt' },
  { value: 'vodafone_contract', label: 'Vodafone-Vertrag' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'klarna', label: 'Klarna' },
  { value: 'other', label: 'Другое' }
]

const sourceOptions = ['Sparkasse', 'Revolut', 'PayPal']

interface FormState {
  name: string
  type: ObligationType
  amount: string
  approximateDay: string
  billingChain: BillingChain
  source: string
  notes: string
  frequency: ObligationFrequency
  yearlyMonth: string
  totalInstallments: string
  originalTotal: string
  paidInstallments: string
}

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
]

const emptyForm: FormState = {
  name: '',
  type: 'subscription',
  amount: '',
  approximateDay: '',
  billingChain: 'sparkasse_direct',
  source: 'Sparkasse',
  notes: '',
  frequency: 'monthly',
  yearlyMonth: '',
  totalInstallments: '',
  originalTotal: '',
  paidInstallments: '',
}

export function AddObligationModal({
  isOpen,
  onClose,
  onSave,
  editObligation,
  preselectedType,
  preselectedFrequency,
  klarnaPaidCount,
}: AddObligationModalProps): React.JSX.Element {
  const [form, setForm] = useState<FormState>(emptyForm)
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen) {
      if (editObligation) {
        setForm({
          name: editObligation.name,
          type: editObligation.type,
          amount: editObligation.amount !== null ? String(editObligation.amount) : '',
          approximateDay:
            editObligation.approximateDay !== null ? String(editObligation.approximateDay) : '',
          billingChain: editObligation.billingChain,
          source: editObligation.source,
          notes: editObligation.notes ?? '',
          frequency: editObligation.frequency ?? 'monthly',
          yearlyMonth: editObligation.yearlyMonth != null ? String(editObligation.yearlyMonth) : '',
          totalInstallments: editObligation.totalInstallments != null ? String(editObligation.totalInstallments) : '',
          originalTotal: editObligation.originalTotal != null ? String(editObligation.originalTotal) : '',
          paidInstallments: klarnaPaidCount != null ? String(klarnaPaidCount) : '0',
        })
      } else {
        setForm({
          ...emptyForm,
          type: preselectedType ?? 'subscription',
          frequency: preselectedFrequency ?? 'monthly',
        })
      }
    }
  }, [isOpen, editObligation, preselectedType, preselectedFrequency])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  const handleBackdropMouseDown = (e: React.MouseEvent): void => {
    if (e.target === backdropRef.current) onClose()
  }

  const handleSave = (): void => {
    if (!form.name.trim()) return
    const isKlarna = form.billingChain === 'klarna'
    const paidInst = isKlarna && form.paidInstallments ? parseInt(form.paidInstallments, 10) : undefined
    onSave({
      name: form.name.trim(),
      type: form.type,
      amount: form.amount ? parseFloat(form.amount) : null,
      approximateDay: form.approximateDay ? parseInt(form.approximateDay, 10) : null,
      billingChain: form.billingChain,
      source: form.source,
      notes: form.notes.trim() || undefined,
      isActive: editObligation ? editObligation.isActive : true,
      frequency: form.frequency,
      yearlyMonth: form.frequency === 'yearly' && form.yearlyMonth ? parseInt(form.yearlyMonth, 10) : null,
      totalInstallments: isKlarna && form.totalInstallments ? parseInt(form.totalInstallments, 10) : undefined,
      originalTotal: isKlarna && form.originalTotal ? parseFloat(form.originalTotal) : undefined,
    }, paidInst)
    onClose()
  }

  const update = (field: keyof FormState, value: string): void => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={backdropRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={handleBackdropMouseDown}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-900 p-6"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-neutral-100">
                {editObligation ? 'Редактировать обязательство' : 'Новое обязательство'}
              </h2>
              <button
                onClick={onClose}
                title="Закрыть"
                className="rounded-md p-1 text-neutral-500 hover:text-neutral-300"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Form fields */}
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-neutral-400">Название</label>
                <input
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  placeholder="напр. Netflix, Vodafone..."
                  className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-neutral-400">Тип</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => update('type', 'subscription')}
                    className={`flex-1 rounded-md px-3 py-2 text-sm ${
                      form.type === 'subscription'
                        ? 'bg-neutral-700 text-white'
                        : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    Подписка (автоматическая)
                  </button>
                  <button
                    onClick={() => update('type', 'manual_payment')}
                    className={`flex-1 rounded-md px-3 py-2 text-sm ${
                      form.type === 'manual_payment'
                        ? 'bg-neutral-700 text-white'
                        : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    Ручной платёж
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-neutral-400">Сумма (€)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.amount}
                    onChange={(e) => update('amount', e.target.value)}
                    placeholder="Оставить пустым"
                    className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-neutral-400">
                    Примерная дата (1-31)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={form.approximateDay}
                    onChange={(e) => update('approximateDay', e.target.value)}
                    placeholder="Неизвестно"
                    className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-neutral-400">Zahlungskette</label>
                  <select
                    value={form.billingChain}
                    onChange={(e) => update('billingChain', e.target.value)}
                    title="Zahlungskette"
                    className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 focus:border-neutral-500 focus:outline-none"
                  >
                    {billingOptions.map((b) => (
                      <option key={b.value} value={b.value}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-neutral-400">Счёт</label>
                  <select
                    value={form.source}
                    onChange={(e) => update('source', e.target.value)}
                    title="Konto"
                    className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 focus:border-neutral-500 focus:outline-none"
                  >
                    {sourceOptions.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-neutral-400">Периодичность</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setForm(prev => ({ ...prev, frequency: 'monthly', yearlyMonth: '' }))}
                    className={`flex-1 rounded-md px-3 py-2 text-sm ${
                      form.frequency === 'monthly'
                        ? 'bg-neutral-700 text-white'
                        : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    Ежемесячный
                  </button>
                  <button
                    onClick={() => setForm(prev => ({ ...prev, frequency: 'yearly' }))}
                    className={`flex-1 rounded-md px-3 py-2 text-sm ${
                      form.frequency === 'yearly'
                        ? 'bg-neutral-700 text-white'
                        : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    Ежегодный
                  </button>
                  <button
                    onClick={() => setForm(prev => ({ ...prev, frequency: 'once', yearlyMonth: '' }))}
                    className={`flex-1 rounded-md px-3 py-2 text-sm ${
                      form.frequency === 'once'
                        ? 'bg-neutral-700 text-white'
                        : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    Единоразовый
                  </button>
                </div>
              </div>

              {form.frequency === 'yearly' && (
                <div>
                  <label className="mb-1 block text-xs text-neutral-400">Месяц оплаты</label>
                  <select
                    value={form.yearlyMonth}
                    onChange={(e) => update('yearlyMonth', e.target.value)}
                    title="Месяц оплаты"
                    className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 focus:border-neutral-500 focus:outline-none"
                  >
                    <option value="">Не указан</option>
                    {MONTH_NAMES.map((name, i) => (
                      <option key={i + 1} value={String(i + 1)}>{name}</option>
                    ))}
                  </select>
                </div>
              )}

              {form.billingChain === 'klarna' && (
                <div className="rounded-lg border border-pink-900/40 bg-pink-950/20 p-3 space-y-3">
                  <p className="text-xs font-medium text-pink-400">Рассрочка Klarna</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="mb-1 block text-xs text-neutral-400">Всего платежей</label>
                      <input
                        type="number"
                        min="1"
                        value={form.totalInstallments}
                        onChange={(e) => update('totalInstallments', e.target.value)}
                        placeholder="6"
                        className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-neutral-400">Оплачено</label>
                      <input
                        type="number"
                        min="0"
                        max={form.totalInstallments || undefined}
                        value={form.paidInstallments}
                        onChange={(e) => update('paidInstallments', e.target.value)}
                        placeholder="0"
                        className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-neutral-400">Общий долг (€)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.originalTotal}
                        onChange={(e) => update('originalTotal', e.target.value)}
                        placeholder="—"
                        className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs text-neutral-400">Заметки (необязательно)</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => update('notes', e.target.value)}
                  rows={2}
                  placeholder="Дополнительная информация..."
                  className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-md px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200"
              >
                Отмена
              </button>
              <Button onClick={handleSave} disabled={!form.name.trim()}>
                {editObligation ? 'Сохранить' : 'Добавить'}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
