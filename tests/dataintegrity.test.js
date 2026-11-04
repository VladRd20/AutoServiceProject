import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fisa, ls, makeEnv, mkTmp, read } from './helpers'

let env
beforeEach(async () => {
  env = await makeEnv()
})
afterEach(() => {
  vi.restoreAllMocks()
  env.cleanup()
})

const fiseDir = () => path.join(env.dataDir, 'fise')
const plate = (p) => fisa({ auto: { ...fisa().auto, nrInmatriculare: p } })

describe('numerotare - contorul se salveaza dupa fisa', () => {
  it('scriere esuata a fisei -> urmatoarea finalizare reutilizeaza acelasi numar (fara gol)', async () => {
    const { fise } = env.s
    const io = await import('../src/main/store/io.js')
    const a = await fise.finalizeFisa(plate('A 1'))
    io.faults.beforeRename = (_f, to) => {
      if (to.includes('B-2_')) throw Object.assign(new Error('full'), { code: 'ENOSPC' })
    }
    await expect(fise.finalizeFisa(plate('B 2'))).rejects.toMatchObject({ code: 'ENOSPC' })
    io.faults.beforeRename = null
    // contorul NU a fost avansat de incercarea esuata
    expect(Object.values(read(path.join(env.dataDir, 'contor.json')))).toEqual([1])
    const b = await fise.finalizeFisa(plate('B 2'))
    expect(a.fisa.nr).toMatch(/-0001$/)
    expect(b.fisa.nr).toMatch(/-0002$/)
  })

  it('finalizari concurente primesc numere distincte, secventiale', async () => {
    const { fise } = env.s
    const rs = await Promise.all([fise.finalizeFisa(plate('C 1')), fise.finalizeFisa(plate('C 2')), fise.finalizeFisa(plate('C 3'))])
    expect(rs.map((r) => r.fisa.nr.slice(-4))).toEqual(['0001', '0002', '0003'])
  })

  it('contor ramas in urma dupa crash -> numarul se re-deriva din fisele de pe disc', async () => {
    const { fise } = env.s
    await fise.finalizeFisa(plate('D 1'))
    await fise.finalizeFisa(plate('D 2'))
    fs.writeFileSync(path.join(env.dataDir, 'contor.json'), JSON.stringify({ [new Date().getFullYear()]: 1 }))
    const s2 = await env.restart()
    const c = await s2.fise.finalizeFisa(plate('D 3'))
    expect(c.fisa.nr).toMatch(/-0003$/)
    expect(Object.values(read(path.join(env.dataDir, 'contor.json')))).toEqual([3])
  })
})

describe('cache - fise sarite temporar sunt reincercate', () => {
  it('prima citire tranzitorie, a doua reuseste -> fisa apare fara restart', async () => {
    const { fise } = env.s
    const a = await fise.finalizeFisa(plate('E 1'))
    await fise.finalizeFisa(plate('E 2'))
    const s2 = await env.restart()
    const target = path.join(fiseDir(), `${a.baseName}.json`)
    const real = fsp.readFile.bind(fsp)
    let blocked = true
    vi.spyOn(fsp, 'readFile').mockImplementation((p, ...rest) => {
      if (blocked && String(p) === target) return Promise.reject(Object.assign(new Error('locked'), { code: 'EACCES' }))
      return real(p, ...rest)
    })
    expect((await s2.fise.readAllFiseFinalizate()).map((f) => f._file)).not.toContain(`${a.baseName}.json`)
    // tot blocat: ramane in asteptare, nu dispare
    expect(await s2.fise.readAllFiseFinalizate()).toHaveLength(1)
    blocked = false
    expect(await s2.fise.readAllFiseFinalizate()).toHaveLength(2)
    expect(JSON.stringify(await s2.fise.searchFise('E 1'))).toContain('E 1')
    // fisierul a ramas neatins, nimic in carantina
    expect(ls(path.join(env.dataDir, 'corupte'))).toEqual([])
  })
})

describe('app-config.json', () => {
  const cfgPath = () => path.join(env.userData, 'app-config.json')

  it('corupt -> se pastreaza copia .corrupt-* si se reface din .bak', async () => {
    const cfg = await import('../src/main/appConfig.js')
    cfg.setDataPathOverride('D:\\date')
    cfg.setAutoUpdate(true) // .bak = versiunea cu dataPath
    fs.writeFileSync(cfgPath(), '{oops')
    expect(cfg.getDataPathOverride()).toBe('D:\\date')
    expect(ls(env.userData).some((n) => n.startsWith('app-config.json.corrupt-'))).toBe(true)
    expect(read(cfgPath()).dataPath).toBe('D:\\date') // fisierul principal vindecat
    cfg.setLastSeenVersion('1.0.0')
    expect(read(cfgPath())).toMatchObject({ dataPath: 'D:\\date', lastSeenVersion: '1.0.0' })
  })

  it('(a) ilizibil, fara .bak si fara copie .corrupt-* -> scrierea arunca si nu atinge fisierul', async () => {
    const cfg = await import('../src/main/appConfig.js')
    const bad = '{"dataPath":"D:\\\\date"' // trunchiat
    fs.writeFileSync(cfgPath(), bad)
    const real = fs.copyFileSync
    vi.spyOn(fs, 'copyFileSync').mockImplementation((from, to, ...r) => {
      if (String(to).includes('.corrupt-')) throw Object.assign(new Error('full'), { code: 'ENOSPC' })
      return real(from, to, ...r)
    })
    expect(() => cfg.setAutoUpdate(true)).toThrow(expect.objectContaining({ code: 'CONFIG_UNWRITABLE' }))
    expect(fs.readFileSync(cfgPath(), 'utf-8')).toBe(bad)
    expect(cfg.getAutoUpdate()).toBe(false)
    expect(cfg.setLastSeenVersion('1.0.0')).toBe(false) // necritic: nu arunca
  })

  it('(b) corupt/zero-byte fara .bak, dar cu copia .corrupt-* -> scrierea e permisa (se vindeca)', async () => {
    const cfg = await import('../src/main/appConfig.js')
    const bad = '{"dataPath":"D:\\\\date"'
    fs.writeFileSync(cfgPath(), bad)
    cfg.setAutoUpdate(true)
    expect(read(cfgPath())).toEqual({ autoUpdate: true })
    const copies = ls(env.userData).filter((n) => n.startsWith('app-config.json.corrupt-'))
    expect(copies.length).toBeGreaterThan(0)
    expect(fs.readFileSync(path.join(env.userData, copies[0]), 'utf-8')).toBe(bad)
    fs.writeFileSync(cfgPath(), '') // zero-byte
    cfg.setLastSeenVersion('2.0.0')
    expect(read(cfgPath())).toEqual({ lastSeenVersion: '2.0.0' })
  })

  it('(c) app-config.json lipseste dar .bak e valid -> se reface din .bak', async () => {
    const cfg = await import('../src/main/appConfig.js')
    cfg.setDataPathOverride('D:\\date')
    cfg.setAutoUpdate(true) // .bak = versiunea cu dataPath
    fs.rmSync(cfgPath())
    expect(cfg.getDataPathOverride()).toBe('D:\\date')
    expect(read(cfgPath()).dataPath).toBe('D:\\date')
    cfg.setLastSeenVersion('1.0.0')
    expect(read(cfgPath())).toMatchObject({ dataPath: 'D:\\date', lastSeenVersion: '1.0.0' })
  })

  it('scriere normala: atomica si pastreaza .bak cu versiunea anterioara', async () => {
    const cfg = await import('../src/main/appConfig.js')
    cfg.setAutoUpdate(true)
    expect(fs.existsSync(`${cfgPath()}.bak`)).toBe(false) // prima scriere: nimic de salvat
    cfg.setDataPathOverride('E:\\x')
    expect(read(`${cfgPath()}.bak`)).toEqual({ autoUpdate: true })
    expect(read(cfgPath())).toEqual({ autoUpdate: true, dataPath: 'E:\\x' })
    expect(ls(env.userData).filter((n) => n.includes('.tmp-'))).toEqual([])
  })
})

describe('import backup - sanitize + migrate', () => {
  it('intrarile nevalide/uriase sunt sarite si numarate; restul se importa curatat', async () => {
    const { backup } = env.s
    const file = path.join(mkTmp(), 'b.json')
    const oversize = fisa({
      piese: Array.from({ length: 301 }, (_, i) => ({ id: `p${i}`, denumire: 'x', cantitate: '1', pretUnitar: '1' }))
    })
    const legacy = { ...fisa({ nr: '2020-0001' }), reducerePercent: '10', observatii: 'o'.repeat(50000), extra: { evil: true } }
    delete legacy.schemaVersion
    delete legacy.reducerePiesePercent
    delete legacy.reducereLucrariPercent
    fs.writeFileSync(
      file,
      JSON.stringify({
        format: 'service-auto-backup',
        version: 1,
        fise: { 'A-1_01-01-2020': legacy, 'B-2_01-01-2020': oversize, 'C-3_01-01-2020': { client: 'x', auto: 'y' } },
        drafturi: {}
      })
    )
    const r = await backup.importBackup(file)
    expect(r.fiseRestaurate).toBe(1)
    expect(r.invalide).toBe(2)
    const saved = read(path.join(fiseDir(), 'A-1_01-01-2020.json'))
    expect(saved.schemaVersion).toBe(2)
    expect(saved.reducerePiesePercent).toBe('10')
    expect(saved.reducerePercent).toBeUndefined()
    expect(saved.extra).toBeUndefined()
    expect(saved.observatii.length).toBeLessThan(50000)
    expect(ls(fiseDir())).not.toContain('B-2_01-01-2020.json')
  })
})

describe('import backup - format vechi', () => {
  it('schema v1 (reducerePercent) + draft cu updatedAt: updatedAt pastrat, identicele nu sunt conflict', async () => {
    const { backup } = env.s
    const file = path.join(mkTmp(), 'old.json')
    const old = { ...fisa({ nr: '2020-0001' }), schemaVersion: 1, reducerePercent: '10', finalizedAt: '2020-01-01T10:00:00.000Z', status: 'finalizata' }
    delete old.reducerePiesePercent
    delete old.reducereLucrariPercent
    const draft = { ...fisa({ id: 'draft-1' }), status: 'draft', updatedAt: '2020-02-02T10:00:00.000Z' }
    fs.writeFileSync(
      file,
      JSON.stringify({ format: 'service-auto-backup', version: 1, fise: { 'A-1_01-01-2020': old }, drafturi: { 'draft-1': draft } })
    )
    let r = await backup.importBackup(file)
    expect(r).toMatchObject({ fiseRestaurate: 1, drafturiRestaurate: 1, conflicte: 0 })
    const d = read(path.join(env.dataDir, 'drafturi', 'draft-1.json'))
    expect(d.updatedAt).toBe('2020-02-02T10:00:00.000Z')
    r = await backup.importBackup(file) // a doua oara: pe disc e forma curatata
    expect(r.fiseIdentice).toBe(1)
    expect(r.conflicte).toBe(0)
  })
})
