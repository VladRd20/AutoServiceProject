import { vi } from 'vitest'

// Backoff-ul real al withRetry (~3-4s la epuizare) ar incetini inutil testele care
// ating erori tranzitorii; il comprimam global. Bugetul real e verificat explicit
// in storage-resilience.test.js (scara readusa la 1 + timere fake).
// Env var (nu setter): helpers.js face vi.resetModules(), iar io.js se reincarca.
process.env.SA_TEST_RETRY_SCALE = '0.01'

// Logger-ul real porneste electron-log si inregistreaza handlere globale de
// erori - in teste vrem zgomot minim si nicio stare globala.
vi.mock('../src/main/logger.js', () => {
  const noop = () => {}
  const log = { info: noop, warn: noop, error: noop, debug: noop }
  return { default: log, ...log, setMainWindow: noop, exportLogs: async () => ({}) }
})
