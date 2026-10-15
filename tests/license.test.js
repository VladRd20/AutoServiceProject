import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `https.get` real ar face un apel de retea real - il inlocuim cu un control
// manual al raspunsului (status/stream/eroare), per test.
let impl = null
vi.mock('https', () => {
  const get = (...args) => impl(...args)
  return { default: { get }, get }
})

class FakeRequest extends EventEmitter {
  destroy(err) {
    if (err) this.emit('error', err)
  }
}
class FakeResponse extends EventEmitter {
  constructor(statusCode) {
    super()
    this.statusCode = statusCode
  }
  resume() {}
}

let fetchRevokedList
beforeEach(async () => {
  vi.resetModules()
  impl = null
  ;({ fetchRevokedList } = await import('../src/main/license.js'))
})
afterEach(() => {
  impl = null
})

describe('fetchRevokedList', () => {
  it('rezolva cu lista de id-uri pentru un raspuns normal, mic', async () => {
    impl = (_url, _opts, cb) => {
      const req = new FakeRequest()
      const res = new FakeResponse(200)
      process.nextTick(() => {
        cb(res)
        res.emit('data', Buffer.from('["abc123", "def456"]'))
        res.emit('end')
      })
      return req
    }
    await expect(fetchRevokedList()).resolves.toEqual(['abc123', 'def456'])
  })

  it('respinge (nu agata promisiunea) cand raspunsul trece de limita de 1MB', async () => {
    impl = (_url, _opts, cb) => {
      const req = new FakeRequest()
      const res = new FakeResponse(200)
      process.nextTick(() => {
        cb(res)
        // Un singur chunk de >1MB - garda trebuie sa prinda si primul chunk.
        res.emit('data', Buffer.alloc(1024 * 1024 + 1, 'a'))
      })
      return req
    }
    await expect(fetchRevokedList()).rejects.toThrow(/mare/)
  })

  it('respinge pe status HTTP != 200, fara sa consume raspunsul ca JSON', async () => {
    impl = (_url, _opts, cb) => {
      const req = new FakeRequest()
      const res = new FakeResponse(404)
      process.nextTick(() => cb(res))
      return req
    }
    await expect(fetchRevokedList()).rejects.toThrow(/404/)
  })

  it('respinge pe timeout fara sa agate promisiunea', async () => {
    impl = () => {
      const req = new FakeRequest()
      process.nextTick(() => req.emit('timeout'))
      return req
    }
    await expect(fetchRevokedList()).rejects.toThrow(/timeout/)
  })

  it('respinge pe JSON invalid in raspuns', async () => {
    impl = (_url, _opts, cb) => {
      const req = new FakeRequest()
      const res = new FakeResponse(200)
      process.nextTick(() => {
        cb(res)
        res.emit('data', Buffer.from('nu-e-json'))
        res.emit('end')
      })
      return req
    }
    await expect(fetchRevokedList()).rejects.toBeTruthy()
  })
})
