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
  const events = []
  win.destroyed = destroyed
  win.isDestroyed = () => win.destroyed
  win.close = vi.fn(() => {
    const event = {
      prevented: false,
      preventDefault() {
        this.prevented = true
      }
    }
    win.emit('close', event)
    if (!event.prevented) win.destroyed = true
    return event
  })
  win.webContents = {
    isDestroyed: () => false,
    isCrashed: () => crashed,
    send: vi.fn((channel, id) => {
      if (channel !== 'app:flush') {
        events.push([channel, id])
        return
      }
      sent.push([channel, id])
      if (ack) setTimeout(() => lifecycle.handleFlushDone(id), 5)
    })
  }
  win.sent = sent // doar cererile de flush
  win.events = events // alte evenimente catre renderer (ex: app:closing)
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

  it('anunta renderer-ul ca inchiderea a inceput (app:closing) inainte de flush', async () => {
    const win = fakeWindow()
    lifecycle.attachWindow(win)
    lifecycle.guardWindowClose(win)
    win.close()
    expect(win.events).toEqual([['app:closing', true]])
    await vi.waitFor(() => expect(win.destroyed).toBe(true))
    expect(win.events).toHaveLength(1)
  })

  it('fara renderer viu nu se trimite app:closing; inchideri repetate il trimit o singura data', async () => {
    const crashed = fakeWindow({ crashed: true })
    lifecycle.attachWindow(crashed)
    lifecycle.guardWindowClose(crashed)
    crashed.close()
    await vi.waitFor(() => expect(crashed.destroyed).toBe(true))
    expect(crashed.events).toHaveLength(0)

    const win = fakeWindow()
    lifecycle.attachWindow(win)
    lifecycle.guardWindowClose(win)
    win.close()
    win.close()
    await vi.waitFor(() => expect(win.destroyed).toBe(true))
    expect(win.events.filter(([c]) => c === 'app:closing')).toHaveLength(1)
  })

  it('daca fereastra ramane deschisa dupa flush (inchidere oprita), overlay-ul e ascuns (app:closing=false)', async () => {
    // Doar setTimeout e fals: flush-ul foloseste I/O real, iar pauza de 1.5s
    // (CLOSE_ABORT_CHECK_MS) se parcurge prin avansarea timerelor, nu prin asteptare.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const win = fakeWindow()
    win.close = vi.fn(() => {
      const event = {
        prevented: false,
        preventDefault() {
          this.prevented = true
        }
      }
      win.emit('close', event)
      return event // fereastra NU se distruge: beforeunload a oprit inchiderea
    })
    lifecycle.attachWindow(win)
    lifecycle.guardWindowClose(win)
    win.close()
    expect(win.events).toEqual([['app:closing', true]])
    // Avansam timpul fals pas cu pas, lasand I/O-ul real al flush-ului sa se termine.
    for (let i = 0; i < 400 && win.events.length < 2; i++) {
      await vi.advanceTimersByTimeAsync(100)
      await new Promise((r) => setImmediate(r))
    }
    expect(win.events[1]).toEqual(['app:closing', false])
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

  it('nu intra in bucla infinita cand evenimentul "close" nativ soseste asincron fata de apelul w.close()', async () => {
    // Electron real nu garanteaza ca evenimentul 'close' e emis sincron din
    // w.close() (poate veni printr-un round-trip OS, pe urmatorul tick).
    // Garda nu trebuie sa trateze acel 'close' intarziat, declansat chiar de
    // ea, ca pe o inchidere noua a utilizatorului.
    const win = new EventEmitter()
    win.destroyed = false
    win.isDestroyed = () => win.destroyed
    win.close = vi.fn(() => {
      setTimeout(() => {
        const event = {
          prevented: false,
          preventDefault() {
            this.prevented = true
          }
        }
        win.emit('close', event)
        if (!event.prevented) win.destroyed = true
      }, 0)
    })
    const sent = []
    win.webContents = {
      isDestroyed: () => false,
      isCrashed: () => false,
      send: (channel, id) => {
        if (channel !== 'app:flush') return
        sent.push(id)
        setTimeout(() => lifecycle.handleFlushDone(id), 1)
      }
    }
    lifecycle.attachWindow(win)
    lifecycle.guardWindowClose(win)
    win.close()
    await vi.waitFor(() => expect(win.destroyed).toBe(true), { timeout: 2000 })
    expect(sent).toHaveLength(1)
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

  it('flush blocat (OneDrive) nu tine inchiderea peste plafon: inchide dupa 15s', async () => {
    const io = await import('../src/main/store/io.js')
    // O scriere care nu se termina niciodata tine coada 'fise-write' ocupata.
    io.runExclusive('fise-write', () => new Promise(() => {}))
    vi.useFakeTimers()
    const win = fakeWindow()
    lifecycle.attachWindow(win)
    lifecycle.guardWindowClose(win)
    win.close()
    await vi.advanceTimersByTimeAsync(14000)
    expect(win.destroyed).toBe(false)
    await vi.advanceTimersByTimeAsync(1500)
    expect(win.destroyed).toBe(true)
  })
})
