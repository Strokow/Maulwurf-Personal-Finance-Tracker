import { vi } from 'vitest'

// Mock crypto.randomUUID for deterministic IDs in tests
Object.defineProperty(globalThis, 'crypto', {
  value: {
    randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2),
  },
  writable: true,
  configurable: true,
})

// Mock window.crypto for browser APIs
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'crypto', {
    value: {
      randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2),
    },
    writable: true,
    configurable: true,
  })
}
