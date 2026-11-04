import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

// autoUpdater fals: EventEmitter + metode controlabile din test.
const au = vi.hoisted(() => {
  const { EventEmitter: EE } = require('events')
  return new EE()
})
au.checkForUpdates = vi.fn()
au.downloadUpdate = vi.fn()
au.quitAndInstall = vi.fn()

vi.mock('electron-updater', () => ({ autoUpdater: au }))
vi.mock('../src/main/lifecycle', () => ({ flushEverything: vi.fn(async () => {}) }))
vi.mock('../src/main/appConfig', () => ({ getAutoUpdate: () => true, setAutoUpdate: vi.fn() }))

let updater
let win
const sent = () => win.webContents.send.mock.calls.map((c) => c[1])
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))

beforeEach(async () => {
  au.removeAllListeners()
  au.checkForUpdates.mockReset().mockResolvedValue(undefined)
  au.downloadUpdate.mockReset().mockResolvedValue(undefined)
  au.quitAndInstall.mockReset()
  vi.resetModules()
  updater = await import('../src/main/updater.js')
  win = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    webContents: { send: vi.fn() }
  })
  updater.initUpdater(win)
  await vi.waitFor(() => expect(au.checkForUpdates).toHaveBeenCalledTimes(1)) // verificarea de pornire
  await tick(0)
  au.checkForUpdates.mockClear()
  win.webContents.send.mockClear()
})

describe('updater', () => {
  it('descarcare esuata: reseteaza starea si urmatoarea verificare ruleaza', async () => {
    au.emit('update-available', { version: '2.0.0' })
    au.emit('download-progress', { percent: 10 }) // downloading = true
    au.emit('error', new Error('net::ERR_FAILED'))
    // eroarea de descarcare se arata utilizatorului
    expect(sent().some((e) => e.type === 'error')).toBe(true)

    updater.checkForUpdatesSafe(true)
    await vi.waitFor(() => expect(au.checkForUpdates).toHaveBeenCalledTimes(1))
  })

  it('control: cat timp descarcarea e in curs, verificarile sunt ignorate', async () => {
    au.emit('download-progress', { percent: 10 })
    updater.checkForUpdatesSafe(true)
    await tick()
    expect(au.checkForUpdates).not.toHaveBeenCalled()
  })

  it('downloadUpdateNow esuat: nu dubleaza eroarea si permite reincercarea', async () => {
    au.downloadUpdate.mockImplementation(() => {
      au.emit('error', new Error('boom'))
      return Promise.reject(new Error('boom'))
    })
    updater.downloadUpdateNow()
    await tick()
    expect(sent().filter((e) => e.type === 'error')).toHaveLength(1)
    updater.downloadUpdateNow()
    expect(au.downloadUpdate).toHaveBeenCalledTimes(2)
  })

  it('flag-ul manual se reseteaza dupa verificarea manuala', async () => {
    au.checkForUpdates.mockImplementation(async () => {
      au.emit('checking-for-update')
      au.emit('update-not-available')
    })
    updater.checkForUpdatesSafe(true)
    await vi.waitFor(() => expect(sent().some((e) => e.type === 'not-available')).toBe(true))
    expect(sent().find((e) => e.type === 'checking').manual).toBe(true)

    win.webContents.send.mockClear()
    au.emit('checking-for-update')
    expect(sent()[0].manual).toBe(false)
  })

  it('flag-ul manual se reseteaza si dupa eroare', async () => {
    au.checkForUpdates.mockRejectedValue(new Error('offline'))
    updater.checkForUpdatesSafe(true)
    await vi.waitFor(() => expect(sent().some((e) => e.type === 'error' && e.manual)).toBe(true))
    await tick()
    win.webContents.send.mockClear()
    au.emit('error', new Error('periodic'))
    expect(sent()).toHaveLength(0)
  })

  it('eroare periodica (nemanuala, fara descarcare) nu se arata', () => {
    au.emit('error', new Error('GitHub jos'))
    expect(sent()).toHaveLength(0)
  })

  it('update-downloaded: anunta UI-ul si opreste verificarile', async () => {
    au.emit('update-downloaded', { version: '2.0.0' })
    expect(sent()).toContainEqual(expect.objectContaining({ type: 'downloaded', version: '2.0.0' }))
    updater.checkForUpdatesSafe(true)
    await tick()
    expect(au.checkForUpdates).not.toHaveBeenCalled()
    await updater.installUpdateNow()
    expect(au.quitAndInstall).toHaveBeenCalled()
  })

  it('installUpdateNow nu face nimic fara update descarcat', async () => {
    await updater.installUpdateNow()
    expect(au.quitAndInstall).not.toHaveBeenCalled()
  })
})
