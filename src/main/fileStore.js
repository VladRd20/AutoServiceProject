import { app } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import fsSync from 'fs'
import log from './logger'
import { toAppError, AppError } from './errors'

// Locatia principala: folderul "date" langa aplicatie (portabil, usor de gasit
// si de facut backup manual) - in dev, langa proiect; in build, langa exe.
// Daca acel folder nu e scriptibil (ex: aplicatia instalata in Program Files
// fara drepturi de admin), revenim automat la folderul de date standard al
// utilizatorului (AppData), ca aplicatia sa functioneze oricum.
function primaryDir() {
  const root = app.isPackaged ? path.dirname(process.execPath) : app.getAppPath()
  return path.join(root, 'date')
}

function fallbackDir() {
  return app.getPath('userData')
}

let resolvedBaseDir = primaryDir()
let usingFallback = false

export function getFiseDir() {
  return path.join(resolvedBaseDir, 'fise')
}

export function getDraftsDir() {
  return path.join(resolvedBaseDir, 'drafturi')
}

export function getBackupDir() {
  return path.join(resolvedBaseDir, 'backup')
}

export function isUsingFallbackLocation() {
  return usingFallback
}

async function tryUseDir(dir) {
  await fs.mkdir(dir, { recursive: true })
  const testFile = path.join(dir, '.write-test')
  await fs.writeFile(testFile, 'ok')
  await fs.unlink(testFile)
}

export async function ensureDirs() {
  try {
    await tryUseDir(primaryDir())
    resolvedBaseDir = primaryDir()
    usingFallback = false
  } catch (err) {
    log.warn(
      `[fileStore] folderul "${primaryDir()}" nu e scriptibil, revin la folderul de date standard (AppData)`,
      err
    )
    resolvedBaseDir = fallbackDir()
    usingFallback = true
  }

  for (const dir of [getFiseDir(), getDraftsDir(), getBackupDir()]) {
    try {
      await fs.mkdir(dir, { recursive: true })
    } catch (err) {
      // Daca nu putem crea directoarele de baza nici in fallback, aplicatia nu
      // poate functiona - aruncam un AppError explicit, prins la nivel de UI la pornire.
      throw toAppError(err, 'Nu s-a putut crea folderul de date al aplicatiei.')
    }
  }
}

function sanitizeSegment(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function formatDataFilename(dataISO) {
  // dataISO: "YYYY-MM-DD" -> "DD-MM-YYYY" pentru numele fisierului
  const [y, m, d] = String(dataISO).split('-')
  if (!y || !m || !d) return sanitizeSegment(dataISO)
  return `${d}-${m}-${y}`
}

export function fisaBaseName(fisa) {
  const nr = sanitizeSegment(fisa?.auto?.nrInmatriculare) || 'FARA-NR'
  const data = formatDataFilename(fisa?.data) || sanitizeSegment(fisa?.data) || 'FARA-DATA'
  return `${nr}_${data}`
}

// Scriere atomica: scrie intr-un fisier temporar, apoi redenumeste.
// Evita fisiere corupte/trunchiate daca aplicatia crapa sau curentul pica la mijloc.
async function writeJsonAtomic(filePath, data) {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
  try {
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
    await fs.rename(tmpPath, filePath)
  } catch (err) {
    // curatam fisierul temporar daca a ramas in urma
    try {
      await fs.unlink(tmpPath)
    } catch {
      /* nu exista sau deja curatat - ignoram */
    }
    throw toAppError(err, 'Nu s-a putut salva fisa pe disc.')
  }
}

export async function saveDraft(fisa) {
  await ensureDirs()
  const id = fisa.id || `draft-${Date.now()}`
  const filePath = path.join(getDraftsDir(), `${id}.json`)
  await writeJsonAtomic(filePath, { ...fisa, id, status: 'draft' })
  return id
}

export async function loadDraft(id) {
  const filePath = path.join(getDraftsDir(), `${id}.json`)
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    throw toAppError(err, 'Nu s-a putut incarca fisa salvata.')
  }
}

export async function listDrafts() {
  await ensureDirs()
  try {
    const files = await fs.readdir(getDraftsDir())
    const drafts = []
    for (const f of files.filter((f) => f.endsWith('.json'))) {
      try {
        const raw = await fs.readFile(path.join(getDraftsDir(), f), 'utf-8')
        drafts.push(JSON.parse(raw))
      } catch (err) {
        // Un draft corupt individual nu trebuie sa blocheze lista intreaga -
        // il logam si il sarim.
        log.warn(`[fileStore] draft corupt sarit: ${f}`, err)
      }
    }
    return drafts.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  } catch (err) {
    throw toAppError(err, 'Nu s-a putut citi lista de fise in lucru.')
  }
}

export async function deleteDraft(id) {
  const filePath = path.join(getDraftsDir(), `${id}.json`)
  try {
    await fs.unlink(filePath)
  } catch (err) {
    if (err.code === 'ENOENT') return // deja sters, nu e o eroare
    throw toAppError(err, 'Nu s-a putut sterge fisa.')
  }
}

// Finalizeaza fisa: scrie JSON-ul definitiv in folderul de fise (nu drafturi)
// si returneaza calea, pentru a fi asociata cu PDF-ul generat separat.
export async function finalizeFisa(fisa) {
  await ensureDirs()
  const baseName = fisaBaseName(fisa)
  const jsonPath = path.join(getFiseDir(), `${baseName}.json`)
  const finalFisa = { ...fisa, status: 'finalizata', finalizedAt: new Date().toISOString() }
  await writeJsonAtomic(jsonPath, finalFisa)

  if (fisa.id) {
    try {
      await deleteDraft(fisa.id)
    } catch (err) {
      // Draftul ramas orfan nu e critic - fisa finala e deja salvata cu succes.
      log.warn('[fileStore] nu s-a putut sterge draftul dupa finalizare', err)
    }
  }

  return { jsonPath, baseName, fisa: finalFisa }
}

export function getPdfPath(baseName) {
  return path.join(getFiseDir(), `${baseName}.pdf`)
}

export async function listFiseFinalizate() {
  await ensureDirs()
  try {
    const files = await fs.readdir(getFiseDir())
    return files.filter((f) => f.endsWith('.json'))
  } catch (err) {
    throw toAppError(err, 'Nu s-a putut citi lista de fise finalizate.')
  }
}

// Backup simplu: copiaza folderul de fise intr-un subfolder datat.
// Fara dependinta de zip - copiere de fisiere, robusta si usor de inspectat manual.
export async function backupNow() {
  await ensureDirs()
  const stamp = new Date().toISOString().slice(0, 10)
  const dest = path.join(getBackupDir(), stamp)
  try {
    await fs.mkdir(dest, { recursive: true })
    const files = await fs.readdir(getFiseDir())
    for (const f of files) {
      await fs.copyFile(path.join(getFiseDir(), f), path.join(dest, f))
    }
    await pruneOldBackups()
    log.info(`[fileStore] backup realizat: ${dest} (${files.length} fisiere)`)
    return dest
  } catch (err) {
    // Backup-ul e o plasa de siguranta secundara - un esec aici nu trebuie sa
    // opreasca aplicatia, doar sa fie logat clar.
    log.error('[fileStore] backup esuat', err)
    throw toAppError(err, 'Backup-ul automat a esuat. Datele originale sunt intacte.')
  }
}

async function pruneOldBackups(days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const entries = await fs.readdir(getBackupDir(), { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const full = path.join(getBackupDir(), entry.name)
    const stat = fsSync.statSync(full, { throwIfNoEntry: false })
    if (stat && stat.mtimeMs < cutoff) {
      await fs.rm(full, { recursive: true, force: true }).catch((err) => {
        log.warn(`[fileStore] nu s-a putut sterge backup vechi ${full}`, err)
      })
    }
  }
}

export { AppError }
