import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronDown,
  XCircle,
  CheckCircle,
  RotateCcw,
  Landmark,
  CreditCard,
  Banknote,
  AlertTriangle,
  X
} from 'lucide-react'
import type { Transaction, TransactionGroup } from '../types'
import { SourceLogo } from './SourceLogo'

const statusConfig = {
  failed: {
    icon: XCircle,
    label: 'Неудачный платёж',
    emoji: '❌',
    color: 'text-red-400',
    border: 'border-red-800/50 bg-red-950/20'
  },
  refunded: {
    icon: RotateCcw,
    label: 'Возврат',
    emoji: '↩️',
    color: 'text-orange-400',
    border: 'border-orange-800/40 bg-orange-950/20'
  },
  successful: {
    icon: CheckCircle,
    label: 'Успешный',
    emoji: '✅',
    color: 'text-green-400',
    border: 'border-green-800/40 bg-green-950/20'
  }
}

const typeIcons: Record<Transaction['type'], React.ReactNode> = {
  payment: <CreditCard className="h-3.5 w-3.5 text-red-400" />,
  income: <Banknote className="h-3.5 w-3.5 text-green-400" />,
  failed_debit: <XCircle className="h-3.5 w-3.5 text-orange-400" />,
  penalty: <AlertTriangle className="h-3.5 w-3.5 text-orange-400" />
}

const typeLabels: Record<Transaction['type'], string> = {
  payment: 'Списание',
  income: 'Возврат',
  failed_debit: 'Отклонено',
  penalty: 'Комиссия'
}

interface TransactionGroupCardProps {
  group: TransactionGroup
  defaultOpen?: boolean
  onDismiss?: (groupId: string) => void
}

export function TransactionGroupCard({
  group,
  defaultOpen = false,
  onDismiss
}: TransactionGroupCardProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  const cfg = statusConfig[group.status]
  const Icon = cfg.icon
  const mainSource = group.transactions[0].source
  const failedDebit = group.transactions.find((t) => t.type === 'failed_debit')
  const displayAmount = failedDebit?.amount ?? Math.abs(group.netEffect)

  return (
    <div
      className={`relative rounded-xl border ${cfg.border} transition-all duration-300 hover:shadow-lg hover:shadow-neutral-950/30`}
    >
      {/* Header — clickable accordion */}
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors duration-200 hover:bg-neutral-800/30 rounded-xl"
      >
        <div className="flex items-center gap-3">
          <Icon className={`h-4 w-4 ${cfg.color}`} />
          <SourceLogo source={mainSource} />
          <div>
            <span className="text-sm font-medium text-neutral-200">{group.label}</span>
            <span className="ml-2 text-xs text-neutral-500">
              {group.transactions.length} операций
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-medium ${cfg.color}`}>
            {cfg.emoji} {cfg.label}
          </span>
          <span className="text-sm font-medium text-red-400">
            -{displayAmount.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
          </span>
          <ChevronDown
            className={`h-4 w-4 text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {/* Dismiss button */}
      {onDismiss && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDismiss(group.id)
          }}
          className="absolute right-2 top-2 rounded p-0.5 text-neutral-600 transition-all duration-200 hover:bg-neutral-800 hover:text-red-400"
          title="Убрать из списка"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Expanded detail rows */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-1 px-4 pb-3">
              {group.transactions.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-lg bg-neutral-900/60 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    {typeIcons[t.type]}
                    <span className="text-xs text-neutral-400">{typeLabels[t.type]}</span>
                    {t.type === 'penalty' && <Landmark className="h-3 w-3 text-orange-500/60" />}
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-neutral-500">{t.date}</span>
                    <span className="text-xs text-neutral-400">{t.description || '–'}</span>
                    <span
                      className={`text-xs font-medium ${
                        t.type === 'income' ? 'text-green-400' : 'text-red-400'
                      }`}
                    >
                      {t.type === 'income' ? '+' : '-'}
                      {t.amount.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
