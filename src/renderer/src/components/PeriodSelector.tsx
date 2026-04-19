import type { Period, PeriodRange } from '../types'
import { Button } from './ui/button'

interface PeriodSelectorProps {
  period: Period
  customRange: PeriodRange
  onPeriodChange: (p: Period) => void
  onCustomRangeChange: (r: PeriodRange) => void
}

const buttons: { label: string; value: Period }[] = [
  { label: 'Этот месяц', value: 'this_month' },
  { label: 'Прошлый месяц', value: 'last_month' },
  { label: 'Позапрошлый месяц', value: 'month_before_last' },
  { label: 'Произвольный', value: 'custom' }
]

export function PeriodSelector({
  period,
  customRange,
  onPeriodChange,
  onCustomRangeChange
}: PeriodSelectorProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {buttons.map((b) => (
        <Button
          key={b.value}
          variant={period === b.value ? 'default' : 'outline'}
          size="sm"
          onClick={() => onPeriodChange(b.value)}
        >
          {b.label}
        </Button>
      ))}
      {period === 'custom' && (
        <div className="ml-2 flex items-center gap-2">
          <input
            type="date"
            value={customRange.from}
            onChange={(e) => onCustomRangeChange({ ...customRange, from: e.target.value })}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200"
          />
          <span className="text-neutral-500">–</span>
          <input
            type="date"
            value={customRange.to}
            onChange={(e) => onCustomRangeChange({ ...customRange, to: e.target.value })}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200"
          />
        </div>
      )}
    </div>
  )
}
