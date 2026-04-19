import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  store: {
    getAll: (): Promise<unknown> => ipcRenderer.invoke('store:getAll'),
    add: (transaction: unknown): Promise<void> => ipcRenderer.invoke('store:add', transaction),
    addMany: (transactions: unknown[]): Promise<void> =>
      ipcRenderer.invoke('store:addMany', transactions),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('store:delete', id),
    addObligation: (obligation: unknown): Promise<void> =>
      ipcRenderer.invoke('store:addObligation', obligation),
    updateObligation: (id: string, updates: unknown): Promise<void> =>
      ipcRenderer.invoke('store:updateObligation', id, updates),
    deleteObligation: (id: string): Promise<void> =>
      ipcRenderer.invoke('store:deleteObligation', id),
    setObligationMonth: (record: unknown): Promise<void> =>
      ipcRenderer.invoke('store:setObligationMonth', record),
    setAllObligationMonths: (months: unknown[]): Promise<void> =>
      ipcRenderer.invoke('store:setAllObligationMonths', months),
    clearAll: (): Promise<void> => ipcRenderer.invoke('store:clearAll'),
    addImportRecord: (record: unknown): Promise<void> =>
      ipcRenderer.invoke('store:addImportRecord', record),
    deleteImportBatch: (batchId: string): Promise<void> =>
      ipcRenderer.invoke('store:deleteImportBatch', batchId),
    addDebtResolution: (resolution: unknown): Promise<void> =>
      ipcRenderer.invoke('store:addDebtResolution', resolution),
    deleteDebtResolution: (id: string): Promise<void> =>
      ipcRenderer.invoke('store:deleteDebtResolution', id),
    setObligations: (obligations: unknown[]): Promise<void> =>
      ipcRenderer.invoke('store:setObligations', obligations),
    setTransactions: (transactions: unknown[]): Promise<void> =>
      ipcRenderer.invoke('store:setTransactions', transactions),
    setAccountBalances: (balances: unknown[]): Promise<void> =>
      ipcRenderer.invoke('store:setAccountBalances', balances),
    updateOllamaSettings: (settings: unknown): Promise<void> =>
      ipcRenderer.invoke('store:updateOllamaSettings', settings),
    setKlarnaResetDone: (done: boolean): Promise<void> =>
      ipcRenderer.invoke('store:setKlarnaResetDone', done),
    setSeedCreatedAtBackfilled: (done: boolean): Promise<void> =>
      ipcRenderer.invoke('store:setSeedCreatedAtBackfilled', done),
    // New fields - need IPC handlers in main/index.ts
    addError: (record: unknown): Promise<void> =>
      ipcRenderer.invoke('store:addError', record),
    updateError: (id: string, updates: unknown): Promise<void> =>
      ipcRenderer.invoke('store:updateError', id, updates),
    clearResolvedErrors: (): Promise<void> =>
      ipcRenderer.invoke('store:clearResolvedErrors'),
    updateAccountBalance: (balance: unknown): Promise<void> =>
      ipcRenderer.invoke('store:updateAccountBalance', balance),
    saveSnapshot: (snapshot: unknown): Promise<void> =>
      ipcRenderer.invoke('store:saveSnapshot', snapshot),
    saveFinancialBrainCache: (result: unknown): Promise<void> =>
      ipcRenderer.invoke('store:saveFinancialBrainCache', result),
    saveUndoHistory: (history: unknown[]): Promise<void> =>
      ipcRenderer.invoke('store:saveUndoHistory', history),
    saveRedoStack: (stack: unknown[]): Promise<void> =>
      ipcRenderer.invoke('store:saveRedoStack', stack),
    savePinSettings: (settings: unknown): Promise<void> =>
      ipcRenderer.invoke('store:savePinSettings', settings),
    saveCustomSections: (sections: unknown[]): Promise<void> =>
      ipcRenderer.invoke('store:saveCustomSections', sections),
    addChangeLog: (entry: unknown): Promise<void> =>
      ipcRenderer.invoke('store:addChangeLog', entry),
  },
  backup: {
    list: (): Promise<unknown[]> => ipcRenderer.invoke('backup:list'),
    create: (): Promise<void> => ipcRenderer.invoke('backup:create'),
    restore: (filename: string): Promise<{ success: boolean }> => ipcRenderer.invoke('backup:restore', filename),
    exportToFile: (): Promise<{ success: boolean }> => ipcRenderer.invoke('backup:exportToFile'),
    importFromFile: (): Promise<{ success: boolean }> => ipcRenderer.invoke('backup:importFromFile'),
  },
  exportPdf: (html: string, defaultName: string): Promise<{ success: boolean; filePath?: string }> =>
    ipcRenderer.invoke('export:pdf', html, defaultName),
  pin: {
    verify: (pin: string): Promise<unknown> => ipcRenderer.invoke('pin:verify', pin),
    set: (pin: string): Promise<unknown> => ipcRenderer.invoke('pin:set', pin),
    disable: (pin: string): Promise<unknown> => ipcRenderer.invoke('pin:disable', pin),
    status: (): Promise<unknown> => ipcRenderer.invoke('pin:status'),
  },
  openDevTools: () => ipcRenderer.invoke('openDevTools'),
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
