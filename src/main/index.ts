import { app, shell, safeStorage, BrowserWindow, ipcMain, Menu, dialog } from 'electron'
import { basename, join } from 'path'
import { readFileSync } from 'fs'
import { writeFile, readFile, readdir, mkdir, unlink, stat } from 'fs/promises'
import { optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/maulwurficonISO.ico?asset'
import Store from 'electron-store'
import { checkAndNotify } from './notificationService'
import { hashPin, verifyPin } from './pinService'

const MAX_ATTEMPTS = 3

// ── Encryption at rest (safeStorage / DPAPI on Windows) ─────
// config.json and internal backups are encrypted, tied to the OS user account.
// Manual export-to-file stays plaintext JSON on purpose (portable). If the OS
// keychain is unavailable we transparently fall back to plaintext so the app
// never becomes unusable.
const ENC_TAG = '__mlwEnc'

function encryptString(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) return plain
  const payload = safeStorage.encryptString(plain).toString('base64')
  return JSON.stringify({ [ENC_TAG]: 1, data: payload })
}

// Reads either an encrypted wrapper or legacy plaintext (auto-migration path).
function decryptString(raw: string): string {
  const trimmed = raw.trimStart()
  if (trimmed.startsWith(`{"${ENC_TAG}"`)) {
    try {
      const parsed = JSON.parse(raw) as { [ENC_TAG]?: number; data?: string }
      if (parsed[ENC_TAG] === 1 && typeof parsed.data === 'string') {
        return safeStorage.decryptString(Buffer.from(parsed.data, 'base64'))
      }
    } catch {
      // fall through to returning the raw content
    }
  }
  return raw
}

interface Transaction {
  id: string
  date: string
  amount: number
  source: string
  type: string
  description?: string
  batchId?: string
  paymentGroupId?: string
  createdAt: string
}

interface Obligation {
  id: string
  name: string
  type: string
  amount: number | null
  approximateDay: number | null
  billingChain: string
  source: string
  notes?: string
  isActive: boolean
  createdAt: string
}

interface ObligationMonth {
  obligationId: string
  year: number
  month: number
  status: string
  actualAmount: number | null
  matchedTransactionId?: string
  paidDate?: string
}

interface ImportRecord {
  id: string
  date: string
  bank: string
  transactionCount: number
  period: string
}

interface DebtResolution {
  id: string
  failedDebitId: string
  type: string
  monthlyAmount?: number
  note?: string
  resolvedAt: string
}

interface OllamaSettings {
  baseUrl: string
  model: string
  availableModels: string[]
}

interface ChangeLogEntry {
  id: string
  timestamp: string
  action: string
  description: string
  category: 'transaction' | 'obligation' | 'klarna' | 'import' | 'system'
}

interface BackupMeta {
  filename: string
  timestamp: string
  size: number
  transactionCount: number
  obligationCount: number
}

interface AppSettings {
  installmentLabel: string
  prioritySectionEnabled: boolean
  notificationsEnabled: boolean
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  installmentLabel: 'Klarna Ratenzahlung',
  prioritySectionEnabled: true,
  notificationsEnabled: true
}

interface NotificationsState {
  lastShownUpcomingDate?: string
  lastShownFirstMonth?: string
  lastShownMostlyUnpaid?: string
}

interface StoreSchema {
  transactions: Transaction[]
  obligations: Obligation[]
  obligationMonths: ObligationMonth[]
  importHistory: ImportRecord[]
  debtResolutions: DebtResolution[]
  ollamaSettings: OllamaSettings
  klarnaResetDone: boolean
  seedCreatedAtBackfilled: boolean
  changeLog: ChangeLogEntry[]
  appSettings: AppSettings
  priorityObligationIds: string[]
  notificationsState: NotificationsState
}

// Constructed inside app.whenReady() — safeStorage is only usable after the
// app is ready, and serialize/deserialize below depend on it.
function createStore(): Store<StoreSchema> {
  const store = new Store<StoreSchema>({
    // @ts-ignore - projectName is valid at runtime but missing from electron-store typedefs
    projectName: 'finance-tracker',
    // Whole-file encryption via safeStorage; legacy plaintext files are read
    // transparently and re-encrypted on the next write (see migration below).
    serialize: (value): string => encryptString(JSON.stringify(value, null, 2)),
    deserialize: (raw): StoreSchema => JSON.parse(decryptString(raw)),
    defaults: {
      transactions: [],
      obligations: [],
      obligationMonths: [],
      importHistory: [],
      debtResolutions: [],
      ollamaSettings: { baseUrl: 'http://localhost:11434', model: 'llama3.1:latest', availableModels: [] },
      klarnaResetDone: false,
      seedCreatedAtBackfilled: false,
      changeLog: [],
      appSettings: DEFAULT_APP_SETTINGS,
      priorityObligationIds: [],
      notificationsState: {}
    }
  })
  // One-time migration: if the on-disk file is still plaintext, force a full
  // rewrite (conf writes the whole file) so it goes through `serialize` and
  // gets encrypted. Skipped when the file is already encrypted or absent.
  if (safeStorage.isEncryptionAvailable()) {
    try {
      const onDisk = readFileSync(store.path, 'utf-8')
      if (!onDisk.trimStart().startsWith(`{"${ENC_TAG}"`)) {
        store.set('changeLog', store.get('changeLog', []))
      }
    } catch {
      // No file yet (fresh install) — the first real write will be encrypted.
    }
  }
  return store
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1200,
    minHeight: 800,
    show: false,
    autoHideMenuBar: true,
    title: 'Maulwurf',
    backgroundColor: '#0f0f0f',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Ctrl+Shift+I toggles DevTools — dev builds only. In a packaged app the
  // console would let anyone read the store or reset the PIN, so it is disabled.
  if (is.dev) {
    mainWindow.webContents.on('before-input-event', (_event, input) => {
      if (input.control && input.shift && input.key.toLowerCase() === 'i') {
        mainWindow.webContents.toggleDevTools()
      }
    })
  }

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Block in-page navigation: a link dropped onto the window must not steer the
  // app (which has the preload attached) to an arbitrary origin. Only the dev
  // server URL is allowed; in production nothing navigates.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
  })

  // Right-click context menu for copy/paste with mouse
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const contextMenu = Menu.buildFromTemplate([
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll }
    ])
    contextMenu.popup()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.strokow.maulwurf-finance-tracker')

  const store = createStore()

  // Renderer lock state, enforced in the main process (defence in depth): when
  // a PIN is enabled the sensitive store/backup/export channels stay closed
  // until pin:verify (or pin:set/disable) proves the PIN — an open DevTools
  // console can't read or write data at the lock screen. Starts unlocked when
  // no PIN is set. App.tsx only calls pin:* before the gate, so gating every
  // store:*/backup:*/export:* channel (including getAll) is safe.
  let unlocked = !store.get('pinSettings', {
    enabled: false,
    pinHash: null,
    lockoutUntil: null,
    failedAttempts: 0,
  }).enabled

  // Registers a channel that refuses to run its handler until the PIN gate is
  // passed. pin:* and openDevTools stay open; everything else goes through this.
  const guarded = (
    channel: string,
    handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown // eslint-disable-line @typescript-eslint/no-explicit-any
  ): void => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!unlocked) throw new Error('locked')
      return handler(event, ...args)
    })
  }

  // Enable copy/paste/cut/selectAll via menu (needed for Electron)
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC: get full AppData
  guarded('store:getAll', () => {
    // One-time migration: Other+income → Пятак (gated флагом, иначе .some() гонялся на каждом getAll)
    let migratedTransactions = store.get('transactions', [])
    if (!store.get('otherIncomeMigrationDone', false)) {
      const needsMigration = migratedTransactions.some(
        (t) => t.source === 'Other' && t.type === 'income'
      )
      if (needsMigration) {
        migratedTransactions = migratedTransactions.map((t) =>
          t.source === 'Other' && t.type === 'income' ? { ...t, source: 'Пятак' as const } : t
        )
        store.set('transactions', migratedTransactions)
      }
      store.set('otherIncomeMigrationDone', true)
    }
    return {
      transactions: migratedTransactions,
      obligations: store.get('obligations', []),
      obligationMonths: store.get('obligationMonths', []),
      importHistory: store.get('importHistory', []),
      debtResolutions: store.get('debtResolutions', []),
      ollamaSettings: store.get('ollamaSettings', { baseUrl: 'http://localhost:11434', model: 'qwen2.5:7b', availableModels: [] }),
      klarnaResetDone: store.get('klarnaResetDone', false),
      seedCreatedAtBackfilled: store.get('seedCreatedAtBackfilled', false),
      accountBalances: store.get('accountBalances', [
        { id: 'acc-sparkasse', source: 'sparkasse', balance: 0, balanceDate: new Date().toISOString().split('T')[0], confidence: 'missing' as const, updatedAt: new Date().toISOString() },
        { id: 'acc-revolut', source: 'revolut', balance: 0, balanceDate: new Date().toISOString().split('T')[0], confidence: 'missing' as const, updatedAt: new Date().toISOString() },
        { id: 'acc-paypal', source: 'paypal', balance: 0, balanceDate: new Date().toISOString().split('T')[0], confidence: 'missing' as const, updatedAt: new Date().toISOString() },
      ]),
      financialSnapshot: store.get('financialSnapshot', null),
      financialBrainCache: store.get('financialBrainCache', null),
      undoHistory: store.get('undoHistory', []),
      redoStack: store.get('redoStack', []),
      errorRegistry: store.get('errorRegistry', []),
      pinSettings: store.get('pinSettings', { enabled: false, pinHash: null, lockoutUntil: null, failedAttempts: 0 }),
      breadcrumbBuffer: store.get('breadcrumbBuffer', []),
      customSections: store.get('customSections', []),
      // Защитный дефолт (2A.5): merge с DEFAULT_APP_SETTINGS — старый store/бэкап без
      // новых ключей (напр. prioritySectionEnabled, Фаза 7) не должен отдавать undefined.
      appSettings: { ...DEFAULT_APP_SETTINGS, ...store.get('appSettings', DEFAULT_APP_SETTINGS) },
      priorityObligationIds: store.get('priorityObligationIds', []),
      notificationsState: store.get('notificationsState', {}),
    }
  })

  // IPC: add one transaction
  guarded('store:add', (_event, transaction: Transaction) => {
    const transactions = store.get('transactions', [])
    transactions.push(transaction)
    store.set('transactions', transactions)
  })

  // IPC: add many transactions
  guarded('store:addMany', (_event, newTransactions: Transaction[]) => {
    const transactions = store.get('transactions', [])
    transactions.push(...newTransactions)
    store.set('transactions', transactions)
  })

  // IPC: delete by id
  guarded('store:delete', (_event, id: string) => {
    const transactions = store.get('transactions', [])
    store.set(
      'transactions',
      transactions.filter((t) => t.id !== id)
    )
  })

  // IPC: update transaction (partial)
  guarded('store:updateTransaction', (_event, id: string, updates: Partial<Transaction>) => {
    const transactions = store.get('transactions', [])
    const idx = transactions.findIndex((t) => t.id === id)
    if (idx !== -1) {
      transactions[idx] = { ...transactions[idx], ...updates }
      store.set('transactions', transactions)
    }
  })

  // IPC: clear all transactions + obligationMonths
  guarded('store:clearAll', () => {
    store.set('transactions', [])
    store.set('obligationMonths', [])
    store.set('importHistory', [])
    store.set('debtResolutions', [])
  })

  // IPC: add debt resolution
  guarded('store:addDebtResolution', (_event, resolution: DebtResolution) => {
    const resolutions = store.get('debtResolutions', [])
    resolutions.push(resolution)
    store.set('debtResolutions', resolutions)
  })

  // IPC: delete debt resolution
  guarded('store:deleteDebtResolution', (_event, id: string) => {
    store.set(
      'debtResolutions',
      store.get('debtResolutions', []).filter((r) => r.id !== id)
    )
  })

  // IPC: add import record
  guarded('store:addImportRecord', (_event, record: ImportRecord) => {
    const history = store.get('importHistory', [])
    history.push(record)
    store.set('importHistory', history)
  })

  // IPC: delete import record + its transactions
  guarded('store:deleteImportBatch', (_event, batchId: string) => {
    store.set(
      'transactions',
      store.get('transactions', []).filter((t) => t.batchId !== batchId)
    )
    store.set(
      'importHistory',
      store.get('importHistory', []).filter((r) => r.id !== batchId)
    )
  })

  // IPC: add obligation
  guarded('store:addObligation', (_event, obligation: Obligation) => {
    const obligations = store.get('obligations', [])
    obligations.push(obligation)
    store.set('obligations', obligations)
  })

  // IPC: update obligation
  guarded('store:updateObligation', (_event, id: string, updates: Partial<Obligation>) => {
    const obligations = store.get('obligations', [])
    const idx = obligations.findIndex((o) => o.id === id)
    if (idx !== -1) {
      obligations[idx] = { ...obligations[idx], ...updates }
      store.set('obligations', obligations)
    }
  })

  // IPC: delete obligation
  guarded('store:deleteObligation', (_event, id: string) => {
    store.set(
      'obligations',
      store.get('obligations', []).filter((o) => o.id !== id)
    )
    store.set(
      'obligationMonths',
      store.get('obligationMonths', []).filter((m) => m.obligationId !== id)
    )
  })

  // IPC: set obligation month status
  guarded('store:setObligationMonth', (_event, record: ObligationMonth) => {
    const months = store.get('obligationMonths', [])
    const idx = months.findIndex(
      (m) =>
        m.obligationId === record.obligationId && m.year === record.year && m.month === record.month
    )
    if (idx !== -1) {
      months[idx] = record
    } else {
      months.push(record)
    }
    store.set('obligationMonths', months)
  })

  // IPC: bulk-replace all obligation months (used by undo/redo)
  guarded('store:setAllObligationMonths', (_event, months: ObligationMonth[]) => {
    // Дедуп по ключу (obligationId, year, month) — защита от дублей при сыром bulk-write
    // (last-write-wins). Ключ ObligationMonth уникален по инварианту.
    const seen = new Map<string, ObligationMonth>()
    for (const m of months) seen.set(`${m.obligationId}|${m.year}|${m.month}`, m)
    store.set('obligationMonths', Array.from(seen.values()))
  })

  // IPC: bulk-replace all obligations (used for deduplication)
  guarded('store:setObligations', (_event, obligations: Obligation[]) => {
    store.set('obligations', obligations)
  })

  // IPC: bulk-replace all transactions (BUG-005: используется undo/redo)
  guarded('store:setTransactions', (_event, transactions: Transaction[]) => {
    store.set('transactions', transactions)
  })

  // IPC: bulk-replace all account balances (BUG-005: используется undo/redo)
  guarded('store:setAccountBalances', (_event, balances: unknown[]) => {
    store.set('accountBalances', balances as never)
  })

  // IPC: update Ollama settings
  guarded('store:updateOllamaSettings', (_event, settings: OllamaSettings) => {
    store.set('ollamaSettings', settings)
  })

  // IPC: mark Klarna migration as done (BUG-004: одноразовая миграция)
  guarded('store:setKlarnaResetDone', (_event, done: boolean) => {
    store.set('klarnaResetDone', done)
  })

  // IPC: mark seed createdAt backfill as done (BUG-008: одноразовая миграция)
  guarded('store:setSeedCreatedAtBackfilled', (_event, done: boolean) => {
    store.set('seedCreatedAtBackfilled', done)
  })

  // IPC: PIN handlers
  ipcMain.handle('pin:verify', (_event, input: string) => {
    let pinSettings = store.get('pinSettings', {
      enabled: false,
      pinHash: null,
      lockoutUntil: null,
      failedAttempts: 0,
    })
    const result = verifyPin(input, pinSettings)
    if (result.success) {
      unlocked = true // correct PIN — open the sensitive channels for this session
      store.set('pinSettings', { ...pinSettings, failedAttempts: 0, lockoutUntil: null })
    } else if (result.lockoutUntil) {
      store.set('pinSettings', {
        ...pinSettings,
        failedAttempts: MAX_ATTEMPTS,
        lockoutUntil: result.lockoutUntil,
      })
    } else {
      const newFailedAttempts = pinSettings.failedAttempts + 1
      store.set('pinSettings', {
        ...pinSettings,
        failedAttempts: newFailedAttempts,
      })
    }
    return result
  })

  // IPC: open DevTools — dev builds only (see the DevTools note in createWindow).
  ipcMain.handle('openDevTools', (event) => {
    if (!is.dev) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      win.webContents.openDevTools()
    }
  })

  ipcMain.handle('pin:set', (_event, pin: string) => {
    // Changing an existing PIN requires being past the gate — this blocks a
    // silent PIN reset from an open console at the lock screen. First-time
    // setup (no PIN yet) is allowed: `unlocked` is true when none is enabled.
    if (
      store.get('pinSettings', {
        enabled: false,
        pinHash: null,
        lockoutUntil: null,
        failedAttempts: 0,
      }).enabled &&
      !unlocked
    ) {
      return { success: false, error: 'locked' }
    }
    store.set('pinSettings', {
      enabled: true,
      pinHash: hashPin(pin),
      lockoutUntil: null,
      failedAttempts: 0,
    })
    unlocked = true
    return { success: true }
  })

  ipcMain.handle('pin:disable', (_event, input: string) => {
    const pinSettings = store.get('pinSettings', {
      enabled: false,
      pinHash: null,
      lockoutUntil: null,
      failedAttempts: 0,
    })
    if (!pinSettings.enabled) return { success: false, error: 'PIN not enabled' }
    const result = verifyPin(input, pinSettings)
    if (!result.success) return { success: false, error: 'Invalid PIN' }
    store.set('pinSettings', {
      enabled: false,
      pinHash: null,
      lockoutUntil: null,
      failedAttempts: 0,
    })
    unlocked = true // PIN proven and now removed
    return { success: true }
  })

  ipcMain.handle('pin:status', (_event) => {
    const pinSettings = store.get('pinSettings', {
      enabled: false,
      pinHash: null,
      lockoutUntil: null,
      failedAttempts: 0,
    })
    const locked = !!(pinSettings.lockoutUntil && new Date(pinSettings.lockoutUntil) > new Date())
    return {
      enabled: pinSettings.enabled,
      locked,
      lockoutUntil: pinSettings.lockoutUntil,
      attemptsLeft: locked ? 0 : 3 - pinSettings.failedAttempts,
    }
  })

  createWindow()

  // OS-нотификация (Фаза 8): сужена до critical-risk и гейтится notificationsEnabled.
  // Три информационных типа живут только как in-app тосты (renderer) → нет двойного
  // «за 3 дня». Проверка на старте и каждые 60 минут.
  const notifEnabled = (): boolean =>
    store.get('appSettings', DEFAULT_APP_SETTINGS).notificationsEnabled !== false
  checkAndNotify(store.get('financialSnapshot', null), notifEnabled())
  setInterval(() => {
    checkAndNotify(store.get('financialSnapshot', null), notifEnabled())
  }, 60 * 60 * 1000)

  // IPC: new extended store methods
  guarded('store:addError', (_event, record: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errors = (store as any).get('errorRegistry', []) as unknown[]
    errors.unshift(record)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(store as any).set('errorRegistry', errors.slice(0, 100))
  })

  guarded('store:updateError', (_event, id: string, updates: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errors = (store as any).get('errorRegistry', []) as { id: string; [k: string]: unknown }[]
    const idx = errors.findIndex((e) => e.id === id)
    if (idx !== -1) {
      errors[idx] = { ...errors[idx], ...(updates as object) }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(store as any).set('errorRegistry', errors)
    }
  })

  // IPC: drop all resolved errors (BUG-006)
  guarded('store:clearResolvedErrors', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errors = (store as any).get('errorRegistry', []) as { resolved?: boolean }[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(store as any).set('errorRegistry', errors.filter((e) => !e.resolved))
  })

  guarded('store:updateAccountBalance', (_event, balance: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const balances = (store as any).get('accountBalances', []) as { id: string; [k: string]: unknown }[]
    const idx = balances.findIndex((b) => b.id === (balance as { id: string }).id)
    if (idx !== -1) {
      balances[idx] = { ...balances[idx], ...(balance as object) }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(store as any).set('accountBalances', balances)
    }
  })

  guarded('store:saveSnapshot', (_event, snapshot: unknown) => {
    store.set('financialSnapshot', snapshot)
  })

  guarded('store:saveFinancialBrainCache', (_event, result: unknown) => {
    store.set('financialBrainCache', result)
  })

  guarded('store:saveUndoHistory', (_event, history: unknown[]) => {
    store.set('undoHistory', history)
  })

  // BUG-007: redoStack теперь персистится отдельным IPC, по образцу saveUndoHistory
  guarded('store:saveRedoStack', (_event, stack: unknown[]) => {
    store.set('redoStack', stack)
  })

  guarded('store:savePinSettings', (_event, settings: unknown) => {
    store.set('pinSettings', settings)
  })

  guarded('store:saveCustomSections', (_event, sections: unknown[]) => {
    store.set('customSections', sections)
  })

  // Partial-merge настроек приложения: Фазы 7/8 добавят свои поля в appSettings
  // без нового IPC-канала.
  guarded('store:saveAppSettings', (_event, patch: Partial<AppSettings>) => {
    const cur = store.get('appSettings', DEFAULT_APP_SETTINGS)
    store.set('appSettings', { ...cur, ...patch })
  })

  // Глобальный тег «Особый приоритет» (Фаза 7). Мягкая санитизация (2A.5):
  // принимаем только массив строк, всё прочее отбрасываем.
  guarded('store:savePriorityObligationIds', (_event, ids: unknown) => {
    const clean = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
    store.set('priorityObligationIds', clean)
  })

  // Дедуп-состояние уведомлений (Фаза 8). Persist из renderer (Home) после показа тостов.
  guarded('store:saveNotificationsState', (_event, next: NotificationsState) => {
    store.set('notificationsState', next && typeof next === 'object' ? next : {})
  })

  // IPC: add changelog entry
  guarded('store:addChangeLog', (_event, entry: ChangeLogEntry) => {
    const log = store.get('changeLog', [])
    log.unshift(entry)
    store.set('changeLog', log.slice(0, 500))
  })

  // ── Backup helpers ──────────────────────────────────────
  const backupDir = join(app.getPath('userData'), 'backups')

  async function getFullStoreData(): Promise<Record<string, unknown>> {
    return {
      transactions: store.get('transactions', []),
      obligations: store.get('obligations', []),
      obligationMonths: store.get('obligationMonths', []),
      importHistory: store.get('importHistory', []),
      debtResolutions: store.get('debtResolutions', []),
      ollamaSettings: store.get('ollamaSettings', { baseUrl: 'http://localhost:11434', model: 'qwen2.5:7b', availableModels: [] }),
      accountBalances: store.get('accountBalances', []),
      financialSnapshot: store.get('financialSnapshot', null),
      undoHistory: store.get('undoHistory', []),
      redoStack: store.get('redoStack', []),
      errorRegistry: store.get('errorRegistry', []),
      pinSettings: store.get('pinSettings', {}),
      customSections: store.get('customSections', []),
      changeLog: store.get('changeLog', []),
      appSettings: { ...DEFAULT_APP_SETTINGS, ...store.get('appSettings', DEFAULT_APP_SETTINGS) },
      priorityObligationIds: store.get('priorityObligationIds', []),
      notificationsState: store.get('notificationsState', {}),
    }
  }

  async function createBackup(): Promise<void> {
    await mkdir(backupDir, { recursive: true })
    const data = await getFullStoreData()
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `backup-${timestamp}.json`
    const filePath = join(backupDir, filename)
    // Internal backups sit next to config.json in %APPDATA%, so they are
    // encrypted the same way. Manual export-to-file stays plaintext (portable).
    await writeFile(filePath, encryptString(JSON.stringify(data, null, 2)), 'utf-8')
    // Keep only last 10 backups
    const files = (await readdir(backupDir))
      .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
      .sort()
    if (files.length > 10) {
      for (const old of files.slice(0, files.length - 10)) {
        await unlink(join(backupDir, old)).catch(() => {})
      }
    }
  }

  // IPC: list backups
  guarded('backup:list', async (): Promise<BackupMeta[]> => {
    await mkdir(backupDir, { recursive: true })
    const files = (await readdir(backupDir))
      .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
      .sort()
      .reverse()
    const metas: BackupMeta[] = []
    for (const filename of files) {
      const filePath = join(backupDir, filename)
      const info = await stat(filePath)
      let transactionCount = 0
      let obligationCount = 0
      try {
        const raw = JSON.parse(decryptString(await readFile(filePath, 'utf-8')))
        transactionCount = Array.isArray(raw.transactions) ? raw.transactions.length : 0
        obligationCount = Array.isArray(raw.obligations) ? raw.obligations.length : 0
      } catch {}
      // Extract timestamp from filename: backup-2026-04-15T10-30-00-000Z.json
      const tsRaw = filename.replace('backup-', '').replace('.json', '')
      const timestamp = tsRaw.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-\d+Z$/, '$1T$2:$3:$4Z')
      metas.push({ filename, timestamp, size: info.size, transactionCount, obligationCount })
    }
    return metas
  })

  // IPC: create manual backup
  guarded('backup:create', async () => {
    await createBackup()
  })

  // IPC: restore from backup file in backups dir
  guarded('backup:restore', async (_event, filename: string) => {
    // Harden against path traversal: strip any directory part and accept only a
    // real backup file name — a crafted `../../foo` can't escape the backup dir.
    const safe = basename(String(filename))
    if (!/^backup-[\d-]+T[\d-]+Z\.json$/.test(safe)) {
      return { success: false, error: 'invalid filename' }
    }
    const raw = JSON.parse(
      decryptString(await readFile(join(backupDir, safe), 'utf-8'))
    ) as Record<string, unknown>
    if (typeof raw !== 'object' || raw === null) {
      return { success: false, error: 'invalid backup' }
    }
    const keys = ['transactions','obligations','obligationMonths','importHistory','debtResolutions',
      'ollamaSettings','accountBalances','financialSnapshot','undoHistory','errorRegistry','pinSettings',
      'customSections','changeLog','appSettings','priorityObligationIds','notificationsState']
    for (const key of keys) {
      if (key in raw) store.set(key as keyof StoreSchema, raw[key] as never)
    }
    return { success: true }
  })

  // IPC: export current data to user-chosen file
  guarded('backup:exportToFile', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `finance-backup-${new Date().toISOString().slice(0,10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (canceled || !filePath) return { success: false }
    const data = await getFullStoreData()
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
    return { success: true }
  })

  // IPC: import from user-chosen file
  guarded('backup:importFromFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (canceled || !filePaths[0]) return { success: false }
    // Tolerates both a plaintext export and an encrypted backup file.
    const raw = JSON.parse(decryptString(await readFile(filePaths[0], 'utf-8'))) as Record<string, unknown>
    if (typeof raw !== 'object' || raw === null) return { success: false, error: 'invalid file' }
    const keys = ['transactions','obligations','obligationMonths','importHistory','debtResolutions',
      'ollamaSettings','accountBalances','financialSnapshot','undoHistory','errorRegistry','pinSettings',
      'customSections','changeLog','appSettings','priorityObligationIds','notificationsState']
    for (const key of keys) {
      if (key in raw) store.set(key as keyof StoreSchema, raw[key] as never)
    }
    return { success: true }
  })

  // Auto-backup every 30 minutes
  setInterval(() => { createBackup().catch(console.error) }, 30 * 60 * 1000)

  guarded('export:pdf', async (_event, html: string, defaultName: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (canceled || !filePath) return { success: false }

    const pdfWin = new BrowserWindow({
      show: false,
      width: 900,
      height: 600,
      webPreferences: { offscreen: true }
    })
    await pdfWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    // Small delay to let CSS render
    await new Promise((r) => setTimeout(r, 300))
    const pdfBuffer = await pdfWin.webContents.printToPDF({
      printBackground: true,
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
    })
    pdfWin.destroy()
    await writeFile(filePath, pdfBuffer)
    return { success: true, filePath }
  })

  guarded('export:md', async (_event, content: string, defaultName: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (canceled || !filePath) return { success: false }
    await writeFile(filePath, content, 'utf-8')
    return { success: true, filePath }
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
