import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['node_modules', 'dist', '.idea', '.git', '.cache', 'build'],
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
    },
  },
})
