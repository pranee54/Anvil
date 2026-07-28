import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  },
  resolve: {
    alias: {
      '@main': resolve('apps/legacy-electron/src/main'),
      '@shared': resolve('apps/legacy-electron/src/shared')
    }
  }
})
