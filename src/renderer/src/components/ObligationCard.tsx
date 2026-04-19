import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Pencil, Trash2, AlertTriangle, Clock, Copy, ChevronLeft, ChevronRight, CalendarCheck, Link2, Unlink, ChevronsRight } from 'lucide-react'
import type { Obligation, ObligationMonth, ObligationStatus } from '../types'

const GENITIVE_MONTHS = [
  '', 'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
]

const NOM_MONTHS = [
  '', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
]

const statusConfig: Record<ObligationStatus, { label: string; color: string }> = {
  paid: { label: 'Оплачено', color: 'bg-green-900/50 text-green-300' },
  unpaid: { label: 'Не оплачено', color: 'bg-red-900/50 text-red-300' },
  unknown: { label: 'Неизвестно', color: 'bg-neutral-800 text-neutral-400' },
  skipped: { label: 'Скрыто', color: 'bg-neutral-800 text-neutral-600' }
}

const chainLabels: Record<string, string> = {
  sparkasse_direct: 'Sparkasse direkt',
  vodafone_contract: 'Vodafone-Vertrag',
  paypal: 'PayPal',
  klarna: 'Klarna',
  other: 'Другое'
}

const MONTH_NAMES = [
  '', 'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн',
  'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'
]

function fmtEur(n: number): string {
  return n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
}

interface YearlyPaidUntilInfo {
  paidMonth: number
  paidYear: number
  untilMonth: number
  untilYear: number
}

interface ObligationCardProps {
  obligation: Obligation
  currentMonthRecord: ObligationMonth | null
  carriedFrom?: { fromYear: number; fromMonth: number; months: number; totalDebt: number; resolved?: boolean }
  yearlyPaidUntil?: YearlyPaidUntilInfo
  onEdit: (obligation: Obligation) => void
  onDelete: (id: string) => void
  onStatusChange: (obligationId: string, status: ObligationStatus) => void
  onCopy: (obligation: Obligation, targetYear: number, targetMonth: number) => void
  isChild?: boolean
  isParent?: boolean
  parentName?: string
  childCount?: number
  onUnlink?: (obligationId: string) => void
  klarnaPaidCount?: number
  onCarryDebt?: () => void
  carriedToYear?: number
  carriedToMonth?: number
  onPayCarried?: () => void
  onPayAll?: () => void
}

export function ObligationCard({
  obligation,
  currentMonthRecord,
  carriedFrom,
  yearlyPaidUntil,
  onEdit,
  onDelete,
  onStatusChange,
  onCopy,
  isChild,
  isParent,
  parentName,
  childCount,
  onUnlink,
  klarnaPaidCount,
  onCarryDebt,
  carriedToYear,
  carriedToMonth,
  onPayCarried,
  onPayAll,
}: ObligationCardProps): React.JSX.Element {
  const [showMonthPicker, setShowMonthPicker] = useState(false)
  const [pickerYear, setPickerYear] = useState(new Date().getFullYear())
  const [exitDir, setExitDir] = useState<'up' | 'down' | null>(null)

  // For yearly obligations with paid coverage, show as "paid" even without month record
  const isYearlyCovered = obligation.frequency === 'yearly' && !!yearlyPaidUntil
  // Monthly obligations default to 'unpaid' when no record exists — they're active subscriptions
  // that haven't been confirmed as paid yet. Only yearly/once use 'unknown' as default.
  const isMonthly = !obligation.frequency || obligation.frequency === 'monthly'
  const status: ObligationStatus = isYearlyCovered
    ? 'paid'
    : (currentMonthRecord?.status ?? (carriedFrom ? 'unpaid' : isMonthly ? 'unpaid' : 'unknown'))
  const cfg = statusConfig[status]

  const hasCarryover = carriedFrom && carriedFrom.months > 0
  const carryoverResolved = hasCarryover && !!carriedFrom.resolved
  const currentAmount = obligation.amount ?? 0
  const carryDebt = hasCarryover ? carriedFrom.totalDebt : 0
  const combinedTotal = currentAmount + carryDebt

  // Новая система переноса долга
  const rec = currentMonthRecord
  const carriedAmt = rec?.carriedAmount   // сумма перенесённого долга
  const carriedIsPaid = rec?.carriedPaid === true
  const currentIsPaid = rec?.status === 'paid'
  // Есть ли неоплаченный перенесённый долг + текущее обязательство (только для monthly)
  const hasCombinedDebt = rec?.isCarriedOver === true && carriedAmt != null && !carriedIsPaid
  const fullySettled = currentIsPaid && (!rec?.isCarriedOver || carriedIsPaid || carriedAmt == null)
  const isNewCarriedOver = rec?.isCarriedOver === true && !fullySettled
  // Оба месяца оплачены, но оплата источника была с опозданием → Mahnung-риск
  const paidCarryover = rec?.isCarriedOver === true && carriedIsPaid && currentIsPaid && carriedAmt != null

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const approxDay = obligation.approximateDay
  let dueWarning: string | null = null

  if (approxDay !== null && status !== 'paid' && obligation.billingChain !== 'klarna') {
    const year = today.getFullYear()
    const month = today.getMonth()
    let nextDate = new Date(year, month, approxDay)
    nextDate.setHours(0, 0, 0, 0)
    if (nextDate < today) {
      nextDate = new Date(year, month + 1, approxDay)
    }
    const diff = Math.round((nextDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    if (diff >= 0 && diff <= 5) {
      dueWarning =
        diff === 0
          ? 'Оплата сегодня — проверьте баланс!'
          : `Оплата через ${diff} ${diff === 1 ? 'день' : diff < 5 ? 'дня' : 'дней'} — проверьте баланс!`
    }
  }

  const nextStatus: ObligationStatus = status === 'paid' ? 'unpaid' : 'paid'

  const handleStatusClick = (): void => {
    const dir = nextStatus === 'paid' ? 'down' : 'up'
    setExitDir(dir)
    setTimeout(() => {
      onStatusChange(obligation.id, nextStatus)
      setExitDir(null)
    }, 250)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{
        opacity: exitDir ? 0 : 1,
        y: exitDir === 'down' ? 50 : exitDir === 'up' ? -50 : 0,
        scale: exitDir ? 0.97 : 1,
      }}
      transition={{ duration: exitDir ? 0.25 : 0.3, ease: [0.4, 0, 0.2, 1] }}
      className={`rounded-xl border bg-neutral-900/50 p-4${
        isNewCarriedOver
          ? ' border-amber-600/70 ring-1 ring-amber-700/40'
          : paidCarryover
            ? ' border-amber-800/50 ring-1 ring-amber-900/30'
            : hasCarryover && !carryoverResolved
              ? ' border-amber-700/60 ring-1 ring-amber-800/30'
              : isChild
                ? ' border-blue-800/40'
                : isParent
                  ? ' border-blue-700/50 ring-1 ring-blue-900/30'
                  : ' border-neutral-800'
      }`}
    >
      {dueWarning && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-orange-950/40 px-3 py-2 text-sm text-orange-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {dueWarning}
        </div>
      )}

      <div className="flex items-start justify-between">
        <div className="space-y-1.5 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-neutral-100">{obligation.name}</span>
            {isParent && childCount != null && childCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-900/40 px-2 py-0.5 text-xs font-medium text-blue-300">
                <Link2 className="h-3 w-3" />
                {childCount} привязан{childCount === 1 ? 'о' : 'ых'}
              </span>
            )}
            {isChild && parentName && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-900/30 px-2 py-0.5 text-xs font-medium text-blue-400/70">
                <Link2 className="h-3 w-3" />
                через {parentName}
              </span>
            )}
            {isYearlyCovered ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-900/40 px-2 py-0.5 text-xs font-medium text-green-300">
                <CalendarCheck className="h-3 w-3" />
                Оплачено до {GENITIVE_MONTHS[yearlyPaidUntil.untilMonth]} {yearlyPaidUntil.untilYear}
              </span>
            ) : isChild ? (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium cursor-default ${cfg.color} opacity-70`}
                title={`Оплачивается через ${parentName ?? 'родителя'}`}
              >
                {cfg.label}
              </span>
            ) : (
              <button
                onClick={handleStatusClick}
                disabled={exitDir !== null}
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${cfg.color}`}
              >
                {cfg.label}
              </button>
            )}
          </div>
          <p className="text-xs text-neutral-400">
            {obligation.type === 'subscription' ? 'Подписка' : 'Ручной платёж'}
            {' · '}
            {chainLabels[obligation.billingChain] ?? obligation.billingChain}
            {obligation.frequency === 'yearly' && (
              <>
                {' · '}
                <span className="text-purple-400">
                  Ежегодный{obligation.yearlyMonth != null ? ` (${GENITIVE_MONTHS[obligation.yearlyMonth]})` : ''}
                </span>
              </>
            )}
            {obligation.frequency === 'once' && (
              <>
                {' · '}
                <span className="text-orange-400">Единоразовый</span>
              </>
            )}
          </p>

          {/* Amount section — larger display */}
          <div className="pt-1">
            {obligation.amount !== null ? (
              hasCombinedDebt ? (
                // Новая система: объединённый долг (перенос + текущая подписка, ещё не оплачено)
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-neutral-400">
                      Долг с {GENITIVE_MONTHS[rec?.carriedFromMonth ?? 0]}:
                    </span>
                    <span className="font-medium text-amber-300">{fmtEur(carriedAmt!)}</span>
                  </div>
                  {!currentIsPaid && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-neutral-400">Подписка {NOM_MONTHS[rec?.month ?? 0]}:</span>
                      <span className="font-medium text-neutral-200">{fmtEur(currentAmount)}</span>
                    </div>
                  )}
                  {!currentIsPaid && (
                    <div className="border-t border-amber-800/30 pt-1 mt-0.5">
                      <p className="text-lg font-bold text-amber-300">
                        Итого: {fmtEur(currentAmount + carriedAmt!)}
                      </p>
                    </div>
                  )}
                  {currentIsPaid && (
                    <p className="text-xs text-green-400/80">✓ Подписка оплачена, долг ещё не погашен</p>
                  )}
                </div>
              ) : paidCarryover ? (
                // Оба оплачены: показываем разбивку + итог (платёж был с опозданием)
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-neutral-400">
                      {GENITIVE_MONTHS[rec?.carriedFromMonth ?? 0]} {rec?.carriedFromYear}:
                    </span>
                    <span className="font-medium text-green-300">{fmtEur(carriedAmt!)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-neutral-400">{NOM_MONTHS[rec?.month ?? 0]}:</span>
                    <span className="font-medium text-green-300">{fmtEur(currentAmount)}</span>
                  </div>
                  <div className="border-t border-green-800/30 pt-1 mt-0.5">
                    <p className="text-lg font-bold text-green-300">
                      Итого: {fmtEur(currentAmount + carriedAmt!)}
                    </p>
                  </div>
                </div>
              ) : hasCarryover && !carryoverResolved ? (
                // Старая система: накопленный долг
                <div className="space-y-0.5">
                  <p className="text-lg font-bold text-amber-300">
                    Итого: {fmtEur(combinedTotal)}
                  </p>
                  <p className="text-xs text-neutral-400">
                    Этот месяц: {fmtEur(currentAmount)}
                    {' + '}
                    <span className="text-amber-400">
                      долг: {fmtEur(carryDebt)} ({carriedFrom.months} мес.)
                    </span>
                  </p>
                </div>
              ) : (
                <p className="text-lg font-semibold text-neutral-200">
                  {fmtEur(currentAmount)}
                </p>
              )
            ) : (
              <p className="text-sm text-neutral-500">Сумма неизвестна</p>
            )}
            {obligation.approximateDay !== null && (
              <p className="text-xs text-neutral-500 mt-0.5">
                ~{obligation.approximateDay} число месяца
              </p>
            )}
          </div>

          {/* Mahnung-предупреждение: оба оплачены, но оплата была с опозданием */}
          {paidCarryover && rec?.carriedFromMonth != null && (
            <div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-950/40 border border-amber-800/30 px-3 py-2 text-xs text-amber-300">
              <Clock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">
                  Оплата за {GENITIVE_MONTHS[rec.carriedFromMonth]} {rec.carriedFromYear} произведена с опозданием
                </p>
                <p className="text-amber-400/70 mt-0.5">
                  ⚠ Возможно начисление штрафа (Mahnung / Mahngebühr)
                </p>
              </div>
            </div>
          )}

          {/* Mahnung + кнопки оплаты (новая система) */}
          {hasCombinedDebt && rec?.carriedFromMonth != null && (
            <div className="mt-2 space-y-2">
              <div className="flex items-start gap-2 rounded-lg bg-amber-950/40 border border-amber-800/30 px-3 py-2 text-xs text-amber-300">
                <Clock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">
                    Долг с {GENITIVE_MONTHS[rec.carriedFromMonth]} {rec.carriedFromYear} перенесён
                  </p>
                  <p className="text-amber-400/70 mt-0.5">
                    ⚠ За неоплату в срок возможно начисление штрафа (Mahnung / Mahngebühr)
                  </p>
                </div>
              </div>
              {/* Кнопки частичной/полной оплаты */}
              <div className="flex flex-wrap gap-1.5">
                {!currentIsPaid && onPayAll && (
                  <button
                    onClick={onPayAll}
                    className="rounded-md bg-amber-900/40 border border-amber-700/50 px-2.5 py-1 text-xs font-medium text-amber-300 hover:bg-amber-800/50 transition-colors"
                  >
                    Оплатить всё ({fmtEur(currentAmount + carriedAmt!)})
                  </button>
                )}
                {!carriedIsPaid && onPayCarried && (
                  <button
                    onClick={onPayCarried}
                    className="rounded-md bg-neutral-800 border border-neutral-700 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-700 transition-colors"
                  >
                    Погасить долг ({fmtEur(carriedAmt!)})
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Старая система: Carryover warning banner */}
          {hasCarryover && !carryoverResolved && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-950/40 border border-amber-900/30 px-3 py-2 text-xs text-amber-300 mt-1">
              <Clock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">
                  Включён долг с {GENITIVE_MONTHS[carriedFrom.fromMonth]} {carriedFrom.fromYear}
                  {carriedFrom.months > 1 && ` — ${carriedFrom.months} мес.`}
                </p>
                <p className="text-amber-400/70 mt-0.5">
                  ⚠ За неоплату в срок возможно начисление штрафа (Mahnung / Mahngebühr)
                </p>
              </div>
            </div>
          )}

          {/* Новая система: простой бейдж "Перенесён" когда carriedPaid (долг уже погашен) */}
          {isNewCarriedOver && !hasCombinedDebt && rec?.carriedFromMonth != null && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-950/40 border border-amber-800/30 px-3 py-2 text-xs text-amber-300 mt-1">
              <ChevronsRight className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              <span className="font-medium">
                Перенесён с {GENITIVE_MONTHS[rec.carriedFromMonth]} {rec.carriedFromYear}
              </span>
            </div>
          )}

          {/* Заметка в источнике: долг перенесён на следующий месяц */}
          {carriedToMonth != null && carriedToYear != null && (
            <p className="text-xs text-amber-500/70 mt-1 flex items-center gap-1">
              <ChevronsRight className="h-3 w-3" />
              Долг перенесён на {NOM_MONTHS[carriedToMonth]} {carriedToYear}
            </p>
          )}

          {obligation.notes && (
            <p className="text-xs italic text-neutral-600">{obligation.notes}</p>
          )}

          {/* Klarna installment progress — based on paid ObligationMonth count */}
          {obligation.billingChain === 'klarna' && obligation.totalInstallments != null && (() => {
            const paid = klarnaPaidCount ?? 0
            const total = obligation.totalInstallments!
            const fullyPaid = paid >= total
            return fullyPaid ? (
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-green-950/40 border border-green-800/30 px-3 py-2">
                <span className="text-sm font-medium text-green-400">Полностью выплачено</span>
                {obligation.originalTotal != null && (
                  <span className="ml-auto text-xs text-neutral-500">{fmtEur(obligation.originalTotal)}</span>
                )}
              </div>
            ) : (
              <div className="mt-2 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-pink-400/80">
                    {paid}/{total} платежей
                  </span>
                  {obligation.originalTotal != null && (
                    <span className="text-neutral-500">
                      изначальный долг: {fmtEur(obligation.originalTotal)}
                    </span>
                  )}
                </div>
                <div className="h-1.5 w-full rounded-full bg-neutral-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-pink-600 to-pink-400 transition-all duration-500"
                    style={{ width: `${Math.min(100, (paid / total) * 100)}%` }}
                  />
                </div>
              </div>
            )
          })()}
        </div>
        <div className="flex gap-1 ml-2 shrink-0">
          {isChild && onUnlink && (
            <button
              onClick={() => onUnlink(obligation.id)}
              title="Отвязать от родителя"
              className="rounded-md p-1.5 text-neutral-500 hover:bg-orange-950 hover:text-orange-400"
            >
              <Unlink className="h-3.5 w-3.5" />
            </button>
          )}
          {onCarryDebt && (() => {
            // BUG-009: блокируем перенос, если суммы взять неоткуда (ни в обязательстве, ни в факте месяца)
            const noAmount = obligation.amount == null && rec?.actualAmount == null
            return (
              <button
                onClick={noAmount ? undefined : onCarryDebt}
                disabled={noAmount}
                title={noAmount ? 'Укажите сумму обязательства, чтобы перенести долг' : 'Перенести долг на следующий месяц'}
                className={
                  noAmount
                    ? 'rounded-md p-1.5 text-neutral-700 cursor-not-allowed'
                    : 'rounded-md p-1.5 text-amber-600/70 hover:bg-amber-950 hover:text-amber-400'
                }
              >
                <ChevronsRight className="h-3.5 w-3.5" />
              </button>
            )
          })()}
          <button
            onClick={() => setShowMonthPicker(!showMonthPicker)}
            title="Скопировать в другой месяц"
            className="rounded-md p-1.5 text-neutral-500 hover:bg-blue-950 hover:text-blue-400"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onEdit(obligation)}
            title="Редактировать"
            className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onDelete(obligation.id)}
            title="Удалить"
            className="rounded-md p-1.5 text-neutral-500 hover:bg-red-950 hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showMonthPicker && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 overflow-hidden"
          >
            <div className="rounded-lg border border-neutral-700 bg-neutral-800/60 p-3">
              <div className="mb-2 flex items-center justify-between">
                <button
                  onClick={() => setPickerYear(pickerYear - 1)}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="text-xs font-medium text-neutral-300">{pickerYear}</span>
                <button
                  onClick={() => setPickerYear(pickerYear + 1)}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      onCopy(obligation, pickerYear, m)
                      setShowMonthPicker(false)
                    }}
                    className="rounded px-2 py-1 text-xs text-neutral-300 hover:bg-blue-900/50 hover:text-blue-300 transition-colors"
                  >
                    {MONTH_NAMES[m]}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
