import fs from 'fs'
import os from 'os'
import path from 'path'
import { vi } from 'vitest'

export function mkTmp(prefix = 'sa-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

// Mediu izolat: userData + folder de proiect proprii, module reincarcate de la
// zero (starea din module - cache-uri, promise-uri - nu se scurge intre teste).
export async function makeEnv() {
  const root = mkTmp()
  const userData = path.join(root, 'userData')
  const appPath = path.join(root, 'app')
  fs.mkdirSync(userData, { recursive: true })
  fs.mkdirSync(appPath, { recursive: true })
  process.env.SA_USERDATA = userData
  process.env.SA_APPPATH = appPath
  vi.resetModules()
  const load = async () => {
    const paths = await import('../src/main/store/paths.js')
    const drafts = await import('../src/main/store/drafts.js')
    const fise = await import('../src/main/store/fise.js')
    const backup = await import('../src/main/store/backup.js')
    const settings = await import('../src/main/store/settings.js')
    const reports = await import('../src/main/store/reports.js')
    return { paths, drafts, fise, backup, settings, reports }
  }
  const env = {
    root,
    userData,
    appPath,
    dataDir: path.join(appPath, 'date'),
    safety: path.join(userData, 'safety-backup')
  }
  env.s = await load()
  // "Repornire aplicatie": aceleasi foldere pe disc, module/cache-uri noi.
  env.restart = async () => {
    process.env.SA_USERDATA = userData
    process.env.SA_APPPATH = appPath
    vi.resetModules()
    env.s = await load()
    return env.s
  }
  env.cleanup = () => fs.rmSync(root, { recursive: true, force: true })
  return env
}

export function fisa(over = {}) {
  return {
    id: null,
    client: { nume: 'Ion Popescu', telefon: '+373 69 123 456', cui: '' },
    auto: { nrInmatriculare: 'C AB 123', marca: 'Dacia', model: 'Logan', vin: '', an: '2018' },
    km: '',
    observatii: '',
    plata: { status: '', metoda: '' },
    data: '2026-09-18',
    dataCurenta: false,
    piese: [{ id: 'p1', denumire: 'Filtru ulei', cantitate: '1', pretUnitar: '50' }],
    lucrari: [{ id: 'l1', denumire: 'Schimb ulei', cantitate: '1', pret: '100' }],
    reducerePiesePercent: 0,
    reducereLucrariPercent: 0,
    ...over
  }
}

export const read = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'))
export const ls = (p) => (fs.existsSync(p) ? fs.readdirSync(p) : [])
