import { describe, it, expect } from 'vitest'
import {
  validateBrainResult,
  validateObligationsAnalysis,
} from '../services/ollamaService'

describe('validateBrainResult', () => {
  it('принимает корректный объект', () => {
    const { valid } = validateBrainResult({
      priority_action: 'Проверь баланс Sparkasse',
      weekly_summary: 'Всё в порядке.',
      alerts: [{ message: 'Платёж завтра', urgency: 'high' }],
      tip: 'Отложи 10% дохода',
    })
    expect(valid).toBe(true)
  })

  it('отклоняет null', () => {
    const { valid, errors } = validateBrainResult(null)
    expect(valid).toBe(false)
    expect(errors.length).toBeGreaterThan(0)
  })

  it('отклоняет если priority_action не string', () => {
    const { valid, errors } = validateBrainResult({
      priority_action: 123,
      weekly_summary: 'ok',
      alerts: [],
      tip: 'ok',
    })
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('priority_action'))).toBe(true)
  })

  it('отклоняет если weekly_summary не string', () => {
    const { valid, errors } = validateBrainResult({
      priority_action: 'ok',
      weekly_summary: null,
      alerts: [],
      tip: 'ok',
    })
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('weekly_summary'))).toBe(true)
  })

  it('отклоняет если tip не string', () => {
    const { valid, errors } = validateBrainResult({
      priority_action: 'ok',
      weekly_summary: 'ok',
      alerts: [],
      tip: 123,
    })
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('tip'))).toBe(true)
  })

  it('отклоняет если alerts не массив', () => {
    const { valid, errors } = validateBrainResult({
      priority_action: 'ok',
      weekly_summary: 'ok',
      alerts: 'not an array',
      tip: 'ok',
    })
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('alerts'))).toBe(true)
  })

  it('отклоняет если urgency не входит в допустимые значения', () => {
    const { valid, errors } = validateBrainResult({
      priority_action: 'ok',
      weekly_summary: 'ok',
      alerts: [{ message: 'test', urgency: 'extreme' }],
      tip: 'ok',
    })
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('urgency'))).toBe(true)
  })

  it('принимает пустой массив alerts', () => {
    const { valid } = validateBrainResult({
      priority_action: 'ok',
      weekly_summary: 'ok',
      alerts: [],
      tip: 'ok',
    })
    expect(valid).toBe(true)
  })

  it('принимает несколько alerts с корректными urgency', () => {
    const { valid, errors } = validateBrainResult({
      priority_action: 'ok',
      weekly_summary: 'ok',
      alerts: [
        { message: 'alert1', urgency: 'high' },
        { message: 'alert2', urgency: 'medium' },
        { message: 'alert3', urgency: 'low' },
      ],
      tip: 'ok',
    })
    expect(valid).toBe(true)
    expect(errors).toHaveLength(0)
  })

  it('отклоняет если alert.message не string', () => {
    const { valid, errors } = validateBrainResult({
      priority_action: 'ok',
      weekly_summary: 'ok',
      alerts: [{ message: 123, urgency: 'high' }],
      tip: 'ok',
    })
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('message'))).toBe(true)
  })
})

describe('validateObligationsAnalysis', () => {
  it('принимает корректный объект', () => {
    const { valid } = validateObligationsAnalysis({
      summary: 'Всё стабильно',
      monthlyTotal: 450,
      yearlyTotal: 120,
      alerts: [],
      recommendations: [],
    })
    expect(valid).toBe(true)
  })

  it('отклоняет null', () => {
    const { valid, errors } = validateObligationsAnalysis(null)
    expect(valid).toBe(false)
    expect(errors.length).toBeGreaterThan(0)
  })

  it('отклоняет если summary не string', () => {
    const { valid, errors } = validateObligationsAnalysis({
      summary: 123,
      monthlyTotal: 450,
      yearlyTotal: 0,
      alerts: [],
      recommendations: [],
    })
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('summary'))).toBe(true)
  })

  it('отклоняет если monthlyTotal не number', () => {
    const { valid, errors } = validateObligationsAnalysis({
      summary: 'ok',
      monthlyTotal: '450€',
      yearlyTotal: 0,
      alerts: [],
      recommendations: [],
    })
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('monthlyTotal'))).toBe(true)
  })

  it('отклоняет если yearlyTotal не number', () => {
    const { valid, errors } = validateObligationsAnalysis({
      summary: 'ok',
      monthlyTotal: 450,
      yearlyTotal: '120€',
      alerts: [],
      recommendations: [],
    })
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('yearlyTotal'))).toBe(true)
  })

  it('отклоняет если alerts не массив', () => {
    const { valid, errors } = validateObligationsAnalysis({
      summary: 'ok',
      monthlyTotal: 450,
      yearlyTotal: 0,
      alerts: 'not array',
      recommendations: [],
    })
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('alerts'))).toBe(true)
  })

  it('отклоняет если recommendations не массив', () => {
    const { valid, errors } = validateObligationsAnalysis({
      summary: 'ok',
      monthlyTotal: 450,
      yearlyTotal: 0,
      alerts: [],
      recommendations: 'not array',
    })
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('recommendations'))).toBe(true)
  })

  it('принимает пустые массивы alerts и recommendations', () => {
    const { valid } = validateObligationsAnalysis({
      summary: 'ok',
      monthlyTotal: 450,
      yearlyTotal: 0,
      alerts: [],
      recommendations: [],
    })
    expect(valid).toBe(true)
  })
})
