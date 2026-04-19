import { motion } from 'framer-motion'
import { AlertTriangle, XCircle, CheckCircle, Landmark, Timer, TrendingDown } from 'lucide-react'
import type { TransactionPair } from '../types'

const chainLabels: Record<string, string> = {
  sparkasse_direct: 'Sparkasse Direkt',
  paypal: 'PayPal',
  vodafone_contract: 'Vodafone Vertrag',
  klarna: 'Klarna',
  revolut_paypal: 'Revolut â†’ PayPal'
}

interface SparkassePairsProps {
  pairs: TransactionPair[]
}

export function SparkassePairs({ pairs }: SparkassePairsProps): React.JSX.Element {
  if (pairs.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-neutral-500">
        Keine RÃ¼cklastschrift-VorgÃ¤nge gefunden.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {pairs.map((pair, i) => {
        const chain = pair.ruecklastschrift.paymentChain ?? 'sparkasse_direct'
        const resolved = pair.wiedergutschrift !== null

        return (
          <motion.div
            key={pair.ruecklastschrift.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: i * 0.06 }}
            className={`rounded-xl border p-4 ${
              resolved ? 'border-orange-800/40 bg-orange-950/20' : 'border-red-800/50 bg-red-950/20'
            }`}
          >
            {/* Header */}
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle
                className={`h-4 w-4 ${resolved ? 'text-orange-400' : 'text-red-400'}`}
              />
              <span className="text-sm font-medium text-neutral-200">
                {chainLabels[chain] ?? chain} â€” RÃ¼cklastschrift
              </span>
            </div>

            {/* Rows */}
            <div className="space-y-1.5">
              {/* RÃ¼cklastschrift */}
              <div className="flex items-center justify-between rounded-lg bg-neutral-900/50 px-3 py-2">
                <span className="flex items-center gap-2 text-sm">
                  <XCircle className="h-4 w-4 text-red-400" />
                  <span className="text-red-300">Fehlgeschlagen</span>
                </span>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-neutral-400">{pair.ruecklastschrift.date}</span>
                  <span className="font-medium text-red-400">
                    {pair.ruecklastschrift.amount.toLocaleString('de-DE', {
                      style: 'currency',
                      currency: 'EUR'
                    })}
                  </span>
                </div>
              </div>

              {/* Wiedergutschrift */}
              <div className="flex items-center justify-between rounded-lg bg-neutral-900/50 px-3 py-2">
                <span className="flex items-center gap-2 text-sm">
                  <CheckCircle
                    className={`h-4 w-4 ${resolved ? 'text-green-400' : 'text-neutral-600'}`}
                  />
                  <span className={resolved ? 'text-green-300' : 'text-red-400'}>
                    {resolved ? 'Wiedergutschrift' : 'Noch nicht erstattet'}
                  </span>
                </span>
                <div className="flex items-center gap-4 text-sm">
                  {pair.wiedergutschrift ? (
                    <>
                      <span className="text-neutral-400">{pair.wiedergutschrift.date}</span>
                      <span className="font-medium text-green-400">
                        {pair.wiedergutschrift.amount.toLocaleString('de-DE', {
                          style: 'currency',
                          currency: 'EUR'
                        })}
                      </span>
                    </>
                  ) : (
                    <span className="text-red-400/70">â€”</span>
                  )}
                </div>
              </div>

              {/* Entgelt */}
              <div className="flex items-center justify-between rounded-lg bg-neutral-900/50 px-3 py-2">
                <span className="flex items-center gap-2 text-sm">
                  <Landmark className="h-4 w-4 text-orange-400" />
                  <span className={pair.entgelt ? 'text-orange-300' : 'text-neutral-500'}>
                    {pair.entgelt ? 'BankgebÃ¼hr' : 'Keine GebÃ¼hr erfasst'}
                  </span>
                </span>
                <div className="flex items-center gap-4 text-sm">
                  {pair.entgelt ? (
                    <>
                      <span className="text-neutral-400">{pair.entgelt.date}</span>
                      <span className="font-medium text-orange-400">
                        {pair.entgelt.amount.toLocaleString('de-DE', {
                          style: 'currency',
                          currency: 'EUR'
                        })}
                      </span>
                    </>
                  ) : (
                    <span className="text-neutral-600">â€”</span>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-3 flex items-center gap-6 text-xs text-neutral-400">
              <span className="flex items-center gap-1.5">
                <Timer className="h-3.5 w-3.5" />
                {pair.daysBetween !== null
                  ? `${pair.daysBetween} ${pair.daysBetween === 1 ? 'Tag' : 'Tage'} bis RÃ¼ckerstattung`
                  : 'Ausstehend'}
              </span>
              {pair.totalCost > 0 && (
                <span className="flex items-center gap-1.5 text-orange-400">
                  <TrendingDown className="h-3.5 w-3.5" />
                  Kosten durch GebÃ¼hr:{' '}
                  {pair.totalCost.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                </span>
              )}
            </div>

            {/* Description */}
            {pair.ruecklastschrift.description && (
              <p className="mt-2 text-xs text-neutral-500">{pair.ruecklastschrift.description}</p>
            )}
          </motion.div>
        )
      })}
    </div>
  )
}
