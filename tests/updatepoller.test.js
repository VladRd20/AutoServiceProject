import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createUpdatePoller } from '../src/main/updatePoller'

const MIN = 60 * 1000
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function make(over = {}) {
  const check = over.check || vi.fn(async () => true)
  let t = 0
  const poller = createUpdatePoller({
    now: () => t,
    random: () => 0.5, // jitter 0 => intervale exacte
    ...over,
    check
  })
  const advance = async (ms) => {
    t += ms
    await vi.advanceTimersByTimeAsync(ms)
  }
  return { poller, check, advance, clock: () => t }
}

describe('verificarea periodica a actualizarilor', () => {
  it('verifica la fiecare 10 minute', async () => {
    const { poller, check, advance } = make()
    poller.start({ initialCheckDone: true })
    await advance(9 * MIN)
    expect(check).not.toHaveBeenCalled()
    await advance(1 * MIN + 100)
    expect(check).toHaveBeenCalledTimes(1)
    await advance(10 * MIN)
    await advance(10 * MIN)
    expect(check).toHaveBeenCalledTimes(3)
  })

  it('jitterul ramane in +/- 1 minut si difera intre apeluri', async () => {
    for (const [rnd, expectMs] of [[0, 9 * MIN], [1, 11 * MIN]]) {
      const { poller, check, advance } = make({ random: () => rnd })
      poller.start()
      await advance(expectMs - 1000)
      expect(check).not.toHaveBeenCalled()
      await advance(2000)
      expect(check).toHaveBeenCalledTimes(1)
    }
  })

  it('la esec intervalul se dubleaza (max 1h); dupa un succes revine la 10 min', async () => {
    let ok = false
    const { poller, check, advance } = make({ check: vi.fn(async () => ok) })
    poller.start()
    await advance(10 * MIN + 10) // esec 1 -> urmatorul la 20 min
    expect(check).toHaveBeenCalledTimes(1)
    await advance(19 * MIN)
    expect(check).toHaveBeenCalledTimes(1)
    await advance(1 * MIN + 10) // esec 2 -> urmatorul la 40 min
    expect(check).toHaveBeenCalledTimes(2)
    ok = true
    await advance(40 * MIN + 10) // succes -> reset
    expect(check).toHaveBeenCalledTimes(3)
    expect(poller.state().failures).toBe(0)
    await advance(10 * MIN + 10)
    expect(check).toHaveBeenCalledTimes(4)
  })

  it('backoff plafonat la 1 ora, chiar dupa multe esecuri', async () => {
    const { poller, check, advance } = make({ check: vi.fn(async () => false) })
    poller.start()
    for (let i = 0; i < 6; i++) await advance(65 * MIN)
    const calls = check.mock.calls.length
    await advance(61 * MIN) // cel mult o ora pana la urmatoarea
    expect(check.mock.calls.length).toBeGreaterThan(calls)
    expect(poller.state().failures).toBeLessThanOrEqual(10)
  })

  it('exceptie din verificare = esec, planificatorul nu se opreste', async () => {
    let n = 0
    const { poller, check, advance } = make({ check: vi.fn(async () => { if (n++ === 0) throw new Error('boom'); return true }) })
    poller.start()
    await advance(10 * MIN + 10)
    expect(poller.state().failures).toBe(1)
    await advance(20 * MIN + 10)
    expect(check).toHaveBeenCalledTimes(2)
    expect(poller.state().failures).toBe(0)
  })

  it('pause() opreste tot (versiune noua gasita); resume() reia', async () => {
    const { poller, check, advance } = make()
    poller.start()
    poller.pause()
    await advance(60 * MIN)
    expect(check).not.toHaveBeenCalled()
    expect(poller.nudge()).toBe(false)
    poller.resume()
    await advance(10 * MIN + 10)
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('nudge (revenire pe fereastra): verifica doar daca ultima verificare e mai veche de 5 min', async () => {
    const { poller, check, advance } = make()
    poller.start({ initialCheckDone: true })
    await advance(2 * MIN)
    expect(poller.nudge()).toBe(false) // prea devreme
    await advance(4 * MIN)
    expect(poller.nudge()).toBe(true) // 6 min de la ultima verificare
    await advance(10)
    expect(check).toHaveBeenCalledTimes(1)
    expect(poller.nudge()).toBe(false) // tocmai s-a verificat
  })

  it('nu porneste doua verificari simultane (nudge in timpul unei verificari lente)', async () => {
    let release
    const check = vi.fn(() => new Promise((r) => (release = () => r(true))))
    const { poller, advance } = make({ check })
    poller.start()
    await advance(10 * MIN + 10)
    expect(check).toHaveBeenCalledTimes(1)
    expect(poller.state().running).toBe(true)
    expect(poller.nudge()).toBe(false)
    release()
    await advance(10)
    expect(poller.state().running).toBe(false)
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('pauza in timpul unei verificari in curs: nu se reprogrameaza', async () => {
    let release
    const check = vi.fn(() => new Promise((r) => (release = () => r(true))))
    const { poller, advance } = make({ check })
    poller.start()
    await advance(10 * MIN + 10)
    poller.pause()
    release()
    await advance(60 * MIN)
    expect(check).toHaveBeenCalledTimes(1)
    expect(poller.state().scheduled).toBe(false)
  })
})
