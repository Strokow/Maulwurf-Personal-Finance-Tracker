import { motion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'

interface StatCardProps {
  title: string
  value: number
  icon: LucideIcon
  accentColor: 'red' | 'green' | 'orange'
}

const colorMap = {
  red: {
    bg: 'bg-red-950/50',
    border: 'border-red-800/50',
    text: 'text-red-400',
    icon: 'text-red-500'
  },
  green: {
    bg: 'bg-green-950/50',
    border: 'border-green-800/50',
    text: 'text-green-400',
    icon: 'text-green-500'
  },
  orange: {
    bg: 'bg-orange-950/50',
    border: 'border-orange-800/50',
    text: 'text-orange-400',
    icon: 'text-orange-500'
  }
}

export function StatCard({ title, value, icon: Icon, accentColor }: StatCardProps): React.JSX.Element {
  const colors = colorMap[accentColor]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`rounded-xl border ${colors.border} ${colors.bg} p-5`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-neutral-400">{title}</p>
          <p className={`mt-1 text-2xl font-bold ${colors.text}`}>
            {value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
          </p>
        </div>
        <Icon className={`h-8 w-8 ${colors.icon}`} />
      </div>
    </motion.div>
  )
}
