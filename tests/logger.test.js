import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-log/main', () => {
  const noop = () => {}
  const log = { initialize: noop, info: noop, warn: noop, error: noop, transports: { file: {}, console: {} } }
  return { default: log }
})

describe('logger: isBenignRejection', () => {
  it('ignora erorile de retea cunoscute, nu si pe cele reale', async () => {
    const { isBenignRejection } = await vi.importActual('../src/main/logger.js')
    expect(isBenignRejection(new Error('net::ERR_INTERNET_DISCONNECTED'))).toBe(true)
    expect(isBenignRejection(Object.assign(new Error('x'), { code: 'ENOTFOUND' }))).toBe(true)
    expect(isBenignRejection(new Error('read ECONNRESET'))).toBe(true)
    expect(isBenignRejection(new Error('connect ETIMEDOUT 1.2.3.4'))).toBe(true)
    expect(isBenignRejection(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isBenignRejection('net::ERR_FAILED')).toBe(false) // non-Error: nu presupunem nimic
  })
})
