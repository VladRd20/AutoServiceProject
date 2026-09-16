import { app } from 'electron'
import path from 'path'
import fs from 'fs/promises'
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
  // Nume unic per apel, ca doua verificari concurente sa nu-si stearga
  // reciproc fisierul de test (ar produce ENOENT fals-pozitiv la unlink).
  const testFile = path.join(dir, `.write-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await fs.writeFile(testFile, 'ok')
  await fs.unlink(testFile)
}

// Rezolvarea locatiei (primary vs fallback) se face o singura data per pornire
// a aplicatiei - toate apelurile concurente la ensureDirs() (listDrafts,
// saveDraft, etc, care pot porni aproape simultan la incarcarea UI-ului)
// asteapta acelasi rezultat, in loc sa ruleze fiecare propriul test de scriere.
let baseDirPromise = null

function resolveBaseDir() {
  if (!baseDirPromise) {
    baseDirPromise = (async () => {
      try {
        await tryUseDir(primaryDir())
        usingFallback = false
        return primaryDir()
      } catch (err) {
        log.warn(
          `[fileStore] folderul "${primaryDir()}" nu e scriptibil, revin la folderul de date standard (AppData)`,
          err
        )
        usingFallback = true
        return fallbackDir()
      }
    })()
  }
  return baseDirPromise
}

// ensureDirs() e apelat la inceputul aproape fiecarei operatii de fisier -
// odata ce directoarele exista cu succes intr-o rulare, nu mai are rost sa
// repetam cele 3 mkdir la fiecare apel (nu dispar singure in timpul rularii).
let dirsEnsured = false

export async function ensureDirs() {
  resolvedBaseDir = await resolveBaseDir()
  if (dirsEnsured) return

  for (const dir of [getFiseDir(), getDraftsDir(), getBackupDir()]) {
    try {
      await fs.mkdir(dir, { recursive: true })
    } catch (err) {
      // Daca nu putem crea directoarele de baza nici in fallback, aplicatia nu
      // poate functiona - aruncam un AppError explicit, prins la nivel de UI la pornire.
      throw toAppError(err, 'Nu s-a putut crea folderul de date al aplicatiei.')
    }
  }
  dirsEnsured = true
}

function sanitizeSegment(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function formatDataFilename(dataISO) {
  // dataISO poate fi "YYYY-MM-DD" (data aleasa manual) sau un ISO datetime
  // complet (data curenta) - in ambele cazuri primele 10 caractere sunt data.
  const [y, m, d] = String(dataISO).slice(0, 10).split('-')
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
  const now = new Date()
  // Daca "Data curenta" e bifat, data folosita in fisa/PDF e data si ora
  // exacta a finalizarii (Release), nu momentul in care a fost bifat checkbox-ul.
  const data = fisa.dataCurenta ? now.toISOString() : fisa.data
  const finalFisa = { ...fisa, data, status: 'finalizata', finalizedAt: now.toISOString() }
  const baseName = fisaBaseName(finalFisa)
  const jsonPath = path.join(getFiseDir(), `${baseName}.json`)
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

// Elimina diacriticele si normalizeaza case-ul, ca "Ștefan" sa fie gasit si
// cautand "stefan", iar "B-123-ABC" si "b123abc" sa se potriveasca.
function foldForSearch(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

// Citeste toate fisele finalizate de pe disc. Suficient de rapid pentru
// volumul unui singur service auto (sute-mii de fise) - o fisa corupta
// individual e logata si sarita, nu blocheaza restul.
async function readAllFiseFinalizate() {
  let files
  try {
    files = (await fs.readdir(getFiseDir())).filter((f) => f.endsWith('.json'))
  } catch (err) {
    throw toAppError(err, 'Nu s-a putut citi lista de fise finalizate.')
  }

  const result = []
  for (const f of files) {
    try {
      const raw = await fs.readFile(path.join(getFiseDir(), f), 'utf-8')
      result.push({ ...JSON.parse(raw), _file: f })
    } catch (err) {
      log.warn(`[fileStore] fisa finalizata corupta sarita: ${f}`, err)
    }
  }
  return result
}

function fisaHaystack(fisa) {
  return foldForSearch(
    [
      fisa.client?.nume,
      fisa.client?.telefon,
      fisa.auto?.nrInmatriculare,
      fisa.auto?.marca,
      fisa.auto?.model,
      fisa.auto?.vin
    ]
      .filter(Boolean)
      .join(' ')
  )
}

// Cauta in toate fisele finalizate dupa client, numar de inmatriculare,
// marca/model sau VIN.
export async function searchFise(query) {
  await ensureDirs()
  const q = foldForSearch(query).trim()
  if (!q) return []

  const all = await readAllFiseFinalizate()
  return all
    .filter((fisa) => fisaHaystack(fisa).includes(q))
    .sort((a, b) => (b.finalizedAt || '').localeCompare(a.finalizedAt || ''))
}

// Cele mai recente fise finalizate, pentru acces rapid din sidebar. Evitam
// sa citim si sa parsam continutul TUTUROR fiselor doar ca sa aflam care
// sunt cele mai noi N - presortam ieftin dupa data modificarii fisierului
// (fisele finalizate nu se mai modifica dupa scriere, deci mtime e un proxy
// de incredere pentru finalizedAt) si citim continutul doar pentru candidati.
export async function listRecentFise(limit = 8) {
  await ensureDirs()

  let files
  try {
    files = (await fs.readdir(getFiseDir())).filter((f) => f.endsWith('.json'))
  } catch (err) {
    throw toAppError(err, 'Nu s-a putut citi lista de fise finalizate.')
  }

  const withMtime = await Promise.all(
    files.map(async (f) => {
      try {
        const stat = await fs.stat(path.join(getFiseDir(), f))
        return { f, mtimeMs: stat.mtimeMs }
      } catch {
        return { f, mtimeMs: 0 }
      }
    })
  )

  const candidates = withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit)

  const result = []
  for (const { f } of candidates) {
    try {
      const raw = await fs.readFile(path.join(getFiseDir(), f), 'utf-8')
      result.push({ ...JSON.parse(raw), _file: f })
    } catch (err) {
      log.warn(`[fileStore] fisa finalizata corupta sarita: ${f}`, err)
    }
  }

  return result.sort((a, b) => (b.finalizedAt || '').localeCompare(a.finalizedAt || ''))
}

// Backup: oglinda incrementala a folderului de fise, actualizata zilnic.
// Fisele finalizate nu se mai modifica dupa scriere, deci nu are rost sa
// copiem din nou fisierele deja backup-uite intr-un folder datat nou in
// fiecare zi (asta insemna, dupa 30 de zile, pana la 30x duplicare a
// aceluiasi continut) - copiem doar ce lipseste din oglinda.
export async function backupNow() {
  await ensureDirs()
  const dest = path.join(getBackupDir(), 'mirror')
  try {
    await fs.mkdir(dest, { recursive: true })
    const files = await fs.readdir(getFiseDir())
    let copiate = 0
    for (const f of files) {
      const destPath = path.join(dest, f)
      try {
        await fs.access(destPath)
      } catch {
        await fs.copyFile(path.join(getFiseDir(), f), destPath)
        copiate++
      }
    }
    log.info(`[fileStore] backup actualizat: ${dest} (${copiate} fisiere noi din ${files.length} totale)`)
    return dest
  } catch (err) {
    // Backup-ul e o plasa de siguranta secundara - un esec aici nu trebuie sa
    // opreasca aplicatia, doar sa fie logat clar.
    log.error('[fileStore] backup esuat', err)
    throw toAppError(err, 'Backup-ul automat a esuat. Datele originale sunt intacte.')
  }
}

export { AppError }
