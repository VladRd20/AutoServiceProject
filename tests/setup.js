import { vi } from 'vitest'

// Logger-ul real porneste electron-log si inregistreaza handlere globale de
// erori - in teste vrem zgomot minim si nicio stare globala.
vi.mock('../src/main/logger.js', () => {
  const noop = () => {}
  const log = { info: noop, warn: noop, error: noop, debug: noop }
  return { default: log, ...log, setMainWindow: noop, exportLogs: async () => ({}) }
})
