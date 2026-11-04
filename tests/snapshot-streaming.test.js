import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fisa, ls, makeEnv, mkTmp, read } from './helpers'

// Separat de storage-resilience.test.js ca sa ruleze in paralel cu restul (e testul cel mai lent).
describe('snapshot streaming', () => {
  let env
  beforeEach(async () => {
    env = await makeEnv()
  })
  afterEach(() => env.cleanup())

  it('snapshot-ul are forma veche (aceleasi chei) si e importabil de importBackup', async () => {
    const { fise, drafts, settings, backup } = env.s
    // Finalizari in paralel (coada interna le serializeaza): setup-ul dureaza mult mai putin.
    await Promise.all(
      Array.from({ length: 120 }, (_, i) =>
        fise.finalizeFisa(fisa({ auto: { ...fisa().auto, nrInmatriculare: `C AB ${i}` } }))
      )
    )
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
