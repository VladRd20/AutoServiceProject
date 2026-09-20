import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fisa, makeEnv, mkTmp } from './helpers'
import { fisaDay, inRange, isRealISODate, normalizeRange, presetRange } from '../src/shared/dateRange'

const require = createRequire(import.meta.url)
const keys = require('../scripts/keys-backup-lib.js')

describe('dateRange', () => {
  it('date reale / irreale', () => {
    expect(isRealISODate('2026-02-28')).toBe(true)
    expect(isRealISODate('2028-02-29')).toBe(true)
    expect(isRealISODate('2026-02-29')).toBe(false)
    expect(isRealISODate('2026-13-01')).toBe(false)
    expect(isRealISODate('26-01-01')).toBe(false)
    expect(isRealISODate(null)).toBe(false)
  })
  it('normalizeRange: invalid -> gol, inversat -> intors, nu arunca', () => {
    expect(normalizeRange({ from: 'x', to: '2026-01-01' })).toEqual({ from: '', to: '2026-01-01' })
    expect(normalizeRange({ from: '2026-03-01', to: '2026-01-01' })).toEqual({ from: '2026-01-01', to: '2026-03-01' })
    expect(normalizeRange(null)).toEqual({ from: '', to: '' })
    expect(normalizeRange('text')).toEqual({ from: '', to: '' })
  })
  it('preseturi (schimbare de an, luna trecuta din ianuarie, an bisect)', () => {
    const now = new Date(2026, 0, 15)
    expect(presetRange('azi', now)).toEqual({ from: '2026-01-15', to: '2026-01-15' })
    expect(presetRange('7zile', now)).toEqual({ from: '2026-01-09', to: '2026-01-15' })
    expect(presetRange('luna', now)).toEqual({ from: '2026-01-01', to: '2026-01-31' })
    expect(presetRange('luna-trecuta', now)).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(presetRange('anul', now)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    expect(presetRange('luna', new Date(2028, 1, 10))).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(presetRange('nu-exista')).toEqual({ from: '', to: '' })
  })
  it('inRange: capete incluse; fisa fara zi apare doar fara filtru', () => {
    const r = { from: '2026-09-01', to: '2026-09-30' }
    expect(inRange('2026-09-01', r)).toBe(true)
    expect(inRange('2026-09-30', r)).toBe(true)
    expect(inRange('2026-08-31', r)).toBe(false)
    expect(inRange('2026-10-01', r)).toBe(false)
    expect(inRange('', r)).toBe(false)
    expect(inRange('', { from: '', to: '' })).toBe(true)
    expect(inRange('2026-09-10', { from: '2026-09-01', to: '' })).toBe(true)
  })
  it('fisaDay: data simpla, datetime local, fallback la finalizedAt, gunoi', () => {
    expect(fisaDay({ data: '2026-09-18' })).toBe('2026-09-18')
    expect(fisaDay({ data: '2026-09-18T23:59:00' })).toBe('2026-09-18')
    expect(fisaDay({ data: 'gunoi', finalizedAt: new Date(2026, 4, 5, 12).toISOString() })).toBe('2026-05-05')
    expect(fisaDay({})).toBe('')
  })
})

describe('cautare si rapoarte cu interval', () => {
  let env
  beforeEach(async () => {
    env = await makeEnv()
  })
  afterEach(() => env.cleanup())

  async function seed() {
    const { fise } = env.s
    const mk = (nr, data, extra = {}) =>
      fise.finalizeFisa(fisa({ data, auto: { ...fisa().auto, nrInmatriculare: nr }, ...extra }))
    await mk('A 1', '2026-08-31')
    await mk('B 2', '2026-09-01')
    await mk('C 3', '2026-09-15')
    await mk('D 4', '2026-10-01', { client: { nume: 'Maria Ionescu', telefon: '0691234567' } })
  }

  it('interval fara text = toate din interval; capete incluse; text + interval combinate', async () => {
    await seed()
    const { fise } = env.s
    const sept = { from: '2026-09-01', to: '2026-09-30' }
    expect((await fise.searchFise('', sept)).map((f) => f.auto.nrInmatriculare).sort()).toEqual(['B 2', 'C 3'])
    expect((await fise.searchFise('c 3', sept)).map((f) => f.auto.nrInmatriculare)).toEqual(['C 3'])
    expect(await fise.searchFise('d 4', sept)).toEqual([])
    expect((await fise.searchFise('', { from: '2026-09-15', to: '' })).length).toBe(2)
    expect((await fise.searchFise('', { from: '', to: '2026-08-31' })).length).toBe(1)
  })

  it('fara text si fara interval = nimic; interval invalid/inversat nu strica', async () => {
    await seed()
    const { fise } = env.s
    expect(await fise.searchFise('', {})).toEqual([])
    expect(await fise.searchFise('', { from: 'x', to: 'y' })).toEqual([])
    expect((await fise.searchFise('', { from: '2026-09-30', to: '2026-09-01' })).length).toBe(2)
    expect(await fise.searchFise('', undefined)).toEqual([])
  })

  it('rapoarte + CSV pe interval', async () => {
    await seed()
    const { reports } = env.s
    const sept = { from: '2026-09-01', to: '2026-09-30' }
    const r = await reports.getRapoarte('interval', sept)
    expect(r.numarFise).toBe(2)
    expect(r.totalIncasat).toBe(300)
    const { csv, count } = await reports.exportFiseCsv('interval', sept)
    expect(count).toBe(2)
    expect(csv).not.toContain('D 4')
    expect((await reports.getRapoarte('interval', {})).numarFise).toBe(4)
  })
})

describe('setari aplicatie (app-config.json)', () => {
  it('auto-update si dataPath se pastreaza reciproc (scrierea integreaza cheile)', async () => {
    const env = await makeEnv()
    const cfg = await import('../src/main/appConfig.js')
    expect(cfg.getAutoUpdate()).toBe(false)
    cfg.setAutoUpdate(true)
    cfg.setDataPathOverride('C:\\alt\\folder')
    expect(cfg.getAutoUpdate()).toBe(true)
    expect(cfg.getDataPathOverride()).toBe('C:\\alt\\folder')
    cfg.setDataPathOverride(null)
    expect(cfg.getAutoUpdate()).toBe(true)
    expect(cfg.getDataPathOverride()).toBeNull()
    fs.writeFileSync(path.join(env.userData, 'app-config.json'), '{oops')
    expect(cfg.getAutoUpdate()).toBe(false)
    expect(cfg.getDataPathOverride()).toBeNull()
    fs.writeFileSync(path.join(env.userData, 'app-config.json'), '[1,2]')
    expect(cfg.getAutoUpdate()).toBe(false)
    env.cleanup()
  })
})

describe('backup criptat al cheilor', () => {
  const PASS = 'o-parola-lunga-si-sigura'
  function sampleDir() {
    const d = mkTmp('keys-')
    fs.writeFileSync(path.join(d, 'private.pem'), '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n')
    fs.writeFileSync(path.join(d, 'licenses.json'), JSON.stringify([{ id: 'x', client: 'Ștefan' }]))
    fs.mkdirSync(path.join(d, 'sub'))
    fs.writeFileSync(path.join(d, 'sub', 'n.txt'), 'nota')
    return d
  }

  it('dus-intors: continut identic, inclusiv subfoldere si diacritice', () => {
    const blob = keys.encryptBackup(keys.collectFiles(sampleDir()), PASS)
    expect(blob.toString()).not.toContain('PRIVATE KEY')
    const out = mkTmp('rest-')
    const written = keys.restoreFiles(keys.decryptBackup(blob, PASS), out)
    expect(written).toHaveLength(3)
    expect(fs.readFileSync(path.join(out, 'private.pem'), 'utf-8')).toContain('BEGIN PRIVATE KEY')
    expect(fs.readFileSync(path.join(out, 'sub', 'n.txt'), 'utf-8')).toBe('nota')
    expect(JSON.parse(fs.readFileSync(path.join(out, 'licenses.json'), 'utf-8'))[0].client).toBe('Ștefan')
  })

  it('parola gresita / fisier alterat / format necunoscut / parola scurta', () => {
    const blob = keys.encryptBackup(keys.collectFiles(sampleDir()), PASS)
    expect(() => keys.decryptBackup(blob, 'alta-parola-lunga-1')).toThrow(/Parola gresita/)
    expect(() => keys.decryptBackup(blob, '')).toThrow(/Parola gresita/)
    const box = JSON.parse(blob.toString())
    const raw = Buffer.from(box.data, 'base64')
    raw[10] ^= 0xff
    box.data = raw.toString('base64')
    expect(() => keys.decryptBackup(Buffer.from(JSON.stringify(box)), PASS)).toThrow(/alterat/)
    expect(() => keys.decryptBackup(Buffer.from('nu json'), PASS)).toThrow(/valid/)
    expect(() => keys.decryptBackup(Buffer.from('{"magic":"ALTCEVA"}'), PASS)).toThrow(/valid/)
    expect(() => keys.encryptBackup(keys.collectFiles(sampleDir()), 'scurta')).toThrow(/cel putin/)
    expect(() => keys.encryptBackup([], PASS)).toThrow(/Nu exista/)
  })

  it('doua backup-uri ale acelorasi date difera (sare/iv aleatoare)', () => {
    const files = keys.collectFiles(sampleDir())
    expect(keys.encryptBackup(files, PASS).equals(keys.encryptBackup(files, PASS))).toBe(false)
  })

  it('restaurarea nu suprascrie fara --force si respinge cai periculoase', () => {
    const files = keys.collectFiles(sampleDir())
    const out = mkTmp('rest-')
    keys.restoreFiles(files, out)
    expect(() => keys.restoreFiles(files, out)).toThrow(/--force/)
    expect(() => keys.restoreFiles(files, out, { force: true })).not.toThrow()
    expect(() => keys.restoreFiles([{ name: '../evil.txt', data: Buffer.from('x') }], out)).toThrow(/nepermisa/)
    expect(() => keys.restoreFiles([{ name: 'a/../../evil.txt', data: Buffer.from('x') }], out)).toThrow(/nepermisa/)
    expect(fs.existsSync(path.join(out, '..', 'evil.txt'))).toBe(false)
  })
})
