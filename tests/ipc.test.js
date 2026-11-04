import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { makeEnv, fisa } from './helpers.js'

// Starea licentei controlabila din test.
const lic = vi.hoisted(() => ({ activated: true, revoked: false }))
vi.mock('../src/main/license', () => ({
  isActivated: () => lic.activated,
  isRevoked: () => lic.revoked,
  activate: vi.fn(async () => ({ plan: 'test' }))
}))
vi.mock('../src/main/pdfGenerator', () => ({ generatePdf: vi.fn(async () => {}), printPdf: vi.fn() }))
vi.mock('../src/main/updater', () => ({
  checkForUpdatesSafe: vi.fn(),
  downloadUpdateNow: vi.fn(),
  installUpdateNow: vi.fn(),
  isAutoUpdateEnabled: () => false,
  setAutoUpdateEnabled: vi.fn()
}))
vi.mock('../src/main/lifecycle', () => ({ handleFlushDone: vi.fn(), flushEverything: vi.fn() }))
vi.mock('../src/main/appConfig', async (orig) => ({ ...(await orig()), getLastSeenVersion: () => null, setLastSeenVersion: vi.fn() }))

let env
let handlers

// Apeleaza un handler inregistrat ca si cum ar veni din renderer.
const call = (channel, ...args) => handlers.get(channel)({}, ...args)

beforeEach(async () => {
  lic.activated = true
  lic.revoked = false
  env = await makeEnv()
  handlers = new Map()
  const { ipcMain } = await import('electron')
  vi.spyOn(ipcMain, 'handle').mockImplementation((ch, fn) => handlers.set(ch, fn))
  vi.spyOn(ipcMain, 'on').mockImplementation(() => {})
  const { registerIpcHandlers } = await import('../src/main/ipc.js')
  registerIpcHandlers()
})

afterEach(() => {
  vi.restoreAllMocks()
  env.cleanup()
})

describe('ipc: poarta de licenta (wrapLicensed)', () => {
  it('blocheaza apelurile cand aplicatia nu e activata', async () => {
    lic.activated = false
    for (const [ch, arg] of [
      ['fisa:saveDraft', fisa()],
      ['fisa:listDrafts'],
      ['settings:get'],
      ['store:getWarnings'],
      ['fisa:deleteDraft', 'x']
    ]) {
      const res = await call(ch, arg)
      expect(res.ok).toBe(false)
      expect(res.error.code).toBe('NOT_LICENSED')
    }
  })

  it('license:getStatus nu e gardat si raporteaza starea', async () => {
    lic.activated = false
    expect((await call('license:getStatus')).data).toEqual({ activated: false, revoked: false, readOnly: false })
    lic.activated = true
    lic.revoked = true
    expect((await call('license:getStatus')).data).toEqual({ activated: false, revoked: true, readOnly: true })
  })

  it('activat: operatiile merg', async () => {
    const saved = await call('fisa:saveDraft', fisa())
    expect(saved.ok).toBe(true)
    const loaded = await call('fisa:loadDraft', saved.data)
    expect(loaded.ok).toBe(true)
  })
})

describe('ipc: mod doar-citire (licenta revocata)', () => {
  it('scrierile sunt refuzate cu REVOKED', async () => {
    const saved = await call('fisa:saveDraft', fisa())
    lic.revoked = true
    for (const [ch, arg] of [
      ['fisa:saveDraft', fisa()],
      ['fisa:deleteDraft', saved.data],
      ['settings:save', {}],
      ['trash:restore', 'x']
    ]) {
      const res = await call(ch, arg)
      expect(res.ok).toBe(false)
      expect(res.error.code).toBe('REVOKED')
    }
  })

  it('citirile (readOnlyOk) raman disponibile', async () => {
    const saved = await call('fisa:saveDraft', fisa())
    lic.revoked = true
    expect((await call('fisa:loadDraft', saved.data)).ok).toBe(true)
    expect((await call('fisa:listDrafts')).ok).toBe(true)
    expect((await call('settings:get')).ok).toBe(true)
    expect((await call('trash:list')).ok).toBe(true)
    const w = await call('store:getWarnings')
    expect(w.ok).toBe(true)
    expect(w.data).toEqual({ conflictCopies: [], duplicateNr: [] })
  })

  it('daca nu e activata, nici citirile nu merg (NOT_LICENSED primeaza)', async () => {
    lic.activated = false
    lic.revoked = true
    expect((await call('fisa:listDrafts')).error.code).toBe('NOT_LICENSED')
  })
})

describe('ipc: wrap() - maparea erorilor', () => {
  it('intoarce {ok:false, error:{code,message}} serializabil, fara exceptii brute', async () => {
    const res = await call('fisa:loadDraft', 'draft-inexistent')
    expect(res.ok).toBe(false)
    expect(typeof res.error.code).toBe('string')
    expect(typeof res.error.message).toBe('string')
    expect(() => structuredClone(res)).not.toThrow()
  })

  it('finalize cu fisa invalida -> VALIDATION', async () => {
    const res = await call('fisa:finalize', { client: {}, auto: {} })
    expect(res.ok).toBe(false)
    expect(res.error.code).toBe('VALIDATION')
  })

  it('succes -> {ok:true, data}', async () => {
    const res = await call('app:getVersion')
    expect(res).toEqual({ ok: true, data: '0.0.0-test' })
  })
})

describe('ipc: assertSafeId (path traversal)', () => {
  const bad = ['../x', '..\\x', '../../etc/passwd', 'C:\\Windows\\win.ini', '/etc/passwd', 'a/b', 'con', '']

  it.each(bad)('loadDraft respinge id-ul %j', async (id) => {
    const res = await call('fisa:loadDraft', id)
    expect(res.ok).toBe(false)
    expect(res.error.code).toBe('INVALID_ID')
  })

  it.each(['../x', '/abs/path', 'C:\\x'])('deleteDraft respinge %j', async (id) => {
    const res = await call('fisa:deleteDraft', id)
    expect(res.ok).toBe(false)
    expect(res.error.code).toBe('INVALID_ID')
  })

  it('saveDraft respinge un id traversal din fisa', async () => {
    const res = await call('fisa:saveDraft', fisa({ id: '../evil' }))
    expect(res.ok).toBe(false)
    expect(res.error.code).toBe('INVALID_ID')
  })

  it('un id valid trece de verificare', async () => {
    const res = await call('fisa:loadDraft', 'draft-123-abcd')
    expect(res.error?.code).not.toBe('INVALID_ID')
  })
})
