import { describe, it, expect, beforeEach } from 'vitest'
import { pushHistory } from '../services/historyService'
import type { HistoryEntry, AppData } from '../types'

describe('pushHistory', () => {
  it('добавляет запись в начало стека', () => {
    const result = pushHistory([], 'Изменён статус Netflix', {}, {})
    expect(result).toHaveLength(1)
    expect(result[0].action).toBe('Изменён статус Netflix')
  })

  it('новые записи идут первыми', () => {
    let history = pushHistory([], 'Действие 1', {}, {})
    history = pushHistory(history, 'Действие 2', {}, {})
    expect(history[0].action).toBe('Действие 2')
    expect(history[1].action).toBe('Действие 1')
  })

  it('не превышает лимит 10 записей', () => {
    let history = pushHistory([], 'init', {}, {})
    for (let i = 0; i < 12; i++) {
      history = pushHistory(history, `Действие ${i}`, {}, {})
    }
    expect(history).toHaveLength(10)
  })

  it('удаляет самые старые записи при переполнении', () => {
    let history = pushHistory([], 'Старое', {}, {})
    for (let i = 0; i < 10; i++) {
      history = pushHistory(history, `Новое ${i}`, {}, {})
    }
    expect(history.some((h) => h.action === 'Старое')).toBe(false)
  })

  it('сохраняет snapshotBefore и snapshotAfter', () => {
    const before = { obligations: [] }
    const after = { obligations: [{ id: 'ob-1' } as never] }
    const result = pushHistory([], 'тест', before, after)
    expect(result[0].snapshotBefore).toEqual(before)
    expect(result[0].snapshotAfter).toEqual(after)
  })

  it('каждая запись имеет уникальный id', () => {
    let history = pushHistory([], '1', {}, {})
    history = pushHistory(history, '2', {}, {})
    expect(history[0].id).not.toBe(history[1].id)
  })

  it('каждая запись имеет timestamp', () => {
    const before = new Date().getTime()
    const result = pushHistory([], 'тест', {}, {})
    const after = new Date().getTime()
    const timestamp = new Date(result[0].timestamp).getTime()
    expect(timestamp).toBeGreaterThanOrEqual(before)
    expect(timestamp).toBeLessThanOrEqual(after)
  })

  it('возвращает новый массив, не мутируя исходный', () => {
    const original: HistoryEntry[] = []
    const result = pushHistory(original, 'тест', {}, {})
    expect(original).toHaveLength(0)
    expect(result).toHaveLength(1)
    expect(result).not.toBe(original)
  })

  it('сохраняет существующие записи при добавлении новой', () => {
    const existing: HistoryEntry[] = [
      {
        id: 'existing-id',
        timestamp: new Date().toISOString(),
        action: 'existing',
        snapshotBefore: {},
        snapshotAfter: {},
      },
    ]
    const result = pushHistory(existing, 'новая', {}, {})
    expect(result).toHaveLength(2)
    expect(result[1].action).toBe('existing')
    expect(result[1].id).toBe('existing-id')
  })

  it('корректно работает с пустыми snapshot', () => {
    const result = pushHistory([], 'тест', {}, {})
    expect(result[0].snapshotBefore).toEqual({})
    expect(result[0].snapshotAfter).toEqual({})
  })

  it('корректно работает с глубокими snapshot', () => {
    const before = { obligations: [{ id: 'ob-1', name: 'Test' }] }
    const after = { obligations: [{ id: 'ob-1', name: 'Updated' }] }
    const result = pushHistory([], 'тест', before, after)
    expect(result[0].snapshotBefore.obligations).toEqual(before.obligations)
    expect(result[0].snapshotAfter.obligations).toEqual(after.obligations)
  })

  it('при переполнении удаляет ровно одну старую запись', () => {
    let history: HistoryEntry[] = []
    for (let i = 0; i < 10; i++) {
      history = pushHistory(history, `Действие ${i}`, {}, {})
    }
    expect(history).toHaveLength(10)
    expect(history[0].action).toBe('Действие 9')
    expect(history[9].action).toBe('Действие 0')

    history = pushHistory(history, 'Действие 10', {}, {})
    expect(history).toHaveLength(10)
    expect(history[0].action).toBe('Действие 10')
    expect(history[9].action).toBe('Действие 1')
    expect(history.some((h) => h.action === 'Действие 0')).toBe(false)
  })
})
