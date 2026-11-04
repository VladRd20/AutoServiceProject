import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import log from './logger'

// Config minim, separat de "date/setari.json" (acolo sunt datele firmei,
// portabile odata cu fisele). Asta trebuie sa fie gasibil INAINTE sa stim
// unde e folderul de date - deci traieste mereu in AppData, fix, indiferent
// unde a fost mutat folderul de date propriu-zis.
function configFilePath() {
  return path.join(app.getPath('userData'), 'app-config.json')
}

const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES'])

// Scriere atomica SINCRONA: tmp unic -> fsync -> rename (cu cateva reincercari
// scurte pe Windows, unde antivirusul poate tine fisierul deschis o clipa).
function writeFileAtomicSync(filePath, text) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  try {
    const fd = fs.openSync(tmp, 'w')
    try {
      fs.writeSync(fd, text, null, 'utf-8')
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    for (let i = 0; ; i++) {
      try {
        fs.renameSync(tmp, filePath)
        return
      } catch (err) {
        if (!TRANSIENT.has(err?.code) || i >= 3) throw err
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 * (i + 1))
      }
    }
  } catch (err) {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* tmp inexistent */
    }
    throw err
  }
}

function parseConfig(raw) {
  const cfg = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw)
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('continut JSON neasteptat')
  return cfg
}

// Fisierele corupte deja salvate (ca sa nu copiem aceeasi stricaciune la fiecare citire).
const reportedCorrupt = new Set()

// Intoarce { cfg, raw, unreadable }. `unreadable` = fisierul EXISTA dar nu s-a
// putut citi/parsa si nici .bak nu l-a salvat: cfg e gol doar ca valoare de
// citire, iar writeConfig NU are voie sa scrie peste (altfel dataPath s-ar pierde).
function loadConfig() {
  const file = configFilePath()
  let raw
  try {
    raw = fs.readFileSync(file, 'utf-8')
  } catch (err) {
    if (err.code === 'ENOENT') return { cfg: {}, raw: null, unreadable: false }
    log.error('[appConfig] app-config.json nu a putut fi citit', err)
    return { cfg: {}, raw: null, unreadable: true }
  }
  try {
    return { cfg: parseConfig(raw), raw, unreadable: false }
  } catch (err) {
    log.error(`[appConfig] app-config.json este corupt (${err.message}) - incerc ${path.basename(file)}.bak`)
    const key = `${raw.length}:${raw.slice(0, 64)}`
    if (!reportedCorrupt.has(key)) {
      reportedCorrupt.add(key)
      try {
        fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`)
      } catch (copyErr) {
        log.error('[appConfig] nu s-a putut pastra copia fisierului corupt', copyErr)
      }
    }
  }
  try {
    const bakRaw = fs.readFileSync(`${file}.bak`, 'utf-8')
    const cfg = parseConfig(bakRaw)
    log.error('[appConfig] configurare refacuta din app-config.json.bak')
    try {
      writeFileAtomicSync(file, bakRaw) // vindecam fisierul principal; .bak ramane neatins
    } catch (err) {
      log.warn('[appConfig] nu s-a putut rescrie app-config.json din .bak', err)
    }
    return { cfg, raw: bakRaw, unreadable: false }
  } catch {
    log.error('[appConfig] fara .bak valid - app-config.json corupt ramane neatins (copie in .corrupt-*)')
    return { cfg: {}, raw: null, unreadable: true }
  }
}

function readConfig() {
  return loadConfig().cfg
}

// Scrierea INTEGREaza cheile existente: fiecare setare isi schimba doar cheia ei.
// Atomic (+ .bak cu ultima versiune buna); refuza sa scrie peste un fisier
// existent dar ilizibil, ca sa nu piarda dataPath.
function writeConfig(patch) {
  const file = configFilePath()
  const { cfg: current, raw, unreadable } = loadConfig()
  if (unreadable) {
    log.error('[appConfig] scriere refuzata: app-config.json existent nu poate fi citit/refacut', Object.keys(patch))
    return
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  try {
    if (raw !== null) writeFileAtomicSync(`${file}.bak`, raw)
  } catch (err) {
    log.warn('[appConfig] .bak nescris', err)
  }
  writeFileAtomicSync(file, JSON.stringify({ ...current, ...patch }, null, 2))
}

export function getDataPathOverride() {
  return readConfig().dataPath || null
}

export function setDataPathOverride(newPath) {
  writeConfig({ dataPath: newPath || null })
}

// Ultima versiune pentru care utilizatorul a vazut "Ce e nou" (vezi shared/whatsNew.js).
export function getLastSeenVersion() {
  const v = readConfig().lastSeenVersion
  return typeof v === 'string' ? v : null
}

export function setLastSeenVersion(version) {
  writeConfig({ lastSeenVersion: String(version) })
}

// "Descarca si instaleaza automat actualizarile la inchidere" (implicit oprit).
export function getAutoUpdate() {
  return readConfig().autoUpdate === true
}

export function setAutoUpdate(enabled) {
  writeConfig({ autoUpdate: Boolean(enabled) })
}
