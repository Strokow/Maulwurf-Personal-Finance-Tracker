import type { ComponentType } from 'react'
import { Coins } from 'lucide-react'
import type { Transaction } from '../types'
import revolutLogo from '../assets/revolut-logo.png'
import sparkasseLogo from '../assets/sparkasse-logo.svg'
import paypalLogo from '../assets/paypal-logo.svg'

interface SourceLogoProps {
  source: Transaction['source']
  size?: 'sm' | 'md'
}

type IconType = ComponentType<{ className?: string }>

const sourceConfig: Record<
  Transaction['source'],
  { abbr: string; bg: string; text: string; logo?: string; logoBg?: string; icon?: IconType }
> = {
  'Deutsche Bank': { abbr: 'DB', bg: 'bg-[#0018A8]', text: 'text-white' },
  Sparkasse: {
    abbr: 'S',
    bg: 'bg-[#FF0000]',
    text: 'text-white',
    logo: sparkasseLogo,
    logoBg: 'bg-neutral-900'
  },
  Revolut: {
    abbr: 'R',
    bg: 'bg-[#0075EB]',
    text: 'text-white',
    logo: revolutLogo
  },
  PayPal: {
    abbr: 'PP',
    bg: 'bg-[#003087]',
    text: 'text-white',
    logo: paypalLogo,
    logoBg: 'bg-neutral-900'
  },
  Klarna: { abbr: 'K', bg: 'bg-[#FFB3C7]', text: 'text-[#17120F]' },
  Vodafone: { abbr: 'VF', bg: 'bg-[#E60000]', text: 'text-white' },
  'Пятак': {
    abbr: '₽',
    bg: 'bg-[#eab308]',
    text: 'text-amber-950',
    icon: Coins
  },
  Other: { abbr: '?', bg: 'bg-neutral-600', text: 'text-neutral-200' }
}

const sizeClasses = {
  sm: 'h-6 w-6 text-[9px]',
  md: 'h-7 w-7 text-[10px]'
}

const imgSizeClasses = {
  sm: 'h-6 w-6',
  md: 'h-7 w-7'
}

const iconInnerSize = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4'
}

export function SourceLogo({ source, size = 'sm' }: SourceLogoProps): React.JSX.Element {
  const config = sourceConfig[source] ?? sourceConfig['Other']

  if (config.icon) {
    const Icon = config.icon
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full ${config.bg} ${config.text} ${imgSizeClasses[size]} will-change-transform`}
        title={source}
      >
        <Icon className={iconInnerSize[size]} />
      </span>
    )
  }

  if (config.logo) {
    if (config.logoBg) {
      return (
        <span
          className={`inline-flex shrink-0 items-center justify-center rounded-full ${config.logoBg} ${imgSizeClasses[size]} p-1 will-change-transform`}
          title={source}
        >
          <img
            src={config.logo}
            alt={source}
            className="h-full w-full object-contain"
            style={{ imageRendering: 'auto' }}
          />
        </span>
      )
    }
    return (
      <img
        src={config.logo}
        alt={source}
        title={source}
        className={`shrink-0 rounded-full object-cover will-change-transform ${imgSizeClasses[size]}`}
      />
    )
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold leading-none ${config.bg} ${config.text} ${sizeClasses[size]}`}
      title={source}
    >
      {config.abbr}
    </span>
  )
}
