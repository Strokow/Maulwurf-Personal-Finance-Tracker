import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ['electron-store', 'conf', 'atomically', 'dot-prop', 'env-paths', 'json-schema-typed', 'ajv']
      })
    ]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    // @ts-ignore - vitest test config is not in electron-vite renderer type
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/renderer/src/tests/setup.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
        include: [
          'src/renderer/src/utils/financialEngine.ts',
          'src/renderer/src/services/ollamaService.ts',
          'src/renderer/src/services/historyService.ts',
          'src/renderer/src/services/errorRegistry.ts',
          'src/main/pinService.ts',
        ],
        thresholds: {
          lines: 80,
          functions: 80,
          branches: 75,
        },
      },
    },
  },
})
