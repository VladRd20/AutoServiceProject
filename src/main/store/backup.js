import path from 'path'
import fs from 'fs/promises'
import log from '../logger'
import { AppError, toAppError } from '../errors'
import {
  assertSafeId,
  copyFileAtomic,
  exists,
  isTmpName,
  listFiles,
  mapLimit,
  readJson,
  runExclusive,
  writeJsonAtomic
} from './io'
import {
  ensureDirs,
  getBackupDir,
  getCounterPath,
  getDraftsDir,
  getFiseDir,
  getSafetyBackupDir,
  getSettingsPath,
  getSnapshotsDir,
  getTrashDir,
  invalidateAllCaches,
  parseTrashName
} from './paths'

const SNAPSHOT_KEEP = 30
const SNAPSHOT_MIN_INTERVAL_MS = 10 * 60 * 1000
const BUNDLE_FORMAT = 'service-auto-backup'
const BUNDLE_MAX_BYTES = 200 * 1024 * 1024

const status = { lastBackupAt: null, lastError: null, lastSnapshotAt: 0 }

// Doua straturi de backup, actualizate incremental la fiecare apel:
//  1) "mirror" local, langa datele principale - usor de gasit/copiat manual,
//     dar dispare odata cu ele daca folderul principal e sters.
//  2) "safety-backup", mereu in AppData, independent de folderul principal -
//     plasa reala de siguranta (recuperare/vindecare la pornire, vezi paths.js).
// + snapshot-uri zilnice (un singur fisier JSON cu tot), ultimele 30 de zile:
//   protejeaza si de o fisa CORUPTA/modificata gresit care s-ar propaga in
//   oglinzi - snapshot-ul de ieri ramane bun.
export function backupNow() {
  return runExclusive('backup', async () => {
    await ensureDirs()
    const localMirror = path.join(getBackupDir(), 'mirror')
    const safetyDir = getSafetyBackupDir()
    try {
      let total = 0
      for (const dest of [localMirror, safetyDir]) {
        // Fisele finalizate: copiem si versiunile MODIFICATE, dar nu stergem
        // niciodata din backup aici (stergerea intentionata scoate explicit
        // fisa din backup - vezi removeFromMirrors in fise.js).
        total += await syncNewer(getFiseDir(), path.join(dest, 'fise'), { prune: false })
        // Drafturile se schimba la fiecare autosave si dispar cand sunt
        // finalizate/sterse: oglinda le urmeaza.
        // Curatam oglinda si cand ultimul draft a fost sters/finalizat, DAR doar
        // daca folderul de date nu pare golit (are fise) - altfel pastram backup-ul.
        total += await syncNewer(getDraftsDir(), path.join(dest, 'drafturi'), {
          prune: true,
          pruneWhenEmpty: (await listFiles(getFiseDir())).length > 0
        })
        if (await exists(getSettingsPath())) {
          const s = await readJson(getSettingsPath())
          if (s.ok) await copyFileAtomic(getSettingsPath(), path.join(dest, 'setari.json')).catch(() => {})
        }
        if ((await readJson(getCounterPath())).ok) {
          await copyFileAtomic(getCounterPath(), path.join(dest, 'contor.json')).catch(() => {})
        }
      }
      await maybeSnapshot(total)
      status.lastBackupAt = new Date().toISOString()
      status.lastError = null
      log.info(`[backup] actualizat (local + safety-backup): ${total} fisiere copiate/actualizate`)
      return safetyDir
    } catch (err) {
      status.lastError = err?.message || String(err)
      log.error('[backup] esuat', err)
      throw toAppError(err, 'Backup-ul automat a eșuat. Datele originale sunt intacte.')
    }
  })
}

// Copiaza ce lipseste sau e mai nou/diferit la sursa. Fisierele JSON se
// valideaza INAINTE de copiere: un fisier corupt/gol nu are voie sa inlocuiasca
// o copie buna din backup.
async function syncNewer(srcDir, destDir, { prune, pruneWhenEmpty = false }) {
  await fs.mkdir(destDir, { recursive: true })
  let changed = 0
  const srcEntries = (await fs.readdir(srcDir, { withFileTypes: true })).filter(
    (e) => e.isFile() && !isTmpName(e.name)
  )
  const srcNames = new Set(srcEntries.map((e) => e.name))
  await mapLimit(srcEntries, 16, async (entry) => {
    const src = path.join(srcDir, entry.name)
    const dest = path.join(destDir, entry.name)
    try {
      const [ss, ds] = await Promise.all([fs.stat(src), fs.stat(dest).catch(() => null)])
      if (ss.size === 0) return
      if (ds && ds.size === ss.size && ds.mtimeMs >= ss.mtimeMs) return
      if (entry.name.endsWith('.json') && !(await readJson(src)).ok) {
        log.warn(`[backup] ${entry.name} nu e JSON valid - nu il copiez peste backup`)
        return
      }
      await copyFileAtomic(src, dest)
      changed++
    } catch (err) {
      log.warn(`[backup] nu s-a putut copia ${entry.name}`, err)
    }
  })
  // Nu curatam cand sursa e goala: un folder golit din senin e exact cazul in
  // care backup-ul trebuie sa PASTREZE ce avea.
  if (prune && (srcEntries.length > 0 || pruneWhenEmpty)) {
    for (const entry of await fs.readdir(destDir, { withFileTypes: true })) {
      if (entry.isFile() && !isTmpName(entry.name) && !srcNames.has(entry.name)) {
        await fs.unlink(path.join(destDir, entry.name)).catch(() => {})
        changed++
      }
    }
  }
  return changed
}

// ------------------------------------------------------------ bundle ------
async function readJsonDir(dir) {
  const out = {}
  const files = (await listFiles(dir)).filter((n) => n.endsWith('.json') && !isTmpName(n))
  await mapLimit(files, 32, async (n) => {
    const r = await readJson(path.join(dir, n))
    if (r.ok) out[n.replace(/\.json$/, '')] = r.value
  })
  return out
}

async function buildBundle() {
  const settings = await readJson(getSettingsPath())
  return {
    format: BUNDLE_FORMAT,
    version: 1,
    createdAt: new Date().toISOString(),
    fise: await readJsonDir(getFiseDir()),
    drafturi: await readJsonDir(getDraftsDir()),
    setari: settings.ok ? settings.value : null
  }
}

const dayStamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

async function maybeSnapshot(changedCount) {
  const dir = getSnapshotsDir()
  const today = path.join(dir, `snapshot-${dayStamp()}.json`)
  const haveToday = await exists(today)
  const recent = Date.now() - status.lastSnapshotAt < SNAPSHOT_MIN_INTERVAL_MS
  if (haveToday && (changedCount === 0 || recent)) return
  try {
    await fs.mkdir(dir, { recursive: true })
    await writeJsonAtomic(today, await buildBundle(), 'Nu s-a putut scrie snapshot-ul.')
    status.lastSnapshotAt = Date.now()
    const all = (await listFiles(dir)).filter((n) => /^snapshot-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort()
    for (const old of all.slice(0, Math.max(0, all.length - SNAPSHOT_KEEP))) {
      await fs.unlink(path.join(dir, old)).catch(() => {})
    }
  } catch (err) {
    log.warn('[backup] snapshot esuat', err)
  }
}

// Export manual (ex: pe stick USB): un singur fisier cu tot.
export async function exportBackup(destFile) {
  await ensureDirs()
  if (typeof destFile !== 'string' || !destFile.trim()) throw new AppError('INVALID_PATH', 'Cale invalidă.')
  const bundle = await buildBundle()
  await writeJsonAtomic(destFile, bundle, 'Nu s-a putut scrie fișierul de backup.')
  return { path: destFile, fise: Object.keys(bundle.fise).length, drafturi: Object.keys(bundle.drafturi).length }
}

const looksLikeFisa = (f) => f && typeof f === 'object' && !Array.isArray(f) && f.client && f.auto

// Restaurare din fisier de backup: adauga doar ce LIPSESTE. Nu suprascrie
// niciodata o fisa existenta (una diferita e numarata ca "conflict" si lasata
// neatinsa) - o restaurare gresita nu poate strica datele curente.
export function importBackup(srcFile) {
  return runExclusive('fise-write', async () => {
    await ensureDirs()
    let stat
    try {
      stat = await fs.stat(srcFile)
    } catch (err) {
      throw toAppError(err, 'Fișierul de backup nu a putut fi citit.')
    }
    if (!stat.isFile() || stat.size > BUNDLE_MAX_BYTES) {
      throw new AppError('BAD_BACKUP', 'Fișierul ales nu este un backup valid.')
    }
    const res = await readJson(srcFile)
    const b = res.value
    if (!res.ok || b.format !== BUNDLE_FORMAT || typeof b.fise !== 'object' || !b.fise) {
      throw new AppError('BAD_BACKUP', 'Fișierul ales nu este un backup Service Auto valid.')
    }

    // Fise sterse (in coș) sau redenumite prin editare NU se readuc dintr-un
    // backup vechi: nume in trash = ignorat; acelasi nr deja folosit = conflict.
    const trashBases = new Set(
      (await listFiles(getTrashDir())).map((n) => parseTrashName(n)?.base).filter(Boolean)
    )
    const currentFise = await readJsonDir(getFiseDir())
    const usedNr = new Set(Object.values(currentFise).map((f) => f?.nr).filter(Boolean))

    const result = { fiseInCos: 0, fiseRestaurate: 0, fiseIdentice: 0, conflicte: 0, drafturiRestaurate: 0, invalide: 0, setariRestaurate: false }

    const restoreMap = async (map, dir, counters) => {
      await fs.mkdir(dir, { recursive: true })
      for (const [name, value] of Object.entries(map || {})) {
        try {
          assertSafeId(name)
        } catch {
          result.invalide++
          continue
        }
        if (!looksLikeFisa(value)) {
          result.invalide++
          continue
        }
        const target = path.join(dir, `${name}.json`)
        if (counters.compare && trashBases.has(name) && !(await exists(target))) {
          result.fiseInCos++
        } else if (counters.compare && !(await exists(target)) && value.nr && usedNr.has(value.nr)) {
          result.conflicte++
        } else if (!(await exists(target))) {
          await writeJsonAtomic(target, value)
          result[counters.ok]++
        } else if (counters.compare) {
          const cur = await readJson(target)
          if (cur.ok && JSON.stringify(cur.value) === JSON.stringify(value)) result.fiseIdentice++
          else result.conflicte++
        }
      }
    }
    try {
      await restoreMap(b.fise, getFiseDir(), { ok: 'fiseRestaurate', compare: true })
      await restoreMap(b.drafturi, getDraftsDir(), { ok: 'drafturiRestaurate' })

      if (b.setari && typeof b.setari === 'object') {
        const cur = await readJson(getSettingsPath())
        const empty = !cur.ok || Object.values(cur.value).every((v) => !String(v || '').trim())
        if (empty) {
          await writeJsonAtomic(getSettingsPath(), b.setari)
          result.setariRestaurate = true
        }
      }
    } finally {
      // Si la o restaurare intrerupta (disc plin) cache-urile trebuie reincarcate.
      invalidateAllCaches()
    }
    scheduleBackup(500)
    log.warn('[backup] restaurare din fisier', result)
    return result
  })
}

export async function getBackupStatus() {
  await ensureDirs()
  const snaps = []
  for (const n of (await listFiles(getSnapshotsDir())).filter((x) => x.startsWith('snapshot-') && x.endsWith('.json'))) {
    try {
      const st = await fs.stat(path.join(getSnapshotsDir(), n))
      snaps.push({ name: n, size: st.size, modifiedAt: st.mtime.toISOString() })
    } catch {
      /* dispare intre timp - ignoram */
    }
  }
  snaps.sort((a, b) => b.name.localeCompare(a.name))
  return {
    lastBackupAt: status.lastBackupAt,
    lastError: status.lastError,
    snapshots: snaps,
    safetyDir: getSafetyBackupDir(),
    // Cel mai recent snapshot - restaurabil cu "Restaurează din fișier".
    latestSnapshotPath: snaps[0] ? path.join(getSnapshotsDir(), snaps[0].name) : null
  }
}

// Backup declansat dupa o finalizare, cu debounce.
let timer = null
export function scheduleBackup(delayMs = 5000) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    backupNow().catch((err) => log.warn('[backup] dupa modificare esuat', err))
  }, delayMs)
}

// La inchiderea aplicatiei: daca un backup era programat, il rulam acum -
// altfel o fisa finalizata cu <5s inainte de inchidere ar lipsi din backup.
export async function flushBackup() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  try {
    await backupNow()
  } catch {
    /* deja logat */
  }
}

export function _resetBackupStateForTests() {
  if (timer) clearTimeout(timer)
  timer = null
  Object.assign(status, { lastBackupAt: null, lastError: null, lastSnapshotAt: 0 })
}
