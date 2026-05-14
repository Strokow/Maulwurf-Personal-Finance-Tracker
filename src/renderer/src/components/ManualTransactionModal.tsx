import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus } from 'lucide-react'
import type { Transaction } from '../types'
import { Button } from './ui/button'
import { formatLocalDate } from '../utils/financialEngine'

interface ManualTransactionModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (t: Omit<Transaction, 'id' | 'createdAt'>) => Promise<void>
}

export function ManualTransactionModal({
  isOpen,
  onClose,
  onSave
}: ManualTransactionModalProps): React.JSX.Element {
  const [date, setDate] = useState(formatLocalDate(new Date()))
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<{ date?: string; amount?: string }>({})

  const validate = (): boolean => {
    const newErrors: { date?: string; amount?: string } = {}
    
    if (!date) {
      newErrors.date = 'Дата обязательна'
    }
    
    const parsedAmount = parseFloat(amount.replace(',', '.'))
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      newErrors.amount = 'Введите корректную сумму'
    }
    
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    
    if (!validate()) return

    const parsedAmount = parseFloat(amount.replace(',', '.'))
    
    setSaving(true)
    try {
      await onSave({
        date,
        amount: parsedAmount,
        source: 'Пятак',
        type: 'income',
        description: description || undefined
      })
      
      // Reset form
      setDate(formatLocalDate(new Date()))
      setAmount('')
      setDescription('')
      setErrors({})
      onClose()
    } catch (error) {
      console.error('Error saving manual transaction:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleClose = () => {
    setAmount('')
    setDescription('')
    setErrors({})
    onClose()
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-neutral-100">
                Добавить транзакцию вручную
              </h3>
              <button
                onClick={handleClose}
                className="rounded p-1 text-neutral-400 hover:text-neutral-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Amount */}
              <div>
                <label className="mb-1 block text-sm text-neutral-400">
                  Сумма (€) <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value)
                    if (errors.amount) setErrors(prev => ({ ...prev, amount: undefined }))
                  }}
                  className={`w-full rounded-md border bg-neutral-800 px-3 py-2 text-neutral-200 focus:outline-none ${
                    errors.amount
                      ? 'border-red-500 focus:border-red-500'
                      : 'border-neutral-700 focus:border-neutral-500'
                  }`}
                />
                {errors.amount && (
                  <p className="mt-1 text-xs text-red-400">{errors.amount}</p>
                )}
              </div>

              {/* Date */}
              <div>
                <label className="mb-1 block text-sm text-neutral-400">
                  Дата получения <span className="text-red-400">*</span>
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value)
                    if (errors.date) setErrors(prev => ({ ...prev, date: undefined }))
                  }}
                  className={`w-full rounded-md border bg-neutral-800 px-3 py-2 text-neutral-200 focus:outline-none [&::-webkit-calendar-picker-indicator]:invert ${
                    errors.date
                      ? 'border-red-500 focus:border-red-500'
                      : 'border-neutral-700 focus:border-neutral-500'
                  }`}
                />
                {errors.date && (
                  <p className="mt-1 text-xs text-red-400">{errors.date}</p>
                )}
              </div>

              {/* Description */}
              <div>
                <label className="mb-1 block text-sm text-neutral-400">
                  Комментарий <span className="text-neutral-600">(необязательно)</span>
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="напр. Возврат средств"
                  className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
                />
              </div>

              {/* Buttons */}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 rounded-md border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100"
                >
                  Отмена
                </button>
                <Button type="submit" className="flex-1" disabled={saving}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  {saving ? 'Сохранение...' : 'Добавить'}
                </Button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
