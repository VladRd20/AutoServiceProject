import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeEnv } from './helpers'

let env
let lifecycle
beforeEach(async () => {
  env = await makeEnv()
  lifecycle = await import('../src/main/lifecycle.js')
})
afterEach(() => {
  vi.useRealTimers()
  env.cleanup()
})

function fakeWindow({ crashed = false, ack = true, destroyed = false } = {}) {
  const win = new EventEmitter()
  const sent = []
  win.destroyed = destroyed
  win.isDestroyed = () => win.destroyed
  win.close = vi.fn(() => {
    const event = { prevented: false, preventDefault() { this.prevented = true } }
    win.emit('close', event)
    if (!event.prevented) win.destroyed = true
    return event
  })
  win.webContents = {
    isDestroyed: () => false,
    isCrashed: () => crashed,
    send: vi.fn((channel, id) => {
      sent.push([channel, id])
      if (ack) setTimeout(() => lifecycle.handleFlushDone(id), 5)
    })
  }
  win.sent = sent
  return win
}

describe('inchidere fereastra', () => {
  it('cere flush renderer-ului si abia dupa confirmare inchide fereastra', async () => {
    const win = fakeWindow()
    lifecycle.attachWindow(win)
    lifecycle.guardWindowClose(win)
    const first = win.close()
    expect(first.prevented).toBe(true) // amanata
    expect(win.destroyed).toBe(false)
    await vi.waitFor(() => expect(win.destroyed).toBe(true))
    expect(win.sent).toHaveLength(1)
    expect(win.sent[0][0]).toBe('app:flush')
  })

  it('renderer care NU raspunde: inchiderea continua dupa timeout (nu ramane blocata)', async () => {
    vi.useFakeTimers()
    const win = fakeWindow({ ack: false })
    lifecycle.attachWindow(win)
    lifecycle.guardWindowClose(win)
    win.close()
    await vi.advanceTimersByTimeAsync(3900)
    expect(win.destroyed).toBe(false)
    await vi.advanceTimersByTimeAsync(300)
    vi.useRealTimers() // backup-ul final foloseste I/O real
    await vi.waitFor(() => expect(win.destroyed).toBe(true))
  })

  it('renderer prabusit: nu se asteapta deloc', async () => {
    const win = fakeWindow({ crashed: true })
    lifecycle.attachWindow(win)
    lifecycle.guardWindowClose(win)
    win.close()
    await vi.waitFor(() => expect(win.destroyed).toBe(true))
    expect(win.sent).toHaveLength(0)
  })

  it('inchideri repetate (dublu-click pe X) declanseaza un singur flush', async () => {
    const win = fakeWindow()
    lifecycle.attachWindow(win)
    lifecycle.guardWindowClose(win)
    win.close()
    win.close()
    win.close()
    await vi.waitFor(() => expect(win.destroyed).toBe(true))
    expect(win.sent).toHaveLength(1)
  })

  it('confirmari tarzii sau cu id necunoscut sunt ignorate fara erori', async () => {
    expect(() => lifecycle.handleFlushDone(99999)).not.toThrow()
    const win = fakeWindow({ ack: false })
    lifecycle.attachWindow(win)
    vi.useFakeTimers()
    const p = lifecycle.requestRendererFlush(100)
    await vi.advanceTimersByTimeAsync(150)
    expect(await p).toBe(false)
    expect(() => lifecycle.handleFlushDone(win.sent[0][1])).not.toThrow()
  })

  it('fara fereastra / fereastra distrusa: flush = false, fara exceptii', async () => {
    lifecycle.attachWindow(null)
    expect(await lifecycle.requestRendererFlush()).toBe(false)
    lifecycle.attachWindow(fakeWindow({ destroyed: true }))
    expect(await lifecycle.requestRendererFlush()).toBe(false)
  })

  it('flushEverything ruleaza si backup-ul (fisa finalizata cu <5s inainte de inchidere ajunge in backup)', async () => {
    const { fise } = await import('../src/main/fileStore.js').then(async (fs) => ({ fise: fs }))
    const { fisa, ls } = await import('./helpers')
    const path = await import('path')
    const r = await fise.finalizeFisa(fisa())
    lifecycle.attachWindow(fakeWindow())
    await lifecycle.flushEverything()
    expect(ls(path.join(env.safety, 'fise'))).toContain(`${r.baseName}.json`)
  })
})
