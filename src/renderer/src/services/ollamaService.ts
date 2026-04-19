import type { OllamaResult } from '../types'
import { captureError } from './errorRegistry'

export async function fetchOllamaModels(baseUrl: string): Promise<string[]> {
  const res = await fetch(`${baseUrl}/api/tags`)
  const data = await res.json()
  return data.models?.map((m: { name: string }) => m.name) ?? []
}

export async function safeOllamaCall<T>(
  prompt: string,
  baseUrl: string,
  model: string,
  validator: (data: unknown) => { valid: boolean; errors: string[] }
): Promise<OllamaResult<T>> {
  const start = Date.now()
  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
    })
    if (!res.ok) {
      const err = {
        success: false,
        rawResponse: `HTTP ${res.status}: ${res.statusText}`,
        validationErrors: [`Ollama недоступна (HTTP ${res.status})`],
        model,
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      }
      captureError(new Error(err.rawResponse), 'ollama_error', 'ollama HTTP error')
      return err
    }
    const raw = await res.json()
    const text: string = raw.response ?? ''
    const cleaned = text.replace(/```json|```/g, '').trim()
    let parsed: unknown
    try {
      parsed = JSON.parse(cleaned)
    } catch (e) {
      const err = {
        success: false,
        rawResponse: cleaned,
        validationErrors: [
          `JSON.parse failed: ${(e as Error).message}`,
          `Первые 200 символов: ${cleaned.slice(0, 200)}`,
        ],
        model,
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      }
      captureError(e, 'ollama_error', 'JSON parse failed')
      return err
    }
    const { valid, errors } = validator(parsed)
    if (!valid) {
      captureError(new Error(errors.join('; ')), 'validation_error', 'schema validation failed')
      return {
        success: false,
        rawResponse: cleaned,
        validationErrors: errors,
        model,
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      }
    }
    return {
      success: true,
      data: parsed as T,
      rawResponse: cleaned,
      validationErrors: [],
      model,
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    }
  } catch (e) {
    captureError(e, 'ollama_error', 'network error')
    return {
      success: false,
      rawResponse: String(e),
      validationErrors: [`Сетевая ошибка: ${(e as Error).message}`],
      model,
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    }
  }
}

export function validateBrainResult(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (typeof data !== 'object' || data === null)
    return { valid: false, errors: ['Ответ не является объектом'] }
  const d = data as Record<string, unknown>
  if (typeof d.priority_action !== 'string') errors.push('priority_action: ожидается string')
  if (typeof d.weekly_summary !== 'string') errors.push('weekly_summary: ожидается string')
  if (typeof d.tip !== 'string') errors.push('tip: ожидается string')
  if (!Array.isArray(d.alerts)) {
    errors.push('alerts: ожидается array')
  } else {
    d.alerts.forEach((a, i) => {
      const ai = a as Record<string, unknown>
      if (typeof ai.message !== 'string') errors.push(`alerts[${i}].message: ожидается string`)
      if (!['high', 'medium', 'low'].includes(ai.urgency as string))
        errors.push(`alerts[${i}].urgency: ожидается high|medium|low`)
    })
  }
  return { valid: errors.length === 0, errors }
}

export function validateObligationsAnalysis(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (typeof data !== 'object' || data === null)
    return { valid: false, errors: ['Ответ не является объектом'] }
  const d = data as Record<string, unknown>
  if (typeof d.summary !== 'string') errors.push('summary: ожидается string')
  if (typeof d.monthlyTotal !== 'number') errors.push('monthlyTotal: ожидается number')
  if (typeof d.yearlyTotal !== 'number') errors.push('yearlyTotal: ожидается number')
  if (!Array.isArray(d.alerts)) errors.push('alerts: ожидается array')
  if (!Array.isArray(d.recommendations)) errors.push('recommendations: ожидается array')
  return { valid: errors.length === 0, errors }
}

