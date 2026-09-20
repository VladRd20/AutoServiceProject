import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutosaver, sameExceptId } from '../src/renderer/src/autosave'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const doc = (over = {}) => ({ id: null, client: { nume: '' }, piese: [], ...over })

// save controlabil: fiecare apel e un deferred pe care il rezolvam manual
function makeSaver(opts = {}) {
  const calls = []
  let active = 0
  let maxActive = 0
  let nextId = 1
  const save = vi.fn((payload) => {
    calls.push(payload)
    active++
    maxActive = Math.max(maxActive, active)
    return new Promise((resolve) => {
      const finish = (res) => {
        active--
        resolve(res)
      }
      if (opts.manual) calls[calls.length - 1]._finish = finish
      else finish(opts.result ? opts.result(payload) : { ok: true, data: payload.id || `d${nextId++}` })
    })
  })
  const states = []
  const ids = []
  const a = createAutosaver({
    save,
    delayMs: 1000,
    retryMs: 5000,
    onState: (s) => states.push(s.state),
    onId: (id) => ids.push(id)
  })
  return { a, save, calls, states, ids, maxActive: () => maxActive }
}

describe('sameExceptId', () => {
  it('ignora doar id-ul; referinte diferite = diferit', () => {
    const c = { nume: 'x' }
    expect(sameExceptId({ id: null, c }, { id: 'a', c })).toBe(true)
    expect(sameExceptId({ id: 'a', c }, { id: 'a', c: { nume: 'x' } })).toBe(false)
    expect(sameExceptId(null, { id: 1 })).toBe(false)
    expect(sameExceptId({ id: 1, x: 1 }, { id: 1 })).toBe(false)
  })
})

describe('autosaver', () => {
  it('debounce: tastare rapida => o singura salvare, cu ultima versiune', async () => {
    const { a, save } = makeSaver()
    a.reset(doc({ id: 'x' }), { clean: true })
    a.update(doc({ id: 'x', v: 1 }))
    await vi.advanceTimersByTimeAsync(500)
    a.update(doc({ id: 'x', v: 2 }))
    await vi.advanceTimersByTimeAsync(500)
    a.update(doc({ id: 'x', v: 3 }))
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].v).toBe(3)
  })

  it('prima salvare a unei fise noi e imediata; id-ul returnat e folosit la urmatoarele', async () => {
    const { a, calls, ids } = makeSaver()
    a.reset(doc())
    const d0 = doc()
    a.update(d0)
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(1)
    expect(ids).toEqual(['d1'])
    // UI-ul aplica id-ul (echo): nu trebuie sa produca o a doua salvare
    a.update({ ...d0, id: 'd1' })
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls).toHaveLength(1)
    // o modificare reala pastreaza id-ul
    a.update({ ...d0, id: 'd1', client: { nume: 'Ion' } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toHaveLength(2)
    expect(calls[1].id).toBe('d1')
  })

  it('doua salvari inainte ca prima sa primeasca id NU creeaza doua drafturi', async () => {
    const { a, calls, maxActive } = makeSaver({ manual: true })
    a.reset(doc())
    a.update(doc({ v: 1 }))
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(1)
    a.update(doc({ v: 2 })) // inca fara id (prima salvare nu a raspuns)
    const flushing = a.flush() // serializat dupa prima
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(1) // a doua asteapta
    calls[0]._finish({ ok: true, data: 'draft-1' })
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(2)
    expect(calls[1].id).toBe('draft-1')
    calls[1]._finish({ ok: true, data: 'draft-1' })
    expect(await flushing).toBe(true)
    expect(maxActive()).toBe(1)
  })

  it('flush() salveaza imediat ce e programat si asteapta salvarea in curs', async () => {
    const { a, calls } = makeSaver({ manual: true })
    a.reset(doc({ id: 'x' }), { clean: true })
    a.update(doc({ id: 'x', v: 1 }))
    const p = a.flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(1)
    let done = false
    p.then(() => (done = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(false) // inca in curs
    calls[0]._finish({ ok: true, data: 'x' })
    expect(await p).toBe(true)
    expect(a.isDirty()).toBe(false)
    // timerul vechi de 1s nu mai declanseaza o salvare in plus
    await vi.advanceTimersByTimeAsync(3000)
    expect(calls).toHaveLength(1)
  })

  it('flush() cu nimic de salvat = true, fara apel de save', async () => {
    const { a, save } = makeSaver()
    a.reset(doc({ id: 'x' }), { clean: true })
    expect(await a.flush()).toBe(true)
    expect(save).not.toHaveBeenCalled()
  })

  it('COMUTARE fara flush pierde ultima modificare; cu flush o pastreaza (motivul flush-ului)', async () => {
    const { a, calls } = makeSaver()
    a.reset(doc({ id: 'A' }), { clean: true })
    a.update(doc({ id: 'A', v: 'ultima-tastare' }))
    await a.flush()
    a.reset(doc({ id: 'B' }), { clean: true })
    expect(calls.map((c) => c.v)).toEqual(['ultima-tastare'])

    const s2 = makeSaver()
    s2.a.reset(doc({ id: 'A' }), { clean: true })
    s2.a.update(doc({ id: 'A', v: 'pierdut' }))
    s2.a.reset(doc({ id: 'B' }), { clean: true }) // fara flush
    await vi.advanceTimersByTimeAsync(5000)
    expect(s2.calls).toHaveLength(0)
  })

  it('reset in timpul unei salvari: rezultatul vechi nu atinge documentul nou', async () => {
    const { a, calls, ids, states } = makeSaver({ manual: true })
    a.reset(doc())
    a.update(doc({ v: 1 }))
    await vi.advanceTimersByTimeAsync(0)
    a.reset(doc({ id: 'B' }), { clean: true })
    const before = states.length
    calls[0]._finish({ ok: true, data: 'draft-vechi' })
    await vi.advanceTimersByTimeAsync(0)
    expect(ids).toEqual([]) // id-ul vechi NU e "lipit" pe fisa noua
    expect(a.getId()).toBe('B')
    expect(states.length).toBe(before)
    expect(a.getState().state).toBe('saved')
  })

  it('esec: stare error, reincercare automata la 5s, apoi saved', async () => {
    let fail = true
    const { a, save, states } = makeSaver({ result: (p) => (fail ? { ok: false, error: { message: 'disc plin' } } : { ok: true, data: p.id }) })
    a.reset(doc({ id: 'x' }), { clean: true })
    a.update(doc({ id: 'x', v: 1 }))
    await vi.advanceTimersByTimeAsync(1000)
    expect(a.getState().state).toBe('error')
    expect(a.getState().error.message).toBe('disc plin')
    expect(a.isDirty()).toBe(true)
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).toHaveBeenCalledTimes(2)
    fail = false
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).toHaveBeenCalledTimes(3)
    expect(a.getState().state).toBe('saved')
    expect(states.filter((s) => s === 'error').length).toBeGreaterThanOrEqual(2)
    // dupa succes nu mai reincearca
    await vi.advanceTimersByTimeAsync(20000)
    expect(save).toHaveBeenCalledTimes(3)
  })

  it('save care ARUNCA exceptie e tratat ca esec, nu lasa lantul blocat', async () => {
    let n = 0
    const save = vi.fn(async (p) => {
      if (n++ === 0) throw new Error('boom')
      return { ok: true, data: p.id }
    })
    const a = createAutosaver({ save, delayMs: 10, retryMs: 50 })
    a.reset(doc({ id: 'x' }), { clean: true })
    a.update(doc({ id: 'x', v: 1 }))
    expect(await a.flush()).toBe(false)
    expect(a.getState().state).toBe('error')
    expect(await a.flush()).toBe(true)
    expect(a.getState().state).toBe('saved')
  })

  it('flush cand discul refuza in continuare => false (inchiderea nu se blocheaza)', async () => {
    const { a } = makeSaver({ result: () => ({ ok: false, error: { message: 'x' } }) })
    a.reset(doc({ id: 'x' }), { clean: true })
    a.update(doc({ id: 'x', v: 1 }))
    expect(await a.flush()).toBe(false)
  })

  it('modificare in timpul unei salvari => se salveaza si ea (nimic pierdut)', async () => {
    const { a, calls } = makeSaver({ manual: true })
    a.reset(doc({ id: 'x' }), { clean: true })
    a.update(doc({ id: 'x', v: 1 }))
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toHaveLength(1)
    a.update(doc({ id: 'x', v: 2 })) // tastat cat timp se salveaza v1
    calls[0]._finish({ ok: true, data: 'x' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toHaveLength(2)
    expect(calls[1].v).toBe(2)
    calls[1]._finish({ ok: true, data: 'x' })
    await vi.advanceTimersByTimeAsync(0)
    expect(a.isDirty()).toBe(false)
  })

  it('dispose opreste orice salvare programata', async () => {
    const { a, save } = makeSaver()
    a.reset(doc({ id: 'x' }), { clean: true })
    a.update(doc({ id: 'x', v: 1 }))
    a.dispose()
    await vi.advanceTimersByTimeAsync(10000)
    expect(save).not.toHaveBeenCalled()
    a.update(doc({ id: 'x', v: 2 }))
    await vi.advanceTimersByTimeAsync(10000)
    expect(save).not.toHaveBeenCalled()
  })

  it('flush repetat de 10 ori in paralel: o singura salvare, serializat', async () => {
    const { a, save, maxActive } = makeSaver()
    a.reset(doc({ id: 'x' }), { clean: true })
    a.update(doc({ id: 'x', v: 1 }))
    const results = await Promise.all(Array.from({ length: 10 }, () => a.flush()))
    expect(results.every(Boolean)).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
    expect(maxActive()).toBe(1)
  })
})
