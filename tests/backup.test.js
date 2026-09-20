import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fisa, ls, makeEnv, mkTmp, read } from './helpers'

let env
beforeEach(async () => {
  env = await makeEnv()
})
afterEach(() => env.cleanup())

const fiseDir = () => path.join(env.dataDir, 'fise')
const setOverride = (p) =>
  fs.writeFileSync(path.join(env.userData, 'app-config.json'), JSON.stringify({ dataPath: p }))

describe('backup', () => {
  it('copiaza fise + drafturi + setari in oglinda locala si in safety-backup', async () => {
    const { fise, drafts, settings, backup } = env.s
    const a = await fise.finalizeFisa(fisa())
    await drafts.saveDraft(fisa({ observatii: 'draft' }))
    await settings.saveSettings({ numeService: 'X' })
    await backup.backupNow()
    for (const root of [path.join(env.dataDir, 'backup', 'mirror'), env.safety]) {
      expect(ls(path.join(root, 'fise'))).toContain(`${a.baseName}.json`)
      expect(ls(path.join(root, 'drafturi'))).toHaveLength(1)
      expect(read(path.join(root, 'setari.json')).numeService).toBe('X')
    }
  })

  it('NU copiaza un fisier corupt/gol peste o copie buna din backup', async () => {
    const { fise, backup } = env.s
    const a = await fise.finalizeFisa(fisa())
    await backup.backupNow()
    const src = path.join(fiseDir(), `${a.baseName}.json`)
    fs.writeFileSync(src, '{"trunchiat')
    // mtime mai nou ca sa se declanseze copierea
    const future = new Date(Date.now() + 60000)
    fs.utimesSync(src, future, future)
    await backup.backupNow()
    expect(read(path.join(env.safety, 'fise', `${a.baseName}.json`)).status).toBe('finalizata')
    fs.writeFileSync(src, '')
    fs.utimesSync(src, future, future)
    await backup.backupNow()
    expect(read(path.join(env.safety, 'fise', `${a.baseName}.json`)).status).toBe('finalizata')
  })

  it('fisa editata suprascrie copia din backup (versiunea veche ramane in history)', async () => {
    const { fise, backup } = env.s
    const a = await fise.finalizeFisa(fisa())
    await backup.backupNow()
    await fise.finalizeFisa(fisa({ observatii: 'v2 mai lunga ca sa difere marimea' }), { replaceBaseName: a.baseName })
    await backup.backupNow()
    expect(read(path.join(env.safety, 'fise', `${a.baseName}.json`)).observatii).toContain('v2')
  })

  it('oglinda de drafturi urmeaza stergerile, dar NU se goleste cand sursa e goala', async () => {
    const { drafts, backup } = env.s
    const d1 = await drafts.saveDraft(fisa())
    const d2 = await drafts.saveDraft(fisa())
    await backup.backupNow()
    expect(ls(path.join(env.safety, 'drafturi'))).toHaveLength(2)
    await drafts.deleteDraft(d1)
    await backup.backupNow()
    expect(ls(path.join(env.safety, 'drafturi'))).toEqual([`${d2}.json`])
    await drafts.deleteDraft(d2) // sursa goala -> backup-ul pastreaza
    await backup.backupNow()
    expect(ls(path.join(env.safety, 'drafturi'))).toEqual([`${d2}.json`])
  })

  it('snapshot zilnic creat, cu retentie de 30 de zile', async () => {
    const { fise, backup } = env.s
    await fise.finalizeFisa(fisa())
    const snapDir = path.join(env.safety, 'snapshots')
    fs.mkdirSync(snapDir, { recursive: true })
    for (let i = 1; i <= 40; i++) {
      fs.writeFileSync(path.join(snapDir, `snapshot-2026-01-${String(i).padStart(2, '0')}.json`.replace('-01-3', '-02-0').replace('-01-4', '-02-1')), '{}')
    }
    await backup.backupNow()
    const snaps = ls(snapDir).filter((f) => f.startsWith('snapshot-'))
    expect(snaps.length).toBeLessThanOrEqual(30)
    const today = snaps.sort().pop()
    const b = read(path.join(snapDir, today))
    expect(b.format).toBe('service-auto-backup')
    expect(Object.keys(b.fise)).toHaveLength(1)
    const st = await backup.getBackupStatus()
    expect(st.snapshots.length).toBeGreaterThan(0)
    expect(st.lastBackupAt).toBeTruthy()
  })

  it('backup concurent (10 in paralel) nu corupe nimic', async () => {
    const { fise, backup } = env.s
    for (let i = 0; i < 5; i++) await fise.finalizeFisa(fisa({ auto: { ...fisa().auto, nrInmatriculare: `N ${i}` } }))
    await Promise.all(Array.from({ length: 10 }, () => backup.backupNow()))
    expect(ls(path.join(env.safety, 'fise')).filter((f) => f.endsWith('.json'))).toHaveLength(5)
    expect(ls(path.join(env.safety, 'fise')).filter((f) => f.includes('.tmp-'))).toEqual([])
  })

  it('backup cand folderul de fise a disparut: esueaza controlat, datele din backup raman', async () => {
    const { fise, backup } = env.s
    await fise.finalizeFisa(fisa())
    await backup.backupNow()
    fs.rmSync(fiseDir(), { recursive: true, force: true })
    await expect(backup.backupNow()).rejects.toBeTruthy()
    expect(ls(path.join(env.safety, 'fise'))).toHaveLength(2 - 1) // doar json (pdf nu exista in test)
    expect((await backup.getBackupStatus()).lastError).toBeTruthy()
  })
})

describe('recuperare la pornire', () => {
  it('folder principal gol dar backup exista => restaurare completa', async () => {
    const { fise, drafts, settings, backup } = env.s
    const a = await fise.finalizeFisa(fisa())
    await drafts.saveDraft(fisa())
    await settings.saveSettings({ numeService: 'Auto SRL' })
    await backup.backupNow()
    fs.rmSync(env.dataDir, { recursive: true, force: true })
    const s2 = await env.restart()
    await s2.paths.ensureDirs()
    expect(s2.paths.state.recoveredFromSafetyBackup).toBe(true)
    expect(ls(fiseDir())).toContain(`${a.baseName}.json`)
    expect(ls(path.join(env.dataDir, 'drafturi'))).toHaveLength(1)
    expect((await s2.settings.getSettings()).numeService).toBe('Auto SRL')
  })

  it('pierdere PARTIALA (o fisa stearsa de antivirus) => vindecata; una stearsa din aplicatie NU', async () => {
    const { fise, backup } = env.s
    const a = await fise.finalizeFisa(fisa())
    const b = await fise.finalizeFisa(fisa({ auto: { ...fisa().auto, nrInmatriculare: 'B 2' } }))
    const c = await fise.finalizeFisa(fisa({ auto: { ...fisa().auto, nrInmatriculare: 'C 3' } }))
    await backup.backupNow()
    await fise.deleteFinalizedFisa(c.baseName) // intentionat
    fs.unlinkSync(path.join(fiseDir(), `${a.baseName}.json`)) // "antivirus"
    const s2 = await env.restart()
    await s2.paths.ensureDirs()
    expect(s2.paths.state.healedFise).toBe(1)
    const names = ls(fiseDir()).filter((f) => f.endsWith('.json'))
    expect(names.sort()).toEqual([`${a.baseName}.json`, `${b.baseName}.json`].sort())
  })

  it('vindecarea nu suprascrie o fisa existenta si sare peste backup corupt', async () => {
    const { fise, backup } = env.s
    const a = await fise.finalizeFisa(fisa({ observatii: 'noua' }))
    await backup.backupNow()
    fs.writeFileSync(path.join(env.safety, 'fise', 'ALTA_1.json'), 'corupt')
    fs.writeFileSync(path.join(env.safety, 'fise', `${a.baseName}.json`), JSON.stringify({ client: {}, auto: {}, observatii: 'VECHE' }))
    const s2 = await env.restart()
    await s2.paths.ensureDirs()
    expect(read(path.join(fiseDir(), `${a.baseName}.json`)).observatii).toBe('noua')
    expect(ls(fiseDir())).not.toContain('ALTA_1.json')
  })
})

describe('folder de date', () => {
  it('folder ales indisponibil => folder temporar + flag; la revenire datele se aduc inapoi', async () => {
    const usb = path.join(mkTmp('usb-'), 'ServiceAuto')
    setOverride(usb)
    let s = await env.restart()
    await s.paths.ensureDirs()
    const a = await s.fise.finalizeFisa(fisa())
    expect(s.paths.state.usingFallback).toBe(false)
    // "scoatem USB-ul": folderul devine imposibil de creat (parintele e un fisier)
    const away = `${path.dirname(usb)}-away`
    fs.renameSync(path.dirname(usb), away)
    fs.writeFileSync(path.dirname(usb), 'nu sunt director')
    s = await env.restart()
    await s.paths.ensureDirs()
    expect(s.paths.state.usingFallback).toBe(true)
    expect(s.paths.state.overrideUnavailable).toBe(usb)
    const tempDir = path.join(env.userData, 'date-temporar')
    expect(s.paths.getBaseDir()).toBe(tempDir)
    // se poate lucra in continuare (recuperat din safety-backup sau nou)
    const b = await s.fise.finalizeFisa(fisa({ auto: { ...fisa().auto, nrInmatriculare: 'T 1' } }))
    expect(fs.existsSync(path.join(tempDir, 'fise', `${b.baseName}.json`))).toBe(true)
    // "punem USB-ul la loc"
    fs.rmSync(path.dirname(usb), { force: true })
    fs.renameSync(away, path.dirname(usb))
    s = await env.restart()
    await s.paths.ensureDirs()
    expect(s.paths.state.usingFallback).toBe(false)
    expect(s.paths.state.mergedBackFromTemp).toBeGreaterThan(0)
    expect(ls(path.join(usb, 'fise'))).toContain(`${b.baseName}.json`)
    expect(ls(path.join(usb, 'fise'))).toContain(`${a.baseName}.json`)
    expect(fs.existsSync(tempDir)).toBe(false) // redenumit "fuzionat", nu sters
    expect(ls(env.userData).some((n) => n.startsWith('date-temporar-fuzionat-'))).toBe(true)
  })

  it('changeDataPath: copiaza, verifica, comuta; refuza foldere imbricate; pastreaza originalul', async () => {
    const { fise, paths } = env.s
    const a = await fise.finalizeFisa(fisa())
    await expect(paths.changeDataPath(path.join(env.dataDir, 'sub'))).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(paths.changeDataPath(path.dirname(env.dataDir))).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(paths.changeDataPath('')).rejects.toMatchObject({ code: 'INVALID_PATH' })
    expect(await paths.changeDataPath(env.dataDir)).toEqual({ changed: false, path: env.dataDir })

    const dest = path.join(mkTmp('nou-'), 'fise-service')
    const r = await paths.changeDataPath(dest)
    expect(r.changed).toBe(true)
    expect(ls(path.join(dest, 'fise'))).toContain(`${a.baseName}.json`)
    expect(ls(fiseDir())).toContain(`${a.baseName}.json`) // originalul ramane
    expect(paths.getFiseDir()).toBe(path.join(dest, 'fise'))
    // cache-ul e invalidat: fisele noi apar in noul folder
    const b = await fise.finalizeFisa(fisa({ auto: { ...fisa().auto, nrInmatriculare: 'N 1' } }))
    expect(ls(path.join(dest, 'fise'))).toContain(`${b.baseName}.json`)
    expect(ls(fiseDir())).not.toContain(`${b.baseName}.json`)
    // persistenta dupa repornire
    const s2 = await env.restart()
    await s2.paths.ensureDirs()
    expect(s2.paths.getBaseDir()).toBe(dest)
    // "Reseteaza la implicit" curata override-ul
    await s2.paths.changeDataPath(env.dataDir)
    expect(JSON.parse(fs.readFileSync(path.join(env.userData, 'app-config.json'), 'utf-8')).dataPath).toBeNull()
  })

  it('changeDataPath spre un folder nescriptibil nu schimba nimic', async () => {
    const { paths, fise } = env.s
    await fise.finalizeFisa(fisa())
    const blocker = path.join(mkTmp('blk-'), 'fisier')
    fs.writeFileSync(blocker, 'x')
    await expect(paths.changeDataPath(path.join(blocker, 'sub'))).rejects.toBeTruthy()
    expect(paths.getBaseDir()).toBe(env.dataDir)
  })
})

describe('export / import backup', () => {
  it('export -> pierdere totala -> import readuce tot; nu suprascrie, numara conflictele', async () => {
    const { fise, drafts, settings, backup } = env.s
    const a = await fise.finalizeFisa(fisa({ observatii: 'orig' }))
    await drafts.saveDraft(fisa())
    await settings.saveSettings({ numeService: 'S' })
    const out = path.join(mkTmp('exp-'), 'b.json')
    const ex = await backup.exportBackup(out)
    expect(ex).toMatchObject({ fise: 1, drafturi: 1 })

    // import peste date identice: nimic de facut
    let r = await backup.importBackup(out)
    expect(r).toMatchObject({ fiseRestaurate: 0, fiseIdentice: 1, conflicte: 0 })

    // fisa modificata dupa export => conflict, NEATINSA
    fs.writeFileSync(path.join(fiseDir(), `${a.baseName}.json`), JSON.stringify({ ...a.fisa, observatii: 'modificat dupa' }))
    r = await backup.importBackup(out)
    expect(r.conflicte).toBe(1)
    expect(read(path.join(fiseDir(), `${a.baseName}.json`)).observatii).toBe('modificat dupa')

    // pierdere totala + repornire fara backup automat
    fs.rmSync(env.dataDir, { recursive: true, force: true })
    fs.rmSync(env.safety, { recursive: true, force: true })
    const s2 = await env.restart()
    await s2.paths.ensureDirs()
    r = await s2.backup.importBackup(out)
    expect(r).toMatchObject({ fiseRestaurate: 1, drafturiRestaurate: 1, setariRestaurate: true })
    expect((await s2.fise.listRecentFise()).map((f) => f.nr)).toEqual([a.fisa.nr])
    expect((await s2.settings.getSettings()).numeService).toBe('S')
  })

  it('import respinge fisiere invalide, nume periculoase si intrari malformate', async () => {
    const { backup, fise } = env.s
    const tmp = mkTmp('bad-')
    const write = (name, content) => {
      const p = path.join(tmp, name)
      fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content))
      return p
    }
    await expect(backup.importBackup(path.join(tmp, 'nu-exista.json'))).rejects.toBeTruthy()
    await expect(backup.importBackup(write('a.json', 'nu e json'))).rejects.toMatchObject({ code: 'BAD_BACKUP' })
    await expect(backup.importBackup(write('b.json', { format: 'altceva', fise: {} }))).rejects.toMatchObject({ code: 'BAD_BACKUP' })
    await expect(backup.importBackup(write('c.json', [1, 2]))).rejects.toMatchObject({ code: 'BAD_BACKUP' })
    await expect(backup.importBackup(tmp)).rejects.toMatchObject({ code: 'BAD_BACKUP' }) // director

    const good = { client: { nume: 'x' }, auto: {} }
    const r = await backup.importBackup(
      write('d.json', {
        format: 'service-auto-backup',
        version: 1,
        fise: { '../../evil': good, 'a/b': good, ok_1: good, prost_2: 'text', gol_3: null, arr_4: [] },
        drafturi: { 'draft-1': good }
      })
    )
    expect(r.fiseRestaurate).toBe(1)
    expect(r.drafturiRestaurate).toBe(1)
    expect(r.invalide).toBe(5)
    expect(ls(fiseDir())).toEqual(['ok_1.json'])
    expect(fs.existsSync(path.join(env.dataDir, '..', 'evil.json'))).toBe(false)
    expect(await fise.listRecentFise()).toHaveLength(1)
  })

  it('export catre o cale invalida da eroare clara', async () => {
    await expect(env.s.backup.exportBackup('')).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(env.s.backup.exportBackup(path.join(env.root, 'nu', 'exista', 'b.json'))).rejects.toBeTruthy()
  })
})
