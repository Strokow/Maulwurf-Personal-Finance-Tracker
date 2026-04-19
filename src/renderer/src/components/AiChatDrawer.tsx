import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { playNotificationSound } from '../utils/playNotificationSound'
import {
  MessageSquare,
  X,
  Send,
  Loader2,
  Check,
  AlertTriangle,
  ChevronDown,
  Settings2,
  Trash2,
} from 'lucide-react'
import type {
  Obligation,
  ObligationMonth,
  ObligationStatus,
  ObligationSection,
  Transaction,
  OllamaSettings,
  AiChatMessage,
  AiAction,
  AiActionType,
  AppData,
  FinancialSnapshot,
} from '../types'
import { fetchOllamaModels } from '../services/ollamaService'
import { tryDeterministicAnswer, buildAiSystemPrompt } from '../services/chatEngine'
import type { ChatContext } from '../services/chatEngine'

// ── Helpers ────────────────────────────────────────────────

function uid(): string {
  return crypto.randomUUID()
}

function nowIso(): string {
  return new Date().toISOString()
}

// ── Props ──────────────────────────────────────────────────
interface AiChatDrawerProps {
  isOpen: boolean
  onClose: () => void
  // Data
  obligations: Obligation[]
  obligationMonths: ObligationMonth[]
  transactions: Transaction[]
  customSections: ObligationSection[]
  ollamaSettings: OllamaSettings
  financialSnapshot: FinancialSnapshot | null
  navYear: number
  navMonth: number
  // Actions
  onAdd: (o: Omit<Obligation, 'id' | 'createdAt'>) => Promise<Obligation>
  onUpdate: (id: string, updates: Partial<Obligation>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onStatusChange: (
    obligationId: string,
    year: number,
    month: number,
    status: ObligationStatus
  ) => Promise<void>
  getMonthRecord: (obligationId: string, year: number, month: number) => ObligationMonth | null
  onAddSection: (name: string) => Promise<ObligationSection>
  pushUndo?: (action: string, before: Partial<AppData>, after: Partial<AppData>) => void
  onUpdateOllamaSettings: (settings: OllamaSettings) => Promise<void>
  onNewAssistantMessage?: () => void
}

// ── Parse AI response ──────────────────────────────────────
function parseAiResponse(text: string): { content: string; actions: AiAction[] } {
  const actionsIdx = text.indexOf('ACTIONS:')
  if (actionsIdx === -1) return { content: text.trim(), actions: [] }

  const content = text.slice(0, actionsIdx).trim()
  const actionsRaw = text.slice(actionsIdx + 8).trim()

  try {
    const parsed = JSON.parse(actionsRaw)
    if (!Array.isArray(parsed)) return { content, actions: [] }

    const actions: AiAction[] = parsed.map((a: Record<string, unknown>) => {
      const type = (a.type as AiActionType) ?? 'edit'
      let description = ''
      switch (type) {
        case 'edit':
          description = `Изменить «${(a as Record<string, unknown>).obligationId}»`
          break
        case 'delete':
          description = `Удалить обязательство`
          break
        case 'add':
          description = `Добавить: ${((a as Record<string, Record<string, unknown>>).obligation)?.name ?? '?'}`
          break
        case 'status':
          description = `Статус → ${a.status}`
          break
        case 'move':
          description = `Переместить в раздел`
          break
        case 'create_section':
          description = `Создать раздел «${a.name}»`
          break
      }
      return {
        id: uid(),
        type,
        description,
        applied: false,
        payload: a as Record<string, unknown>,
      }
    })
    return { content, actions }
  } catch {
    return { content, actions: [] }
  }
}

// ── Component ──────────────────────────────────────────────
export function AiChatDrawer({
  isOpen,
  onClose,
  obligations,
  obligationMonths,
  transactions,
  customSections,
  ollamaSettings,
  financialSnapshot,
  navYear,
  navMonth,
  onAdd,
  onUpdate,
  onDelete,
  onStatusChange,
  getMonthRecord: _getMonthRecord,
  onAddSection,
  pushUndo,
  onUpdateOllamaSettings,
  onNewAssistantMessage,
}: AiChatDrawerProps): React.JSX.Element {
  const [messages, setMessages] = useState<AiChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>(ollamaSettings.availableModels)
  const [selectedModel, setSelectedModel] = useState(ollamaSettings.model)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus()
      // Fetch models on open
      fetchOllamaModels(ollamaSettings.baseUrl)
        .then(setAvailableModels)
        .catch(() => {})
    }
  }, [isOpen, ollamaSettings.baseUrl])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')

    const userMsg: AiChatMessage = {
      id: uid(),
      role: 'user',
      content: text,
      timestamp: nowIso(),
    }
    setMessages((prev) => [...prev, userMsg])

    const chatCtx: ChatContext = {
      obligations,
      obligationMonths,
      customSections,
      snapshot: financialSnapshot,
      year: navYear,
      month: navMonth,
    }

    // Try deterministic answer first
    const deterministic = tryDeterministicAnswer(text, chatCtx)
    if (deterministic.handled) {
      const aiMsg: AiChatMessage = {
        id: uid(),
        role: 'assistant',
        content: deterministic.answer,
        timestamp: nowIso(),
      }
      setMessages((prev) => [...prev, aiMsg])
      onNewAssistantMessage?.()
      playNotificationSound()
      return
    }

    // Fall through to AI for complex/advice questions
    setLoading(true)

    try {
      const systemPrompt = buildAiSystemPrompt(chatCtx, text)

      const conversationHistory = messages.slice(-4).map((m) => ({
        role: m.role,
        content: m.content,
      }))

      const res = await fetch(`${ollamaSettings.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          stream: false,
          options: {
            num_ctx: 2048,
            num_predict: 300,
          },
          messages: [
            { role: 'system', content: systemPrompt },
            ...conversationHistory,
            { role: 'user', content: text },
          ],
        }),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const responseText: string = data.message?.content ?? ''

      const { content, actions } = parseAiResponse(responseText)

      // Enrich action descriptions with obligation names
      const enrichedActions = actions.map((a) => {
        if (a.payload.obligationId) {
          const obl = obligations.find((o) => o.id === a.payload.obligationId)
          if (obl) {
            switch (a.type) {
              case 'edit': {
                const updates = a.payload.updates as Record<string, unknown> | undefined
                const changes = updates
                  ? Object.entries(updates)
                      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                      .join(', ')
                  : ''
                a.description = `Изменить «${obl.name}»: ${changes}`
                break
              }
              case 'delete':
                a.description = `Удалить «${obl.name}»`
                break
              case 'status':
                a.description = `«${obl.name}» → ${a.payload.status === 'paid' ? 'Оплачено' : a.payload.status === 'unpaid' ? 'Не оплачено' : 'Неизвестно'}`
                break
              case 'move':
                a.description = `Переместить «${obl.name}»`
                break
            }
          }
        }
        return a
      })

      const aiMsg: AiChatMessage = {
        id: uid(),
        role: 'assistant',
        content,
        actions: enrichedActions.length > 0 ? enrichedActions : undefined,
        timestamp: nowIso(),
      }
      setMessages((prev) => [...prev, aiMsg])
      onNewAssistantMessage?.()
      playNotificationSound()
    } catch (e) {
      const aiMsg: AiChatMessage = {
        id: uid(),
        role: 'assistant',
        content: `Ошибка: ${e instanceof Error ? e.message : String(e)}. Проверьте, что Ollama запущена.`,
        timestamp: nowIso(),
      }
      setMessages((prev) => [...prev, aiMsg])
      onNewAssistantMessage?.()
      playNotificationSound()
    } finally {
      setLoading(false)
    }
  }, [
    input,
    loading,
    obligations,
    obligationMonths,
    transactions,
    customSections,
    financialSnapshot,
    navYear,
    navMonth,
    messages,
    ollamaSettings.baseUrl,
    selectedModel,
  ])

  const applyAction = useCallback(
    async (msgId: string, actionId: string) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msgId || !m.actions) return m
          return {
            ...m,
            actions: m.actions.map((a) => (a.id === actionId ? { ...a, applied: true } : a)),
          }
        })
      )

      const msg = messages.find((m) => m.id === msgId)
      const action = msg?.actions?.find((a) => a.id === actionId)
      if (!action) return

      try {
        switch (action.type) {
          case 'edit': {
            const oblId = action.payload.obligationId as string
            const updates = action.payload.updates as Partial<Obligation>
            if (pushUndo) {
              const before = obligations.find((o) => o.id === oblId)
              if (before) {
                pushUndo('ИИ: изменение обязательства', { obligations: [before] }, { obligations: [{ ...before, ...updates }] })
              }
            }
            await onUpdate(oblId, updates)
            break
          }
          case 'delete': {
            const oblId = action.payload.obligationId as string
            if (pushUndo) {
              const before = obligations.find((o) => o.id === oblId)
              if (before) {
                pushUndo('ИИ: удаление обязательства', { obligations: [before] }, { obligations: obligations.filter((o) => o.id !== oblId) })
              }
            }
            await onDelete(oblId)
            break
          }
          case 'add': {
            const oblData = action.payload.obligation as Omit<Obligation, 'id' | 'createdAt'>
            await onAdd({
              name: oblData.name ?? 'Новое обязательство',
              type: oblData.type ?? 'subscription',
              amount: oblData.amount ?? null,
              approximateDay: oblData.approximateDay ?? null,
              billingChain: oblData.billingChain ?? 'other',
              source: oblData.source ?? 'Sparkasse',
              notes: oblData.notes,
              isActive: true,
              frequency: oblData.frequency ?? 'monthly',
            })
            break
          }
          case 'status': {
            const oblId = action.payload.obligationId as string
            const status = action.payload.status as ObligationStatus
            await onStatusChange(oblId, navYear, navMonth, status)
            break
          }
          case 'move': {
            const oblId = action.payload.obligationId as string
            const target = action.payload.sectionId as string
            if (target === 'monthly') {
              await onUpdate(oblId, { frequency: 'monthly', sectionId: undefined })
            } else if (target === 'yearly') {
              await onUpdate(oblId, { frequency: 'yearly', sectionId: undefined })
            } else {
              await onUpdate(oblId, { sectionId: target })
            }
            break
          }
          case 'create_section': {
            const name = action.payload.name as string
            await onAddSection(name)
            break
          }
        }
      } catch (e) {
        console.error('Failed to apply action:', e)
        // Revert applied state
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== msgId || !m.actions) return m
            return {
              ...m,
              actions: m.actions.map((a) => (a.id === actionId ? { ...a, applied: false } : a)),
            }
          })
        )
      }
    },
    [messages, obligations, navYear, navMonth, onAdd, onUpdate, onDelete, onStatusChange, onAddSection, pushUndo]
  )

  const handleModelChange = useCallback(
    async (model: string) => {
      setSelectedModel(model)
      await onUpdateOllamaSettings({ ...ollamaSettings, model })
      setShowModelPicker(false)
    },
    [ollamaSettings, onUpdateOllamaSettings]
  )

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl border-t border-neutral-700 bg-neutral-900 shadow-2xl"
          style={{ height: '50vh', minHeight: 320 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-purple-400" />
              <span className="text-sm font-medium text-neutral-200">ИИ-ассистент</span>
              <button
                onClick={() => setShowModelPicker(!showModelPicker)}
                className="flex items-center gap-1 rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400 hover:text-neutral-200"
              >
                <Settings2 className="h-3 w-3" />
                {selectedModel}
                <ChevronDown className="h-3 w-3" />
              </button>
              {showModelPicker && (
                <div className="absolute top-12 left-24 z-50 rounded-lg border border-neutral-700 bg-neutral-800 py-1 shadow-lg">
                  {availableModels.map((m) => (
                    <button
                      key={m}
                      onClick={() => handleModelChange(m)}
                      className={`block w-full px-4 py-1.5 text-left text-xs hover:bg-neutral-700 ${
                        m === selectedModel ? 'text-purple-300' : 'text-neutral-300'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                  {availableModels.length === 0 && (
                    <p className="px-4 py-2 text-xs text-neutral-500">Нет моделей</p>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={() => setMessages([])}
              title="Очистить чат"
              className="rounded p-1 text-neutral-500 hover:text-red-400"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              title="Закрыть"
              className="rounded p-1 text-neutral-500 hover:text-neutral-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <MessageSquare className="mx-auto mb-2 h-8 w-8 text-neutral-600" />
                  <p className="text-sm text-neutral-500">
                    Спросите что-нибудь об обязательствах или попросите внести изменения
                  </p>
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    {[
                      'Какие обязательства не оплачены?',
                      'Сколько я трачу в месяц?',
                      'Добавь Netflix за €13.99',
                      'Отметь Vodafone как оплачено',
                    ].map((hint) => (
                      <button
                        key={hint}
                        onClick={() => {
                          setInput(hint)
                          inputRef.current?.focus()
                        }}
                        className="rounded-lg bg-neutral-800 px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700"
                      >
                        {hint}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-purple-900/40 text-purple-100'
                      : 'bg-neutral-800 text-neutral-200'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>

                  {/* Action cards */}
                  {msg.actions && msg.actions.length > 0 && (
                    <div className="mt-2 space-y-1.5 border-t border-neutral-700 pt-2">
                      {msg.actions.map((action) => (
                        <div
                          key={action.id}
                          className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs ${
                            action.applied
                              ? 'bg-green-900/30 text-green-300'
                              : 'bg-neutral-700/50 text-neutral-300'
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            {action.applied ? (
                              <Check className="h-3.5 w-3.5 text-green-400" />
                            ) : (
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                            )}
                            {action.description}
                          </span>
                          {!action.applied && (
                            <button
                              onClick={() => applyAction(msg.id, action.id)}
                              className="shrink-0 rounded bg-purple-800/60 px-2 py-0.5 text-xs font-medium text-purple-200 hover:bg-purple-700/60"
                            >
                              Применить
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-xl bg-neutral-800 px-3 py-2 text-sm text-neutral-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Думаю...
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-neutral-800 px-4 py-3">
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Спросите или попросите изменить..."
                rows={1}
                className="flex-1 resize-none rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-500 focus:border-purple-600 focus:outline-none"
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || loading}
                className="rounded-lg bg-purple-800 px-3 py-2 text-purple-200 hover:bg-purple-700 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
