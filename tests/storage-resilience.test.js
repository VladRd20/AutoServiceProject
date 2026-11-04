import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withRetry } from '../src/main/store/io.js'
import { fisa, ls, makeEnv, mkTmp, read } from './helpers'

const err = (code) => Object.assign(new Error(code), { code })

describe('withRetry: buget de reincercare', () => {
  afterEach(() => vi.restoreAllMocks())

  it('backoff exponential cu jitter: bugetul total implicit e ~3-5s, calea fericita nu asteapta', async () => {
    const delays = []
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms) => {
      delays.push(ms)
      fn()
      return 0
    })
    let calls = 0
    await expect(
      withRetry(() => {
        calls++
        throw err('EBUSY')
      })
    ).rejects.toMatchObject({ code: 'EBUSY' })
    const total = delays.reduce((a, b) => a + b, 0)
    expect(calls).toBe(8)
    expect(total).toBeGreaterThan(2500)
    expect(total).toBeLessThan(5000)
    // crescator pana la plafon
    expect(delays[1]).toBeGreaterThan(delays[0] * 0.9)

    delays.length = 0
    expect(await withRetry(() => 'ok')).toBe('ok')
    expect(delays).toEqual([])
  })

  it('EPERM/EACCES/EMFILE sunt reincercate, ENOENT/ENOSPC nu', async () => {
    for (const code of ['EPERM', 'EACCES', 'EMFILE']) {
      let calls = 0
      const r = await withRetry(
        () => {
          if (++calls < 2) throw err(code)
          return 'ok'
        },
        4,
        { baseMs: 1, maxMs: 2 }
      )
      expect(r).toBe('ok')
    }
    let calls = 0
    await expect(withRetry(() => (calls++, Promise.reject(err('ENOENT'))))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(calls).toBe(1)
  })
})

describe('copii de conflict si nr duplicate', () => {
  let env
  beforeEach(async () => {
    env = await makeEnv()
  })
  afterEach(() => env.cleanup())

  const put = (name, over = {}) => {
    const dir = path.join(env.dataDir, 'fise')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, name), JSON.stringify({ ...fisa(), status: 'finalizata', ...over }))
  }

  it('isConflictCopyName recunoaste tiparele OneDrive/Dropbox/Google, nu numele normale', () => {
    const { isConflictCopyName: is } = env.s.fise
    for (const n of [
      'C-AB-123_18-09-2026-DESKTOP-ABC123.json',
      'C-AB-123_18-09-2026 (1).json',
      'C-AB-123_18-09-2026-conflict-20260918.json',
      "C-AB-123_18-09-2026 (Ion's Conflicted Copy 2026-09-18).json"
    ]) {
      expect(is(n), n).toBe(true)
    }
    for (const n of ['C-AB-123_18-09-2026.json', 'C-AB-123_18-09-2026-2.json', 'FARA-NR_FARA-DATA.json']) {
      expect(is(n), n).toBe(false)
    }
  })

  it('getStoreWarnings raporteaza copiile si nr duplicate, fara sa stearga/ascunda nimic', async () => {
    put('A_18-09-2026.json', { nr: '2026-0001' })
    put('A_18-09-2026-DESKTOP-ABC123.json', { nr: '2026-0001' })
    put('B_18-09-2026.json', { nr: '2026-0002' })
    put('C_18-09-2026 (1).json', { nr: '2026-0003' })
    const w = await env.s.fise.getStoreWarnings()
    expect(w.conflictCopies).toEqual(['A_18-09-2026-DESKTOP-ABC123.json', 'C_18-09-2026 (1).json'])
    expect(w.duplicateNr).toEqual([{ nr: '2026-0001', files: ['A_18-09-2026-DESKTOP-ABC123.json', 'A_18-09-2026.json'] }])
    expect(ls(path.join(env.dataDir, 'fise'))).toHaveLength(4)
    expect(await env.s.fise.searchFise('', { from: '2000-01-01', to: '2100-01-01' })).toHaveLength(4)
  })

  it('fara probleme -> liste goale; se actualizeaza dupa o modificare', async () => {
    const a = await env.s.fise.finalizeFisa(fisa())
    expect(await env.s.fise.getStoreWarnings()).toEqual({ conflictCopies: [], duplicateNr: [] })
    put(`${a.baseName}-DESKTOP-XYZ789.json`, { nr: a.fisa.nr })
    await env.restart()
    const w = await env.s.fise.getStoreWarnings()
    expect(w.conflictCopies).toHaveLength(1)
    expect(w.duplicateNr[0].nr).toBe(a.fisa.nr)
  })
})

describe('re-proba folder de date dupa esecuri de scriere', () => {
  let env
  beforeEach(async () => {
    env = await makeEnv()
  })
  afterEach(() => env.cleanup())

  const waitFor = async (cond) => {
    for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 20))
  }

  it('dupa 3 esecuri consecutive cu folderul disparut trece pe folderul temporar, ca la pornire', async () => {
    const { paths, drafts } = env.s
    await paths.ensureDirs()
    expect(paths.isUsingFallbackLocation()).toBe(false)
    // "unitate scoasa": calea folderului de date devine un fisier -> mkdir/scriere esueaza
    fs.rmSync(env.dataDir, { recursive: true, force: true })
    fs.writeFileSync(env.dataDir, 'nu mai e folder')
    for (let i = 0; i < 3; i++) await expect(drafts.saveDraft(fisa())).rejects.toBeTruthy()
    await waitFor(() => paths.isUsingFallbackLocation())
    expect(paths.isUsingFallbackLocation()).toBe(true)
    expect(paths.getCurrentDataPath()).toBe(path.join(env.userData, 'date-temporar'))
    // acum scrierile reusesc in folderul temporar
    await expect(drafts.saveDraft(fisa())).resolves.toBeTruthy()
  })

  it('un esec izolat sau un folder care raspunde din nou NU declanseaza fallback', async () => {
    const { paths, drafts } = env.s
    await paths.ensureDirs()
    // folderul de drafturi dispare, dar se poate recrea (mkdir recursiv) -> proba reuseste
    fs.rmSync(path.join(env.dataDir, 'drafturi'), { recursive: true, force: true })
    for (let i = 0; i < 3; i++) await drafts.saveDraft(fisa()).catch(() => {})
    await paths.reprobeDataDir()
    expect(paths.isUsingFallbackLocation()).toBe(false)
  })

  it('o scriere reusita reseteaza contorul de esecuri consecutive', async () => {
    const { paths, drafts } = env.s
    await paths.ensureDirs()
    const dd = path.join(env.dataDir, 'drafturi')
    for (let round = 0; round < 3; round++) {
      fs.rmSync(dd, { recursive: true, force: true })
      fs.writeFileSync(dd, 'x')
      await expect(drafts.saveDraft(fisa())).rejects.toBeTruthy()
      await expect(drafts.saveDraft(fisa())).rejects.toBeTruthy()
      fs.rmSync(dd, { force: true })
      fs.mkdirSync(dd)
      await drafts.saveDraft(fisa())
    }
    await new Promise((r) => setTimeout(r, 100))
    expect(paths.isUsingFallbackLocation()).toBe(false)
  })
})

describe('snapshot streaming', () => {
  let env
  beforeEach(async () => {
    env = await makeEnv()
  })
  afterEach(() => env.cleanup())

  it('snapshot-ul are forma veche (aceleasi chei) si e importabil de importBackup', async () => {
    const { fise, drafts, settings, backup } = env.s
    for (let i = 0; i < 120; i++) await fise.finalizeFisa(fisa({ auto: { ...fisa().auto, nrInmatriculare: `C AB ${i}` } }))
    await drafts.saveDraft(fisa({ observatii: 'draft' }))
    await settings.saveSettings({ numeService: 'Service X' })
    await backup.backupNow()
    const snapDir = path.join(env.safety, 'snapshots')
    const snap = path.join(snapDir, ls(snapDir).find((f) => f.startsWith('snapshot-')))
    const raw = fs.readFileSync(snap, 'utf-8')
    expect(raw).not.toMatch(/\n {2}"/) // compact, fara indentare
    const b = JSON.parse(raw)
    expect(Object.keys(b)).toEqual(['format', 'version', 'createdAt', 'fise', 'drafturi', 'setari'])
    expect(b.format).toBe('service-auto-backup')
    expect(b.version).toBe(1)
    expect(Object.keys(b.fise)).toHaveLength(120)
    expect(Object.keys(b.drafturi)).toHaveLength(1)
    expect(b.setari.numeService).toBe('Service X')
    expect(ls(snapDir).some((f) => f.includes('.tmp-'))).toBe(false)

    // import intr-o instalare goala
    const other = await makeEnv()
    try {
      const r = await other.s.backup.importBackup(snap)
      expect(r.fiseRestaurate).toBe(120)
      expect(r.drafturiRestaurate).toBe(1)
      expect(r.setariRestaurate).toBe(true)
    } finally {
      other.cleanup()
      await env.restart()
    }
  })

  it('exportBackup (streaming) numara corect si ramane importabil; un snapshot in format VECHI (indentat) tot se importa', async () => {
    const { fise, backup } = env.s
    await fise.finalizeFisa(fisa())
    await fise.finalizeFisa(fisa({ auto: { ...fisa().auto, nrInmatriculare: 'B XY 999' } }))
    const tmp = mkTmp('sa-exp-')
    const out = path.join(tmp, 'b.json')
    const ex = await backup.exportBackup(out)
    expect(ex).toMatchObject({ fise: 2, drafturi: 0 })
    const b = read(out)

    // aceeasi continut in formatul vechi: JSON.stringify(bundle, null, 2)
    const legacy = path.join(tmp, 'legacy.json')
    fs.writeFileSync(legacy, JSON.stringify(b, null, 2))
    // makeEnv muta variabilele de mediu globale: instalatiile se folosesc pe rand
    let r1, r2
    const e1 = await makeEnv()
    try {
      r1 = await e1.s.backup.importBackup(out)
    } finally {
      e1.cleanup()
    }
    const e2 = await makeEnv()
    try {
      r2 = await e2.s.backup.importBackup(legacy)
      expect(r1).toEqual(r2)
      expect(r1.fiseRestaurate).toBe(2)
    } finally {
      e2.cleanup()
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('la inchidere nu se refac snapshot-ul daca unul are < 10 minute', async () => {
    const { fise, backup } = env.s
    await fise.finalizeFisa(fisa())
    await backup.backupNow()
    const snapDir = path.join(env.safety, 'snapshots')
    const snap = path.join(snapDir, ls(snapDir).find((f) => f.startsWith('snapshot-')))
    const before = fs.statSync(snap).mtimeMs
    await env.restart() // sesiune noua: lastSnapshotAt = 0, dar fisierul e recent
    await env.s.fise.finalizeFisa(fisa({ auto: { ...fisa().auto, nrInmatriculare: 'B ZZ 1' } }))
    await new Promise((r) => setTimeout(r, 30))
    await env.s.backup.flushBackup()
    expect(fs.statSync(snap).mtimeMs).toBe(before)
    // backup-ul normal (nu la inchidere) il actualizeaza (comportament existent)
    await env.s.backup.backupNow()
  })
})
