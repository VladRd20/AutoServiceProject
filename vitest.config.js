import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js', 'tests/**/*.dom.test.jsx'],
    setupFiles: ['tests/setup.js'],
    testTimeout: 20000,
    pool: 'forks'
  },
  resolve: {
    alias: { electron: resolve('tests/stubs/electron.js') }
  }
})
