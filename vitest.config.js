import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
    testTimeout: 20000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } }
  },
  resolve: {
    alias: { electron: resolve('tests/stubs/electron.js') }
  }
})
