import { ElectronAPI } from '@electron-toolkit/preload'

interface StoreAPI {
  getAll: () => Promise<{
    transactions: unknown[]
    obligations: unknown[]
    obligationMonths: unknown[]
    importHistory: unknown[]
    debtResolutions: unknown[]
    ollamaSettings: unknown
    klarnaResetDone: boolean
    seedCreatedAtBackfilled: boolean
    accountBalances: unknown[]
    financialSnapshot: unknown
    financialBrainCache: unknown
    undoHistory: unknown[]
    redoStack: unknown[]
    errorRegistry: unknown[]
    pinSettings: unknown
    breadcrumbBuffer: unknown[]
    customSections: unknown[]
  }>
  add: (transaction: unknown) => Promise<void>
  addMany: (transactions: unknown[]) => Promise<void>
  delete: (id: string) => Promise<void>
  updateTransaction: (id: string, updates: unknown) => Promise<void>
  addObligation: (obligation: unknown) => Promise<void>
  updateObligation: (id: string, updates: unknown) => Promise<void>
  deleteObligation: (id: string) => Promise<void>
  setObligationMonth: (record: unknown) => Promise<void>
  setAllObligationMonths: (months: unknown[]) => Promise<void>
  clearAll: () => Promise<void>
  addImportRecord: (record: unknown) => Promise<void>
  deleteImportBatch: (batchId: string) => Promise<void>
  addDebtResolution: (resolution: unknown) => Promise<void>
  deleteDebtResolution: (id: string) => Promise<void>
  setObligations: (obligations: unknown[]) => Promise<void>
  setTransactions: (transactions: unknown[]) => Promise<void>
  setAccountBalances: (balances: unknown[]) => Promise<void>
  updateOllamaSettings: (settings: unknown) => Promise<void>
  setKlarnaResetDone: (done: boolean) => Promise<void>
  setSeedCreatedAtBackfilled: (done: boolean) => Promise<void>
  addError: (record: unknown) => Promise<void>
  updateError: (id: string, updates: unknown) => Promise<void>
  clearResolvedErrors: () => Promise<void>
  updateAccountBalance: (balance: unknown) => Promise<void>
  saveSnapshot: (snapshot: unknown) => Promise<void>
  saveFinancialBrainCache: (result: unknown) => Promise<void>
  saveUndoHistory: (history: unknown[]) => Promise<void>
  saveRedoStack: (stack: unknown[]) => Promise<void>
  savePinSettings: (settings: unknown) => Promise<void>
  saveCustomSections: (sections: unknown[]) => Promise<void>
  addChangeLog: (entry: unknown) => Promise<void>
}

interface BackupAPI {
  list: () => Promise<unknown[]>
  create: () => Promise<void>
  restore: (filename: string) => Promise<{ success: boolean }>
  exportToFile: () => Promise<{ success: boolean }>
  importFromFile: () => Promise<{ success: boolean }>
}

interface PinAPI {
  verify: (pin: string) => Promise<unknown>
  set: (pin: string) => Promise<unknown>
  disable: (pin: string) => Promise<unknown>
  status: () => Promise<unknown>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      store: StoreAPI
      pin: PinAPI
      backup: BackupAPI
      exportPdf: (html: string, defaultName: string) => Promise<{ success: boolean; filePath?: string }>
    }
  }
}
