import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setCurrentPage,
  pushBreadcrumb,
  captureError,
  initErrorRegistry,
  installGlobalErrorHandlers,
} from '../services/errorRegistry'
import type { ErrorRecord } from '../types'

describe('errorRegistry', () => {
  let captured: ErrorRecord[] = []
  let mockStore: {
    addError: (e: ErrorRecord) => void
    getBreadcrumbs: () => string[]
  }

  beforeEach(() => {
    captured = []
    mockStore = {
      addError: (e) => captured.push(e),
      getBreadcrumbs: () => [],
    }
    initErrorRegistry(mockStore)
  })

  it('captureError создаёт запись с правильной категорией', () => {
    const record = captureError(new Error('тест'), 'js_exception', 'тест действие')
    expect(record.category).toBe('js_exception')
    expect(record.message).toBe('тест')
    expect(record.resolved).toBe(false)
  })

  it('captureError включает текущую страницу', () => {
    setCurrentPage('obligations')
    const record = captureError(new Error('x'), 'validation_error')
    expect(record.context.page).toBe('obligations')
  })

  it('captureError сохраняет breadcrumbs на момент ошибки', () => {
    pushBreadcrumb('Открыта страница: dashboard')
    pushBreadcrumb('Клик на обязательство')
    const record = captureError(new Error('x'), 'js_exception')
    expect(record.context.breadcrumbs).toContain('Клик на обязательство')
  })

  it('breadcrumbs не превышают 5 записей', () => {
    for (let i = 0; i < 10; i++) pushBreadcrumb(`Действие ${i}`)
    const record = captureError(new Error('x'), 'js_exception')
    expect(record.context.breadcrumbs.length).toBeLessThanOrEqual(5)
  })

  it('сохраняет stack trace для Error объектов', () => {
    const err = new Error('с трейсом')
    const record = captureError(err, 'js_exception')
    expect(record.stack).toBeDefined()
    expect(record.stack).toContain('с трейсом')
  })

  it('обрабатывает не-Error объекты', () => {
    const record = captureError('просто строка', 'ipc_error')
    expect(record.message).toBe('просто строка')
  })

  it('обрабатывает объекты как [object Object]', () => {
    const record = captureError({ message: 'custom error' }, 'validation_error')
    expect(record.message).toBe('[object Object]')
  })

  it('обрабатывает null и undefined', () => {
    const record1 = captureError(null, 'js_exception')
    expect(record1.message).toBe('null')

    const record2 = captureError(undefined, 'js_exception')
    expect(record2.message).toBe('undefined')
  })

  it('вызывает addError в store', () => {
    captureError(new Error('x'), 'js_exception')
    expect(captured).toHaveLength(1)
  })

  it('генерирует уникальный id для каждой записи', () => {
    const record1 = captureError(new Error('x'), 'js_exception')
    const record2 = captureError(new Error('y'), 'js_exception')
    expect(record1.id).not.toBe(record2.id)
  })

  it('устанавливает правильный timestamp', () => {
    const before = Date.now()
    const record = captureError(new Error('x'), 'js_exception')
    const after = Date.now()
    const recordTime = new Date(record.timestamp).getTime()
    expect(recordTime).toBeGreaterThanOrEqual(before)
    expect(recordTime).toBeLessThanOrEqual(after)
  })

  it('сохраняет action в контексте', () => {
    const record = captureError(new Error('x'), 'js_exception', 'custom action')
    expect(record.context.action).toBe('custom action')
  })

  it('initErrorRegistry инициализирует breadcrumbs из store', () => {
    const storeWithBreadcrumbs = {
      addError: vi.fn(),
      getBreadcrumbs: () => ['breadcrumb1', 'breadcrumb2'],
    }
    initErrorRegistry(storeWithBreadcrumbs)
    const record = captureError(new Error('x'), 'js_exception')
    expect(record.context.breadcrumbs).toContain('breadcrumb2')
  })

  it('setCurrentPage добавляет breadcrumb', () => {
    setCurrentPage('settings')
    const record = captureError(new Error('x'), 'js_exception')
    expect(record.context.breadcrumbs).toContain('Открыта страница: settings')
  })

  it('pushBreadcrumb добавляет запись в буфер', () => {
    pushBreadcrumb('test action')
    const record = captureError(new Error('x'), 'js_exception')
    expect(record.context.breadcrumbs).toContain('test action')
  })

  it('последние breadcrumbs сохраняются при переполнении', () => {
    for (let i = 0; i < 10; i++) {
      pushBreadcrumb(`action ${i}`)
    }
    const record = captureError(new Error('x'), 'js_exception')
    expect(record.context.breadcrumbs).toContain('action 9')
    expect(record.context.breadcrumbs).toContain('action 6')
    expect(record.context.breadcrumbs).not.toContain('action 4')
  })

  it('категория ollama_error корректно сохраняется', () => {
    const record = captureError(new Error('Ollama failed'), 'ollama_error')
    expect(record.category).toBe('ollama_error')
  })

  it('категория validation_error корректно сохраняется', () => {
    const record = captureError(new Error('Invalid data'), 'validation_error')
    expect(record.category).toBe('validation_error')
  })

  it('категория ipc_error корректно сохраняется', () => {
    const record = captureError(new Error('IPC failed'), 'ipc_error')
    expect(record.category).toBe('ipc_error')
  })
})

describe('installGlobalErrorHandlers', () => {
  let mockStore: {
    addError: (e: ErrorRecord) => void
    getBreadcrumbs: () => string[]
  }

  beforeEach(() => {
    mockStore = {
      addError: vi.fn(),
      getBreadcrumbs: () => [],
    }
  })

  it('устанавливает обработчики', () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener').mockImplementation(() => {})
    installGlobalErrorHandlers(mockStore)
    expect(addEventListenerSpy).toHaveBeenCalledWith('error', expect.any(Function))
    expect(addEventListenerSpy).toHaveBeenCalledWith(
      'unhandledrejection',
      expect.any(Function)
    )
    addEventListenerSpy.mockRestore()
  })
})
