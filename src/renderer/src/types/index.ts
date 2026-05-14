export interface Transaction {
  id: string
  date: string // YYYY-MM-DD
  amount: number // in Euro, positive number
  source: 'Deutsche Bank' | 'Sparkasse' | 'Revolut' | 'PayPal' | 'Klarna' | 'Vodafone' | 'Пятак' | 'Other'
  type: 'payment' | 'income' | 'failed_debit' | 'penalty'
  penaltySource?: 'bank' | 'service'
  linkedTransactionId?: string
  sparkasseType?: 'ruecklastschrift' | 'wiedergutschrift' | 'entgelt' | 'normal'
  paymentChain?: 'sparkasse_direct' | 'paypal' | 'vodafone_contract' | 'klarna' | 'revolut_paypal'
  description?: string
  comment?: string
  batchId?: string
  paymentGroupId?: string
  createdAt: string
}

export type BankFormat = 'sparkasse' | 'revolut' | 'paypal' | 'klarna' | 'vodafone' | 'generic'

export interface ImportRecord {
  id: string
  date: string
  bank: BankFormat
  transactionCount: number
  period: string
}

export interface TransactionPair {
  ruecklastschrift: Transaction
  wiedergutschrift: Transaction | null
  entgelt: Transaction | null
  daysBetween: number | null
  totalCost: number
}

export type GroupStatus = 'successful' | 'failed' | 'refunded'

export interface TransactionGroup {
  id: string
  status: GroupStatus
  label: string
  netEffect: number
  transactions: Transaction[]
}

export type DebtResolutionType = 'manual' | 'restructured'

export interface DebtResolution {
  id: string
  failedDebitId: string
  type: DebtResolutionType
  monthlyAmount?: number
  note?: string
  resolvedAt: string
}

export type ObligationType = 'subscription' | 'manual_payment'
export type ObligationStatus = 'paid' | 'unpaid' | 'unknown' | 'skipped'
export type BillingChain = 'sparkasse_direct' | 'vodafone_contract' | 'paypal' | 'klarna' | 'other'

export interface OllamaSettings {
  baseUrl: string            // default: "http://localhost:11434"
  model: string              // e.g. "qwen2.5:7b", "llama3.1", "mistral"
  availableModels: string[]  // fetched from Ollama API on app start
}

export interface Obligation {
  id: string
  name: string
  type: ObligationType
  amount: number | null
  approximateDay: number | null
  yearlyMonth?: number | null // 1-12, the month when yearly obligation is due
  billingChain: BillingChain
  source: string
  notes?: string
  isActive: boolean
  createdAt: string
  frequency?: ObligationFrequency // default "monthly"
  sectionId?: string // custom section id; if absent, uses frequency
  collapsed?: boolean // default false
  parentId?: string // linked parent obligation id; child auto-pays when parent is paid
  totalInstallments?: number // Klarna: общее количество платежей по рассрочке
  originalTotal?: number // Klarna: изначальная сумма долга (информационно, может не совпадать с monthly × total из-за штрафов)
}

export interface ObligationMonth {
  obligationId: string
  year: number
  month: number
  status: ObligationStatus
  actualAmount: number | null
  matchedTransactionId?: string
  paidDate?: string
  isCarriedOver?: boolean       // запись создана кнопкой переноса долга
  carriedFromYear?: number      // из какого года перенесён
  carriedFromMonth?: number     // из какого месяца перенесён
  carriedAmount?: number        // сумма перенесённого долга (на момент переноса)
  carriedPaid?: boolean         // перенесённый долг уже оплачен
}

export interface AppData {
  transactions: Transaction[]
  obligations: Obligation[]
  obligationMonths: ObligationMonth[]
  importHistory: ImportRecord[]
  debtResolutions: DebtResolution[]
  ollamaSettings: OllamaSettings
  klarnaResetDone?: boolean // миграция BUG-004: старые klarna-данные удалены
  seedCreatedAtBackfilled?: boolean // миграция BUG-008: сидовые createdAt антидатированы
}

export type Period = 'this_month' | 'last_month' | 'month_before_last' | 'custom'

export interface PeriodRange {
  from: string
  to: string
}

// ── Data confidence ────────────────────────────────────────
export type DataConfidence = 'ok' | 'stale' | 'missing' | 'invalid'

// ── Account balances ───────────────────────────────────────
export interface AccountBalance {
  id: string
  source: 'sparkasse' | 'revolut' | 'paypal'
  balance: number
  balanceDate: string
  confidence: DataConfidence // computed on read, never stored
  updatedAt: string
}

// ── Financial snapshot ─────────────────────────────────────
export interface SnapshotWarning {
  code: string
  message: string
  affectedId?: string
  severity: 'error' | 'warn' | 'info'
}

export interface UpcomingPayment {
  id: string
  name: string
  amount: number
  dueDate: string
  source: 'obligation' | 'klarna'
  billingChain: string
  riskFlag: boolean
}

export interface FinancialSnapshot {
  generatedAt: string
  accounts: AccountBalance[]
  totalLiquid: number
  totalLiquidConfidence: DataConfidence
  monthlyObligations: number
  monthlyObligationsCount: number
  monthlyKlarna: number
  monthlyKlarnaCount: number
  freeThisMonth: number
  riskLevel: 'safe' | 'tight' | 'critical' | 'unknown'
  upcomingPayments: UpcomingPayment[]
  warnings: SnapshotWarning[]
}

// ── Ollama results ─────────────────────────────────────────
export interface OllamaResult<T> {
  success: boolean
  data?: T
  rawResponse?: string
  validationErrors?: string[]
  model: string
  durationMs: number
  timestamp: string
}

export interface FinancialBrainResult {
  priority_action: string
  weekly_summary: string
  alerts: Array<{ message: string; urgency: 'high' | 'medium' | 'low' }>
  tip: string
}

export interface ObligationsAnalysis {
  summary: string
  monthlyTotal: number
  yearlyTotal: number
  alerts: Array<{ obligationId: string; message: string; urgency: 'high' | 'medium' | 'low' }>
  recommendations: Array<{ message: string; type: 'review' | 'cancel' | 'watch' }>
}

// ── Undo / Redo ────────────────────────────────────────────
export interface HistoryEntry {
  id: string
  timestamp: string
  action: string // human-readable Russian
  snapshotBefore: Partial<AppData>
  snapshotAfter: Partial<AppData>
}

// ── Error registry ─────────────────────────────────────────
export type ErrorCategory = 'js_exception' | 'ollama_error' | 'validation_error' | 'ipc_error'

export interface ErrorRecord {
  id: string
  timestamp: string
  category: ErrorCategory
  message: string
  stack?: string
  context: {
    page: string
    action?: string
    breadcrumbs: string[]
  }
  resolved: boolean
}

// ── PIN ────────────────────────────────────────────────────
export interface PinSettings {
  enabled: boolean
  pinHash: string | null // SHA-256 hex, never plaintext
  lockoutUntil: string | null // ISO timestamp
  failedAttempts: number
}

// ── Obligation extensions ──────────────────────────────────
export type ObligationFrequency = 'monthly' | 'yearly' | 'once'

// Extended Obligation with new fields
export interface ObligationExtended extends Obligation {
  frequency?: ObligationFrequency // default "monthly"
  collapsed?: boolean // default false
}

// Extended AppData with new fields
export interface AppDataExtended extends AppData {
  accountBalances: AccountBalance[]
  financialSnapshot: FinancialSnapshot | null
  financialBrainCache: OllamaResult<FinancialBrainResult> | null
  undoHistory: HistoryEntry[]
  redoStack: HistoryEntry[]
  errorRegistry: ErrorRecord[]
  pinSettings: PinSettings
  breadcrumbBuffer: string[]
  customSections: ObligationSection[]
  changeLog: ChangeLogEntry[]
}

// ── Custom obligation sections ─────────────────────────────
export interface ObligationSection {
  id: string
  name: string
  order: number
  createdAt: string
}

// ── Changelog ─────────────────────────────────────────────
export type ChangeLogCategory = 'transaction' | 'obligation' | 'klarna' | 'import' | 'system'

export interface ChangeLogEntry {
  id: string
  timestamp: string
  action: string
  description: string
  category: ChangeLogCategory
}

// ── Backups ────────────────────────────────────────────────
export interface BackupMeta {
  filename: string
  timestamp: string
  size: number
  transactionCount: number
  obligationCount: number
}

// ── AI Chat types ──────────────────────────────────────────
export interface AiChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  actions?: AiAction[]
  timestamp: string
}

export type AiActionType = 'add' | 'edit' | 'delete' | 'move' | 'status' | 'create_section'

export interface AiAction {
  id: string
  type: AiActionType
  description: string
  applied: boolean
  payload: Record<string, unknown>
}
