import { app } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import log from '../logger'
import { toAppError, AppError } from '../errors'
import { getDataPathOverride, setDataPathOverride } from '../appConfig'
import { copyFileAtomic, dirEntryCount, exists, isTmpName, listFiles, readJson, runExclusive } from './io'

export const TRASH_RETENTION_DAYS = 30

// Locatia implicita: folderul de date al utilizatorului (AppData), NU langa
// exe - un update auto (NSIS) dezinstaleaza intai versiunea veche, ceea ce
// sterge recursiv folderul de instalare. In dev ramane langa proiect, ca sa
// nu se amestece cu instalari reale.
export function getDefaultDataPath() {
  if (!app.isPackaged) return path.join(app.getAppPath(), 'date')
  return path.join(app.getPath('userData'), 'date')
}

// Locatia veche (pre-fix, langa exe) - migrata automat o singura data.
function getLegacyDefaultDataPath() {
  if (!app.isPackaged) return null
  return path.join(path.dirname(process.execPath), 'date')
}

// Plasa de siguranta independenta: TOT in AppData, deci niciodata in aceeasi
// locatie cu folderul de date principal (implicit SAU ales manual).
export function getSafetyBackupDir() {
  return path.join(app.getPath('userData'), 'safety-backup')
}

// Folder de lucru TEMPORAR, folosit doar cand folderul principal nu poate fi
// scris/gasit (unitate USB scoasa, retea cazuta, permisiuni). Distinct de
// folderul implicit, ca datele create aici sa fie recunoscute si aduse inapoi
// (merge) la urmatoarea pornire in care folderul principal e din nou disponibil.
export function getTempFallbackDir() {
  return path.join(app.getPath('userData'), 'date-temporar')
}

function primaryDir() {
  return getDataPathOverride() || getDefaultDataPath()
}

export const state = {
  baseDir: null,
  usingFallback: false,
  overrideUnavailable: null, // calea dorita, cand folderul ales nu e disponibil
  migratedFromLegacy: false,
  recoveredFromSafetyBackup: false,
  healedFise: 0,
  mergedBackFromTemp: 0,
  quarantined: [] // { name, restored }
}

export function getBaseDir() {
  return state.baseDir || primaryDir()
}
export const getFiseDir = () => path.join(getBaseDir(), 'fise')
export const getDraftsDir = () => path.join(getBaseDir(), 'drafturi')
export const getBackupDir = () => path.join(getBaseDir(), 'backup')
export const getTrashDir = () => path.join(getBaseDir(), 'trash')
export const getCorruptDir = () => path.join(getBaseDir(), 'corupte')
export const getSettingsPath = () => path.join(getBaseDir(), 'setari.json')
export const getCounterPath = () => path.join(getBaseDir(), 'contor.json')
export const getSnapshotsDir = () => path.join(getSafetyBackupDir(), 'snapshots')
// Versiunile suprascrise (editare fisa) - o copie in safety-backup, una locala.
export const getHistoryDirs = () => [path.join(getSafetyBackupDir(), 'history'), path.join(getBackupDir(), 'history')]

export const isUsingFallbackLocation = () => state.usingFallback
export const isMigratedFromLegacy = () => state.migratedFromLegacy
export const isRecoveredFromSafetyBackup = () => state.recoveredFromSafetyBackup
export const getCurrentDataPath = () => getBaseDir()

// Cache-urile (drafturi/fise) se inregistreaza aici ca sa fie invalidate
// cand se schimba folderul de date.
const invalidators = []
export function registerInvalidator(fn) {
  invalidators.push(fn)
}

export function invalidateAllCaches() {
  for (const fn of invalidators) fn()
}

async function tryUseDir(dir) {
  await fs.mkdir(dir, { recursive: true })
  const testFile = path.join(dir, `.write-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await fs.writeFile(testFile, 'ok')
  await fs.unlink(testFile)
}

// Copiaza doar ce lipseste la destinatie - nu suprascrie si nu sterge nimic la sursa.
async function copyMissing(srcDir, destDir) {
  if (!(await exists(srcDir))) return 0
  await fs.mkdir(destDir, { recursive: true })
  let copiate = 0
  for (const entry of await fs.readdir(srcDir, { withFileTypes: true })) {
    if (isTmpName(entry.name)) continue
    const destPath = path.join(destDir, entry.name)
    if (await exists(destPath)) continue
    if (entry.isDirectory()) {
      await fs.cp(path.join(srcDir, entry.name), destPath, { recursive: true, force: false, errorOnExist: false })
    } else {
      await copyFileAtomic(path.join(srcDir, entry.name), destPath)
    }
    copiate++
  }
  return copiate
}

// Ca copyMissing, dar suprascrie si fisierele existente daca sursa e MAI NOUA
// (folosit la mutarea folderului de date si la aducerea inapoi din folderul
// temporar: o editare facuta intre timp nu trebuie sa piarda in fata unei
// versiuni mai vechi). Recursiv; ignora fisierele temporare.
async function copyNewer(srcDir, destDir) {
  if (!(await exists(srcDir))) return 0
  await fs.mkdir(destDir, { recursive: true })
  let n = 0
  for (const entry of await fs.readdir(srcDir, { withFileTypes: true })) {
    if (isTmpName(entry.name)) continue
    const s = path.join(srcDir, entry.name)
    const d = path.join(destDir, entry.name)
    if (entry.isDirectory()) {
      n += await copyNewer(s, d)
      continue
    }
    const [ss, ds] = await Promise.all([fs.stat(s), fs.stat(d).catch(() => null)])
    // Tolerata de 1s (precizia mtime pe FAT/USB) doar cand marimea e aceeasi.
    if (ds && (ss.mtimeMs <= ds.mtimeMs || (ss.mtimeMs - ds.mtimeMs <= 1000 && ss.size === ds.size))) continue
    await copyFileAtomic(s, d)
    n++
  }
  return n
}

// "nume__1789694299631.json" -> { base, ts, ext }
export function parseTrashName(name) {
  const m = /^(.+)__(\d{10,})\.(json|pdf)$/.exec(name)
  return m ? { base: m[1], ts: Number(m[2]), ext: m[3] } : null
}

async function housekeeping(baseDir) {
  const fiseDir = path.join(baseDir, 'fise')
  const draftsDir = path.join(baseDir, 'drafturi')
  // Pornim cu instanta unica (vezi index.js) - orice .tmp- e ramas dintr-un
  // crash, iar un .json gol e un nume rezervat de o finalizare intrerupta.
  for (const dir of [fiseDir, draftsDir]) {
    for (const name of await listFiles(dir)) {
      const p = path.join(dir, name)
      try {
        if (isTmpName(name)) await fs.unlink(p)
        else if (dir === fiseDir && name.endsWith('.json') && (await fs.stat(p)).size === 0) await fs.unlink(p)
      } catch (err) {
        log.warn(`[store] curatare ${name} esuata`, err)
      }
    }
  }
  const trashDir = path.join(baseDir, 'trash')
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 3600 * 1000
  for (const name of await listFiles(trashDir)) {
    const t = parseTrashName(name)
    if (t && t.ts < cutoff) await fs.unlink(path.join(trashDir, name)).catch(() => {})
  }
}

// Aduce inapoi din folderul temporar ce s-a lucrat cat folderul principal a
// fost indisponibil, apoi pastreaza (redenumit) folderul temporar - nu-l stergem.
async function mergeBackFromTemp(baseDir) {
  const temp = getTempFallbackDir()
  if (path.resolve(temp) === path.resolve(baseDir) || !(await exists(temp))) return
  const n =
    (await copyNewer(path.join(temp, 'fise'), path.join(baseDir, 'fise'))) +
    (await copyNewer(path.join(temp, 'drafturi'), path.join(baseDir, 'drafturi'))) +
    (await copyNewer(path.join(temp, 'trash'), path.join(baseDir, 'trash')))
  const total = (await dirEntryCount(path.join(temp, 'fise'))) + (await dirEntryCount(path.join(temp, 'drafturi')))
  if (total > 0) {
    state.mergedBackFromTemp = n
    log.warn(`[store] ${n} fisiere lucrate in folderul temporar au fost aduse inapoi in ${baseDir}`)
  }
  await fs
    .rename(temp, `${temp}-fuzionat-${Date.now()}`)
    .catch((err) => log.warn('[store] redenumire folder temporar esuata', err))
}

// Vindecare pentru pierderea PARTIALA: fise care exista in safety-backup dar
// lipsesc din folderul principal (sterse de antivirus/din greseala/corupte
// pe disc). Nu readuce ce a fost sters din aplicatie - acelea sunt mutate in
// trash/ si scoase din backup la stergere (vezi fise.js) - si nu atinge ce exista deja.
async function healFiseFromSafety(baseDir) {
  const safetyFise = path.join(getSafetyBackupDir(), 'fise')
  const trashBases = new Set(
    (await listFiles(path.join(baseDir, 'trash'))).map((n) => parseTrashName(n)?.base).filter(Boolean)
  )
  let healed = 0
  for (const name of await listFiles(safetyFise)) {
    if (!name.endsWith('.json') || isTmpName(name)) continue
    const base = name.replace(/\.json$/, '')
    if (trashBases.has(base)) continue
    const dest = path.join(baseDir, 'fise', name)
    if (await exists(dest)) continue
    if (!(await readJson(path.join(safetyFise, name))).ok) continue
    try {
      await copyFileAtomic(path.join(safetyFise, name), dest)
      const pdf = `${base}.pdf`
      if (await exists(path.join(safetyFise, pdf))) {
        await copyFileAtomic(path.join(safetyFise, pdf), path.join(baseDir, 'fise', pdf)).catch(() => {})
      }
      healed++
    } catch (err) {
      log.warn(`[store] vindecare ${name} esuata`, err)
    }
  }
  if (healed > 0) {
    state.healedFise = healed
    log.error(`[store] ATENTIE: ${healed} fise lipseau din folderul principal - restaurate din backup-ul de siguranta`)
  }
}

async function migrateAndRecover(baseDir) {
  const fiseDir = path.join(baseDir, 'fise')
  const draftsDir = path.join(baseDir, 'drafturi')

  if (!getDataPathOverride()) {
    const legacyBase = getLegacyDefaultDataPath()
    if (legacyBase && path.resolve(legacyBase) !== path.resolve(baseDir)) {
      const alreadyHasData = (await dirEntryCount(fiseDir)) > 0 || (await dirEntryCount(draftsDir)) > 0
      if (!alreadyHasData) {
        const n1 = await copyMissing(path.join(legacyBase, 'fise'), fiseDir)
        const n2 = await copyMissing(path.join(legacyBase, 'drafturi'), draftsDir)
        await copyFileAtomic(path.join(legacyBase, 'setari.json'), path.join(baseDir, 'setari.json')).catch(() => {})
        if (n1 + n2 > 0) {
          state.migratedFromLegacy = true
          log.warn(`[store] migrare automata din ${legacyBase} in ${baseDir}: ${n1} fise, ${n2} drafturi`)
        }
      }
    }
  }

  const safetyDir = getSafetyBackupDir()
  const isEmpty = (await dirEntryCount(fiseDir)) === 0 && (await dirEntryCount(draftsDir)) === 0
  if (isEmpty) {
    const hasSafetyData =
      (await dirEntryCount(path.join(safetyDir, 'fise'))) > 0 ||
      (await dirEntryCount(path.join(safetyDir, 'drafturi'))) > 0
    if (hasSafetyData) {
      const n1 = await copyMissing(path.join(safetyDir, 'fise'), fiseDir)
      const n2 = await copyMissing(path.join(safetyDir, 'drafturi'), draftsDir)
      await copyFileAtomic(path.join(safetyDir, 'setari.json'), path.join(baseDir, 'setari.json')).catch(() => {})
      await copyFileAtomic(path.join(safetyDir, 'contor.json'), path.join(baseDir, 'contor.json')).catch(() => {})
      state.recoveredFromSafetyBackup = true
      log.error(`[store] folderul principal era gol - restaurat din backup-ul de siguranta: ${n1} fise, ${n2} drafturi`)
    }
  } else {
    await healFiseFromSafety(baseDir)
  }
}

let resolvePromise = null

async function resolveBaseDir() {
  const wanted = getDataPathOverride()
  let dir
  try {
    await tryUseDir(primaryDir())
    state.usingFallback = false
    state.overrideUnavailable = null
    dir = primaryDir()
  } catch (err) {
    log.warn(`[store] folderul "${primaryDir()}" nu e disponibil/scriptibil - folosesc folderul temporar`, err)
    state.usingFallback = true
    state.overrideUnavailable = wanted || null
    dir = getTempFallbackDir()
    try {
      await tryUseDir(dir)
    } catch (err2) {
      throw toAppError(err2, 'Nu s-a putut crea folderul de date al aplicației.')
    }
  }
  state.baseDir = dir
  const steps = [
    async () => {
      if (!state.usingFallback) await mergeBackFromTemp(dir)
    },
    () => housekeeping(dir),
    () => migrateAndRecover(dir)
  ]
  for (const step of steps) {
    try {
      await step()
    } catch (err) {
      // Pasi suplimentari: un esec aici nu trebuie sa opreasca aplicatia.
      log.error('[store] pas de initializare esuat', err)
    }
  }
  return dir
}

let dirsPromise = null

export function ensureDirs() {
  if (!dirsPromise) {
    dirsPromise = (async () => {
      resolvePromise ||= resolveBaseDir()
      await resolvePromise
      for (const dir of [getFiseDir(), getDraftsDir(), getBackupDir(), getTrashDir(), getCorruptDir()]) {
        try {
          await fs.mkdir(dir, { recursive: true })
        } catch (err) {
          throw toAppError(err, 'Nu s-a putut crea folderul de date al aplicației.')
        }
      }
    })()
    dirsPromise.catch(() => {
      dirsPromise = null
      resolvePromise = null
    })
  }
  return dirsPromise
}

const isInside = (child, parent) => {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

// Schimba folderul de date. COPIAZA (nu muta), verifica, abia apoi comuta -
// originalul ramane intact. Ruleaza sub cozile 'fise-write' si 'backup', ca nicio
// finalizare/stergere/backup sa nu scrie la jumatatea copierii. La un folder
// tinta care are deja continut, o fisa mai noua din sursa castiga (copyNewer).
export function changeDataPath(newBasePath) {
  return runExclusive('fise-write', () => runExclusive('backup', () => doChangeDataPath(newBasePath)))
}

async function doChangeDataPath(newBasePath) {
  await ensureDirs()
  const oldBase = getBaseDir()
  if (typeof newBasePath !== 'string' || !newBasePath.trim() || !path.isAbsolute(newBasePath)) {
    throw new AppError('INVALID_PATH', 'Folder invalid.')
  }
  const resolvedNew = path.resolve(newBasePath)

  if (path.resolve(oldBase) === resolvedNew) return { changed: false, path: oldBase }
  if (isInside(resolvedNew, oldBase) || isInside(oldBase, resolvedNew)) {
    throw new AppError('INVALID_PATH', 'Alege un folder care nu este în interiorul folderului curent (și nici invers).')
  }

  try {
    await tryUseDir(resolvedNew)
  } catch (err) {
    throw toAppError(err, 'Folderul ales nu este scriptibil. Alege alt folder.')
  }

  try {
    await copyNewer(oldBase, resolvedNew)
    for (const sub of ['fise', 'drafturi']) {
      const a = await dirEntryCount(path.join(oldBase, sub))
      const b = await dirEntryCount(path.join(resolvedNew, sub))
      if (b < a) throw new Error(`verificare copiere ${sub}: ${b} din ${a}`)
    }
  } catch (err) {
    throw toAppError(err, 'Copierea datelor existente în noul folder a eșuat. Nimic nu a fost schimbat.')
  }

  setDataPathOverride(path.resolve(getDefaultDataPath()) === resolvedNew ? null : resolvedNew)
  state.baseDir = resolvedNew
  state.usingFallback = false
  state.overrideUnavailable = null
  resolvePromise = Promise.resolve(resolvedNew)
  dirsPromise = null
  await ensureDirs()
  invalidateAllCaches()

  log.info(`[store] folder de date schimbat: ${oldBase} -> ${resolvedNew}`)
  return { changed: true, path: resolvedNew, oldPath: oldBase }
}

// Doar pentru teste: reia rezolvarea de la zero.
export function _resetForTests() {
  resolvePromise = null
  dirsPromise = null
  Object.assign(state, {
    baseDir: null,
    usingFallback: false,
    overrideUnavailable: null,
    migratedFromLegacy: false,
    recoveredFromSafetyBackup: false,
    healedFise: 0,
    mergedBackFromTemp: 0,
    quarantined: []
  })
}
