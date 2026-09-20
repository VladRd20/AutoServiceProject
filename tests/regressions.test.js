import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fisa, ls, makeEnv, mkTmp, read } from './helpers'

// Regresii gasite in trecerile de review adversarial.
let env
beforeEach(async () => {
  env = await makeEnv()
})
afterEach(() => {
  vi.useRealTimers()
  env.cleanup()
})
const fiseDir = () => path.join(env.dataDir, 'fise')

describe('citire tranzitorie != corupere', () => {
  it('EBUSY persistent la citire NU pune fisierul in carantina si nu-l inlocuieste cu backup-ul', async () => {
    const { fise, backup } = env.s
    const a = await fise.finalizeFisa(fisa({ observatii: 'v1' }))
    await backup.backupNow()
    await fise.finalizeFisa(fisa({ observatii: 'v2 - mai noua si mai lunga' }), { replaceBaseName: a.baseName })
    const target = path.join(fiseDir(), `${a.baseName}.json`)
    const s2 = await env.restart()
    const realRead = (await import('fs/promises')).default.readFile
    const spy = vi
      .spyOn((await import('fs/promises')).default, 'readFile')
      .mockImplementation((p, ...rest) =>
        String(p) === target ? Promise.reject(Object.assign(new Error('busy'), { code: 'EBUSY' })) : realRead(p, ...rest)
      )
    await s2.fise.listRecentFise().catch(() => {})
    spy.mockRestore()
    // fisierul viu ramane neatins (v2), nimic in corupte/
    expect(read(target).observatii).toContain('v2')
    expect(ls(path.join(env.dataDir, 'corupte'))).toEqual([])
  })
})

describe('editare / numerotare', () => {
  it('editarea unei fise ORIGINALE coruptE (fara backup) e oprita, nu renumeroteaza', async () => {
    const { fise } = env.s
    const a = await fise.finalizeFisa(fisa())
    fs.rmSync(path.join(env.safety, 'fise'), { recursive: true, force: true })
    fs.rmSync(path.join(env.dataDir, 'backup'), { recursive: true, force: true })
    fs.writeFileSync(path.join(fiseDir(), `${a.baseName}.json`), '{corupt')
    await expect(fise.finalizeFisa(fisa(), { replaceBaseName: a.baseName })).rejects.toMatchObject({ code: 'CORRUPT' })
    expect(ls(fiseDir()).filter((f) => f.endsWith('.json'))).toEqual([]) // originalul e in corupte/, nimic nou scris
  })
})

describe('import backup nu readuce fise sterse/redenumite', () => {
  it('fisa din trash si fisa cu nr deja folosit nu se readuc', async () => {
    const { fise, backup } = env.s
    const a = await fise.finalizeFisa(fisa())
    const b = await fise.finalizeFisa(fisa({ auto: { ...fisa().auto, nrInmatriculare: 'B 2' } }))
    const out = path.join(mkTmp('exp-'), 'b.json')
    await backup.exportBackup(out)
    await fise.deleteFinalizedFisa(a.baseName) // in trash
    // b redenumit prin editare: numele vechi dispare, nr ramane
    const b2 = await fise.finalizeFisa(fisa({ auto: { ...fisa().auto, nrInmatriculare: 'NOU 2' } }), {
      replaceBaseName: b.baseName
    })
    const r = await backup.importBackup(out)
    expect(r.fiseInCos).toBe(1)
    expect(r.fiseRestaurate).toBe(0)
    expect(r.conflicte).toBeGreaterThanOrEqual(1)
    expect(ls(fiseDir()).filter((f) => f.endsWith('.json'))).toEqual([`${b2.baseName}.json`])
  })
})

describe('schimbare folder de date', () => {
  it('cale relativa e refuzata', async () => {
    await expect(env.s.paths.changeDataPath('relativ/folder')).rejects.toMatchObject({ code: 'INVALID_PATH' })
  })

  it('folder tinta cu o versiune VECHE a aceleiasi fise: cea mai noua castiga', async () => {
    const { fise, paths } = env.s
    const a = await fise.finalizeFisa(fisa({ observatii: 'veche' }))
    const dest = path.join(mkTmp('t-'), 'date')
    await paths.changeDataPath(dest)
    // "editam" in noul folder o versiune mai NOUA, apoi revenim la cel vechi (implicit)
    await fise.finalizeFisa(fisa({ observatii: 'noua, editata dupa mutare' }), { replaceBaseName: a.baseName })
    await paths.changeDataPath(env.dataDir)
    expect(read(path.join(fiseDir(), `${a.baseName}.json`)).observatii).toBe('noua, editata dupa mutare')
  })

  it('o finalizare aflata in curs se termina INAINTE ca folderul sa se schimbe (fara scrieri pe jumatate)', async () => {
    const { fise, paths } = env.s
    const dest = path.join(mkTmp('t-'), 'date')
    const [r] = await Promise.all([fise.finalizeFisa(fisa()), paths.changeDataPath(dest)])
    expect(ls(path.join(dest, 'fise'))).toContain(`${r.baseName}.json`)
  })
})

describe('backup', () => {
  it('oglinda de drafturi se curata la ultimul draft finalizat (daca exista fise), fara sa reapara', async () => {
    const { drafts, fise, backup } = env.s
    const id = await drafts.saveDraft(fisa())
    await backup.backupNow()
    expect(ls(path.join(env.safety, 'drafturi'))).toHaveLength(1)
    await fise.finalizeFisa(fisa({ id }))
    await backup.backupNow()
    expect(ls(path.join(env.safety, 'drafturi'))).toEqual([])
  })

  it('contorul se copiaza in backup si se restaureaza', async () => {
    const { fise, backup } = env.s
    await fise.finalizeFisa(fisa())
    await backup.backupNow()
    expect(ls(env.safety)).toContain('contor.json')
    fs.rmSync(env.dataDir, { recursive: true, force: true })
    const s2 = await env.restart()
    await s2.paths.ensureDirs()
    expect(ls(env.dataDir)).toContain('contor.json')
  })
})

describe('id-uri', () => {
  it('nume rezervate Windows sunt respinse', async () => {
    for (const id of ['con', 'NUL', 'com1', 'LPT9', 'aux']) {
      await expect(env.s.drafts.saveDraft(fisa({ id }))).rejects.toMatchObject({ code: 'INVALID_ID' })
    }
    await expect(env.s.drafts.saveDraft(fisa({ id: 'draft-console' }))).resolves.toBe('draft-console')
  })
})

describe('garda de inchidere', () => {
  it('dupa "Raman" (inchidere oprita de beforeunload) garda functioneaza si la urmatoarea inchidere', async () => {
    const lifecycle = await import('../src/main/lifecycle.js')
    const win = new EventEmitter()
    win.isDestroyed = () => false
    const sent = []
    win.webContents = {
      isDestroyed: () => false,
      isCrashed: () => false,
      send: (_c, id) => {
        sent.push(id)
        setTimeout(() => lifecycle.handleFlushDone(id), 1)
      }
    }
    // close() intoarce daca a fost impiedicata de garda; a doua inchidere (dupa flush) o "opreste" utilizatorul
    win.close = vi.fn(() => win.emit('close', { preventDefault() {} }))
    lifecycle.attachWindow(win)
    lifecycle.guardWindowClose(win)
    win.close()
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 300)) // flush + backup final
    win.close()
    await vi.waitFor(() => expect(sent).toHaveLength(2))
  })
})

describe('e2e regresii', () => {
  it('editarea unei fise cu "Data curenta" NU o re-dateaza (nume si data raman)', async () => {
    const { fise } = env.s
    const a = await fise.finalizeFisa(fisa({ dataCurenta: true, data: '' }))
    const orig = read(path.join(fiseDir(), `${a.baseName}.json`))
    // fisa "veche": numele fisierului deriva din data ei
    fs.unlinkSync(path.join(fiseDir(), `${a.baseName}.json`))
    const oldName = 'C-AB-123_05-01-2026'
    fs.writeFileSync(path.join(fiseDir(), `${oldName}.json`), JSON.stringify({ ...orig, data: '2026-01-05T10:00:00' }))
    const s2 = await env.restart()
    const b = await s2.fise.finalizeFisa(fisa({ dataCurenta: true, observatii: 'x' }), { replaceBaseName: oldName })
    expect(b.baseName).toBe(oldName)
    expect(read(path.join(fiseDir(), `${oldName}.json`)).data).toBe('2026-01-05T10:00:00')
  })

  it('diacriticele din nr. inmatriculare se pliaza in numele fisierului', async () => {
    const r = await env.s.fise.finalizeFisa(fisa({ auto: { ...fisa().auto, nrInmatriculare: 'ȘT-12-ȚĂ' } }))
    expect(r.baseName.startsWith('ST-12-TA_')).toBe(true)
  })
})
