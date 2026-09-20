import { app } from 'electron'
import path from 'path'
import fs from 'fs'

// Config minim, separat de "date/setari.json" (acolo sunt datele firmei,
// portabile odata cu fisele). Asta trebuie sa fie gasibil INAINTE sa stim
// unde e folderul de date - deci traieste mereu in AppData, fix, indiferent
// unde a fost mutat folderul de date propriu-zis.
function configFilePath() {
  return path.join(app.getPath('userData'), 'app-config.json')
}

function readConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(configFilePath(), 'utf-8'))
    return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {}
  } catch {
    return {}
  }
}

// Scrierea INTEGREaza cheile existente: fiecare setare isi schimba doar cheia ei.
function writeConfig(patch) {
  const cfg = { ...readConfig(), ...patch }
  fs.mkdirSync(path.dirname(configFilePath()), { recursive: true })
  const tmp = `${configFilePath()}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf-8')
  fs.renameSync(tmp, configFilePath())
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
