import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fisa, ls, makeEnv, read } from './helpers'

let env
beforeEach(async () => {
  env = await makeEnv()
})
afterEach(() => env.cleanup())

const fiseDir = () => path.join(env.dataDir, 'fise')
const jsons = (dir) => ls(dir).filter((f) => f.endsWith('.json'))

describe('finalizare', () => {
  it('scrie JSON, atribuie nr secvential si sterge draftul', async () => {
    const { drafts, fise } = env.s
    const id = await drafts.saveDraft(fisa())
    const r = await fise.finalizeFisa(fisa({ id }))
    expect(r.baseName).toBe('C-AB-123_18-09-2026')
    expect(r.fisa.nr).toMatch(/^\d{4}-0001$/)
    expect(read(path.join(fiseDir(), `${r.baseName}.json`)).status).toBe('finalizata')
    expect(ls(path.join(env.dataDir, 'drafturi'))).toEqual([])
    const r2 = await fise.finalizeFisa(fisa({ auto: { ...fisa().auto, nrInmatriculare: 'B 999 XYZ' } }))
    expect(r2.fisa.nr).toMatch(/-0002$/)
  })

  it('doua fise pentru aceeasi masina/zi nu se suprascriu (sufix)', async () => {
    const { fise } = env.s
    const a = await fise.finalizeFisa(fisa())
    const b = await fise.finalizeFisa(fisa({ observatii: 'a doua' }))
    expect(b.baseName).toBe(`${a.baseName}-2`)
    expect(jsons(fiseDir())).toHaveLength(2)
  })

  it('20 finalizari concurente: nume si numere unice, nimic pierdut', async () => {
    const { fise } = env.s
    const results = await Promise.all(Array.from({ length: 20 }, () => fise.finalizeFisa(fisa())))
    expect(new Set(results.map((r) => r.baseName)).size).toBe(20)
    expect(new Set(results.map((r) => r.fisa.nr)).size).toBe(20)
    expect(jsons(fiseDir())).toHaveLength(20)
  })

  it('nr furnizat de client e ignorat la o fisa noua', async () => {
    const r = await env.s.fise.finalizeFisa(fisa({ nr: '2026-9999' }))
    expect(r.fisa.nr).toMatch(/-0001$/)
  })

  it('editare: pastreaza nr, arhiveaza versiunea veche in 2 locuri', async () => {
    const { fise } = env.s
    const a = await fise.finalizeFisa(fisa())
    const b = await fise.finalizeFisa(fisa({ observatii: 'editat' }), { replaceBaseName: a.baseName })
    expect(b.baseName).toBe(a.baseName)
    expect(b.replaced).toBe(true)
    expect(b.fisa.nr).toBe(a.fisa.nr)
    const hist = [path.join(env.safety, 'history'), path.join(env.dataDir, 'backup', 'history')]
    for (const h of hist) {
      const f = ls(h).filter((x) => x.startsWith(a.baseName))
      expect(f).toHaveLength(1)
      expect(read(path.join(h, f[0])).observatii).toBe('')
    }
    expect(read(path.join(fiseDir(), `${a.baseName}.json`)).observatii).toBe('editat')
  })

  it('editare cu schimbare de nr. inmatriculare: fisa veche dispare (si din backup), cea noua exista', async () => {
    const { fise, backup } = env.s
    const a = await fise.finalizeFisa(fisa())
    await backup.backupNow()
    expect(ls(path.join(env.safety, 'fise'))).toContain(`${a.baseName}.json`)
    const b = await fise.finalizeFisa(fisa({ auto: { ...fisa().auto, nrInmatriculare: 'X 1 Y' } }), {
      replaceBaseName: a.baseName
    })
    expect(b.baseName).not.toBe(a.baseName)
    expect(fs.existsSync(path.join(fiseDir(), `${a.baseName}.json`))).toBe(false)
    expect(ls(path.join(env.safety, 'fise'))).not.toContain(`${a.baseName}.json`)
    expect(b.fisa.nr).toBe(a.fisa.nr)
    expect(ls(path.join(env.safety, 'history')).some((x) => x.startsWith(a.baseName))).toBe(true)
  })

  it('editare a unei fise sterse intre timp = fisa noua, fara eroare', async () => {
    const { fise } = env.s
    const a = await fise.finalizeFisa(fisa())
    await fise.deleteFinalizedFisa(a.baseName)
    const b = await fise.finalizeFisa(fisa(), { replaceBaseName: a.baseName })
    expect(b.replaced).toBe(false)
    expect(b.fisa.nr).not.toBe(a.fisa.nr)
  })

  it('replaceBaseName invalid (path traversal) e respins', async () => {
    await expect(env.s.fise.finalizeFisa(fisa(), { replaceBaseName: '../../evil' })).rejects.toMatchObject({
      code: 'INVALID_ID'
    })
  })

  it('esec la scriere (disc plin) nu lasa fisiere temporare, nu strica fisele existente, nu consuma numar', async () => {
    const { fise } = env.s
    const a = await fise.finalizeFisa(fisa())
    const io = await import('../src/main/store/io.js')
    let n = 0
    io.faults.beforeRename = (_from, to) => {
      if (to.includes('B-1_') && n++ === 0) throw Object.assign(new Error('full'), { code: 'ENOSPC' })
    }
    await expect(
      fise.finalizeFisa(fisa({ auto: { ...fisa().auto, nrInmatriculare: 'B 1' } }))
    ).rejects.toMatchObject({ code: 'ENOSPC' })
    io.faults.beforeRename = null
    expect(ls(fiseDir()).filter((f) => f.includes('.tmp-'))).toEqual([])
    expect(jsons(fiseDir())).toEqual([`${a.baseName}.json`])
    expect(read(path.join(fiseDir(), `${a.baseName}.json`)).status).toBe('finalizata')
    // reincercare dupa eliberarea spatiului: reuseste
    const b = await fise.finalizeFisa(fisa({ auto: { ...fisa().auto, nrInmatriculare: 'B 1' } }))
    expect(b.baseName).toBe('B-1_18-09-2026')
  })

  it('EPERM/EBUSY tranzitoriu (antivirus) la rename e reincercat automat', async () => {
    const { fise } = env.s
    const io = await import('../src/main/store/io.js')
    const codes = ['EBUSY', 'EPERM']
    io.faults.beforeRename = () => {
      const code = codes.shift()
      if (code) throw Object.assign(new Error(code), { code })
    }
    const r = await fise.finalizeFisa(fisa())
    io.faults.beforeRename = null
    expect(read(path.join(fiseDir(), `${r.baseName}.json`)).nr).toBe(r.fisa.nr)
  })
})

describe('stergere / trash', () => {
  it('sterge = muta in trash, iese din liste si din backup; restore o readuce', async () => {
    const { fise, backup } = env.s
    const a = await fise.finalizeFisa(fisa())
    await backup.backupNow()
    const { trashId } = await fise.deleteFinalizedFisa(a.baseName)
    expect(trashId).toMatch(new RegExp(`^${a.baseName}__\\d+$`))
    expect(await fise.listRecentFise()).toHaveLength(0)
    expect(ls(path.join(env.safety, 'fise'))).not.toContain(`${a.baseName}.json`)
    const trash = await fise.listTrash()
    expect(trash).toHaveLength(1)
    expect(trash[0].nr).toBe(a.fisa.nr)
    const { baseName } = await fise.restoreFromTrash(trashId)
    expect(baseName).toBe(a.baseName)
    expect((await fise.listRecentFise()).map((f) => f._file)).toEqual([`${a.baseName}.json`])
    expect(await fise.listTrash()).toHaveLength(0)
  })

  it('numarul unei fise sterse nu se refoloseste (nici dupa repornire)', async () => {
    const { fise } = env.s
    const a = await fise.finalizeFisa(fisa())
    await fise.deleteFinalizedFisa(a.baseName)
    const b = await fise.finalizeFisa(fisa())
    expect(b.fisa.nr).not.toBe(a.fisa.nr)
    const s2 = await env.restart()
    const c = await s2.fise.finalizeFisa(fisa({ auto: { ...fisa().auto, nrInmatriculare: 'Q 1' } }))
    expect(new Set([a.fisa.nr, b.fisa.nr, c.fisa.nr]).size).toBe(3)
  })

  it('restore cand numele e deja ocupat foloseste sufix, fara suprascriere', async () => {
    const { fise } = env.s
    const a = await fise.finalizeFisa(fisa({ observatii: 'prima' }))
    const { trashId } = await fise.deleteFinalizedFisa(a.baseName)
    const b = await fise.finalizeFisa(fisa({ observatii: 'noua' }))
    expect(b.baseName).toBe(a.baseName)
    const r = await fise.restoreFromTrash(trashId)
    expect(r.baseName).toBe(`${a.baseName}-2`)
    expect(read(path.join(fiseDir(), `${a.baseName}.json`)).observatii).toBe('noua')
    expect(read(path.join(fiseDir(), `${a.baseName}-2.json`)).observatii).toBe('prima')
  })

  it('stergere a unei fise inexistente / id invalid', async () => {
    const { fise } = env.s
    expect(await fise.deleteFinalizedFisa('nu-exista')).toEqual({ trashId: null })
    await expect(fise.deleteFinalizedFisa('../x')).rejects.toMatchObject({ code: 'INVALID_ID' })
    await expect(fise.restoreFromTrash('../x')).rejects.toMatchObject({ code: 'INVALID_ID' })
    await expect(fise.restoreFromTrash('nu-exista__1234567890123')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('trash-ul mai vechi de 30 de zile e curatat la pornire, cel recent ramane', async () => {
    const { fise } = env.s
    const a = await fise.finalizeFisa(fisa())
    const { trashId } = await fise.deleteFinalizedFisa(a.baseName)
    const trashDir = path.join(env.dataDir, 'trash')
    const old = `OLD-1__${Date.now() - 40 * 86400000}`
    fs.writeFileSync(path.join(trashDir, `${old}.json`), '{}')
    const s2 = await env.restart()
    await s2.paths.ensureDirs()
    expect(ls(trashDir)).toContain(`${trashId}.json`)
    expect(ls(trashDir)).not.toContain(`${old}.json`)
  })
})

describe('integritate', () => {
  it('fisa corupta e pusa in carantina si refacuta din backup', async () => {
    const { fise, backup } = env.s
    const a = await fise.finalizeFisa(fisa())
    await backup.backupNow()
    const p = path.join(fiseDir(), `${a.baseName}.json`)
    fs.writeFileSync(p, '{"client": {"nume": "trunch')
    const s2 = await env.restart()
    const list = await s2.fise.listRecentFise()
    expect(list).toHaveLength(1)
    expect(list[0].nr).toBe(a.fisa.nr)
    expect(read(p).status).toBe('finalizata')
    expect(ls(path.join(env.dataDir, 'corupte')).some((f) => f.endsWith('.bad'))).toBe(true)
    expect(s2.paths.state.quarantined).toEqual([{ name: `${a.baseName}.json`, restored: true }])
  })

  it('fisa corupta fara backup: sarita, pastrata in corupte/, raportata', async () => {
    const { fise } = env.s
    const a = await fise.finalizeFisa(fisa())
    const b = await fise.finalizeFisa(fisa({ auto: { ...fisa().auto, nrInmatriculare: 'Z 9' } }))
    fs.rmSync(path.join(env.safety, 'fise'), { recursive: true, force: true })
    fs.rmSync(path.join(env.dataDir, 'backup'), { recursive: true, force: true })
    fs.writeFileSync(path.join(fiseDir(), `${a.baseName}.json`), '   ')
    fs.writeFileSync(path.join(fiseDir(), `${b.baseName}.json`), 'garbage')
    const s2 = await env.restart()
    expect(await s2.fise.listRecentFise()).toHaveLength(0)
    expect(s2.paths.state.quarantined.every((q) => q.restored === false)).toBe(true)
    expect(ls(path.join(env.dataDir, 'corupte'))).toHaveLength(2)
  })

  it('un draft corupt nu blocheaza lista', async () => {
    const { drafts } = env.s
    const id = await drafts.saveDraft(fisa())
    fs.writeFileSync(path.join(env.dataDir, 'drafturi', 'draft-bad.json'), '{{{')
    const s2 = await env.restart()
    const list = await s2.drafts.listDrafts()
    expect(list.map((d) => d.id)).toEqual([id])
    await expect(s2.drafts.loadDraft('draft-inexistent')).rejects.toBeTruthy()
  })

  it('JSON valid dar de tip gresit (array / null) e tratat ca fisier corupt', async () => {
    await env.s.paths.ensureDirs()
    fs.writeFileSync(path.join(fiseDir(), 'A_1.json'), '[1,2,3]')
    fs.writeFileSync(path.join(fiseDir(), 'B_1.json'), 'null')
    const s2 = await env.restart()
    expect(await s2.fise.listRecentFise()).toEqual([])
  })

  it('fisier cu BOM UTF-8 se citeste normal', async () => {
    await env.s.paths.ensureDirs()
    fs.writeFileSync(path.join(fiseDir(), 'A_1.json'), '﻿' + JSON.stringify(fisa({ status: 'finalizata' })))
    const s2 = await env.restart()
    expect(await s2.fise.listRecentFise()).toHaveLength(1)
  })

  it('setari corupte se refac din backup; fara backup -> eroare, nu valori goale', async () => {
    const { settings, backup } = env.s
    await settings.saveSettings({ numeService: 'Auto SRL', adresa: 'Str 1', telefon: '1', cui: '2' })
    await backup.backupNow()
    fs.writeFileSync(path.join(env.dataDir, 'setari.json'), '{oops')
    const s2 = await env.restart()
    expect((await s2.settings.getSettings()).numeService).toBe('Auto SRL')
    fs.writeFileSync(path.join(env.dataDir, 'setari.json'), '{oops')
    fs.rmSync(env.safety, { recursive: true, force: true })
    fs.rmSync(path.join(env.dataDir, 'backup'), { recursive: true, force: true })
    const s3 = await env.restart()
    await expect(s3.settings.getSettings()).rejects.toMatchObject({ code: 'SETTINGS_CORRUPT' })
  })

  it('setari lipsa = implicite; campuri necunoscute/prea lungi sunt curatate', async () => {
    const { settings } = env.s
    expect(await settings.getSettings()).toEqual({ numeService: '', adresa: '', telefon: '', cui: '' })
    const saved = await settings.saveSettings({ numeService: 'x'.repeat(500), evil: 'y', telefon: 5 })
    expect(saved.numeService).toHaveLength(200)
    expect(saved.evil).toBeUndefined()
    expect(saved.telefon).toBe('')
  })

  it('.tmp- orfane si .json goale sunt curatate la pornire', async () => {
    await env.s.paths.ensureDirs()
    fs.writeFileSync(path.join(fiseDir(), 'X_1.json.tmp-1-2-3'), 'x')
    fs.writeFileSync(path.join(fiseDir(), 'GOL_1.json'), '')
    const s2 = await env.restart()
    await s2.paths.ensureDirs()
    expect(ls(fiseDir())).toEqual([])
  })
})

describe('drafturi', () => {
  it('50 salvari concurente pe acelasi id: castiga ULTIMA, in ordinea apelului', async () => {
    const { drafts } = env.s
    const id = await drafts.saveDraft(fisa())
    await Promise.all(Array.from({ length: 50 }, (_, i) => drafts.saveDraft(fisa({ id, observatii: `v${i}` }))))
    expect(read(path.join(env.dataDir, 'drafturi', `${id}.json`)).observatii).toBe('v49')
    expect((await drafts.listDrafts())[0].observatii).toBe('v49')
  })

  it('id de draft invalid e respins', async () => {
    await expect(env.s.drafts.saveDraft(fisa({ id: '../../x' }))).rejects.toMatchObject({ code: 'INVALID_ID' })
    await expect(env.s.drafts.deleteDraft('a/b')).rejects.toMatchObject({ code: 'INVALID_ID' })
    await expect(env.s.drafts.loadDraft('..')).rejects.toMatchObject({ code: 'INVALID_ID' })
  })

  it('stergerea unui draft inexistent nu da eroare', async () => {
    await expect(env.s.drafts.deleteDraft('draft-nu-exista')).resolves.toBeUndefined()
  })

  it('drafturile vechi (fara schemaVersion, cu reducerePercent) sunt migrate la citire', async () => {
    await env.s.paths.ensureDirs()
    fs.writeFileSync(
      path.join(env.dataDir, 'drafturi', 'draft-old.json'),
      JSON.stringify({ id: 'draft-old', client: {}, auto: {}, reducerePercent: 10, piese: [], lucrari: [] })
    )
    const s2 = await env.restart()
    const d = await s2.drafts.loadDraft('draft-old')
    expect(d.reducerePiesePercent).toBe(10)
    expect(d.reducereLucrariPercent).toBe(10)
    expect(d.reducerePercent).toBeUndefined()
    expect(d.schemaVersion).toBe(2)
  })
})

describe('cautare / rapoarte / autocomplete', () => {
  it('cauta fara diacritice, dupa nr fisa si dupa masina; istoric dupa VIN sau nr', async () => {
    const { fise } = env.s
    const a = await fise.finalizeFisa(
      fisa({
        client: { nume: 'Ștefan Țurcanu', telefon: '069123456' },
        auto: { ...fisa().auto, vin: '1'.repeat(17) }
      })
    )
    await fise.finalizeFisa(fisa({ auto: { ...fisa().auto, nrInmatriculare: 'K 2', vin: '' } }))
    expect((await fise.searchFise('stefan turcanu')).map((f) => f.nr)).toEqual([a.fisa.nr])
    expect(await fise.searchFise('   ')).toEqual([])
    expect((await fise.searchFise(a.fisa.nr))[0].nr).toBe(a.fisa.nr)
    expect(await fise.getVehicleHistory('1'.repeat(17), '')).toHaveLength(1)
    expect(await fise.getVehicleHistory('', '')).toEqual([])
  })

  it('rapoarte: total corect cu reduceri; CSV are BOM si e sigur contra formulelor', async () => {
    const { fise, reports } = env.s
    await fise.finalizeFisa(fisa({ reducerePiesePercent: 10, reducereLucrariPercent: 0 }))
    const r = await reports.getRapoarte('tot')
    expect(r.numarFise).toBe(1)
    expect(r.totalIncasat).toBe(145)
    await fise.finalizeFisa(
      fisa({
        client: { nume: '=HYPERLINK("x")', telefon: '0691234567' },
        auto: { ...fisa().auto, nrInmatriculare: 'C 2' }
      })
    )
    const { csv, count } = await reports.exportFiseCsv('tot')
    expect(count).toBe(2)
    expect(csv.startsWith('﻿"Nr. fișă"')).toBe(true)
    expect(csv).toContain('"\'=HYPERLINK(""x"")"')
    expect(csv).toContain('"145,00"')
  })

  it('autocomplete invata din fise si ignora intrari malformate', async () => {
    const { fise } = env.s
    await fise.finalizeFisa(
      fisa({ piese: [{ id: '1', denumire: 'Piesa Unica 123', cantitate: '1', pretUnitar: '7' }] })
    )
    const data = await fise.getAutocompleteData()
    expect(data.piese.some((p) => p.denumire === 'Piesa Unica 123' && p.pretUnitar === '7')).toBe(true)
    fs.writeFileSync(
      path.join(fiseDir(), 'BAD_1.json'),
      JSON.stringify({ client: {}, auto: {}, piese: { x: 1 }, lucrari: [null, 5] })
    )
    const s2 = await env.restart()
    await expect(s2.fise.getAutocompleteData()).resolves.toBeTruthy()
    await expect(s2.reports.getRapoarte('tot')).resolves.toBeTruthy()
  })
})
