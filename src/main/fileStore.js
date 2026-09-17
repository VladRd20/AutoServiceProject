import { app } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import log from './logger'
import { toAppError, AppError } from './errors'
import { foldForMatch, calcTotaluri, calcLinieTotal, round2 } from '../shared/calculations'
import { SEED_MARCI_MODELE, SEED_PIESE, SEED_LUCRARI } from '../shared/seedData'
import { getDataPathOverride, setDataPathOverride } from './appConfig'

// Locatia implicita: folderul "date" langa aplicatie (portabil, usor de gasit
// si de facut backup manual) - in dev, langa proiect; in build, langa exe.
// Configurabila din Setari - daca utilizatorul a ales explicit alt folder,
// acela are prioritate (vezi getDataPathOverride).
export function getDefaultDataPath() {
  const root = app.isPackaged ? path.dirname(process.execPath) : app.getAppPath()
  return path.join(root, 'date')
}

// Daca acel folder nu e scriptibil (ex: aplicatia instalata in Program Files
// fara drepturi de admin), revenim automat la folderul de date standard al
// utilizatorului (AppData), ca aplicatia sa functioneze oricum.
function primaryDir() {
  return getDataPathOverride() || getDefaultDataPath()
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

export function getCurrentDataPath() {
  return resolvedBaseDir
}

// Schimba folderul de date catre o locatie aleasa explicit de utilizator.
// Copiaza (nu muta) fisele/drafturile/backup-ul/setarile existente in noua
// locatie inainte sa comute pointer-ul - originalul ramane intact, ca sa nu
// existe niciun risc de pierdere daca ceva merge prost la copiere.
export async function changeDataPath(newBasePath) {
  await ensureDirs()
  const oldBase = resolvedBaseDir
  const resolvedNew = path.resolve(newBasePath)

  if (path.resolve(oldBase) === resolvedNew) {
    return { changed: false, path: oldBase }
  }

  try {
    await tryUseDir(resolvedNew)
  } catch (err) {
    throw toAppError(err, 'Folderul ales nu este scriptibil. Alege alt folder.')
  }

  try {
    await fs.cp(oldBase, resolvedNew, { recursive: true, force: false, errorOnExist: false })
  } catch (err) {
    throw toAppError(err, 'Copierea datelor existente in noul folder a esuat. Nimic nu a fost schimbat.')
  }

  setDataPathOverride(resolvedNew)
  resolvedBaseDir = resolvedNew
  usingFallback = false
  baseDirPromise = Promise.resolve(resolvedNew)
  dirsEnsured = false

  log.info(`[fileStore] folder de date schimbat: ${oldBase} -> ${resolvedNew}`)
  return { changed: true, path: resolvedNew, oldPath: oldBase }
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

// Date pentru auto-completare: marci/modele si denumiri de piese/lucrari
// deja folosite, extrase din fisele finalizate - nu e o baza de date externa,
// se "invata" din ce a introdus deja service-ul, si e mereu la zi cu ce
// lucreaza efectiv atelierul respectiv.
export async function getAutocompleteData() {
  await ensureDirs()
  const all = await readAllFiseFinalizate()

  const marci = new Map() // cheie lowercase -> denumire originala
  const modelePerMarca = {} // cheie lowercase marca -> Set de modele
  const piese = new Map() // cheie lowercase denumire -> { denumire, pretUnitar, finalizedAt }
  const lucrari = new Map()

  // Pornim de la setul de baza (piata din Romania) - istoricul real, de mai
  // jos, il suprascrie mereu pe acesta (finalizedAt gol pierde in fata
  // oricarei fise reale, vezi comparatia din upsertItem).
  for (const [marca, modele] of Object.entries(SEED_MARCI_MODELE)) {
    const marcaKey = foldForMatch(marca)
    marci.set(marcaKey, marca)
    modelePerMarca[marcaKey] = new Set(modele)
  }
  for (const denumire of SEED_PIESE) {
    piese.set(foldForMatch(denumire), { denumire, finalizedAt: '' })
  }
  for (const denumire of SEED_LUCRARI) {
    lucrari.set(foldForMatch(denumire), { denumire, finalizedAt: '' })
  }

  function upsertItem(map, denumireRaw, pretRaw, finalizedAt, priceKey) {
    const denumire = denumireRaw?.trim()
    if (!denumire) return
    const key = foldForMatch(denumire)
    const existing = map.get(key)
    if (!existing || (finalizedAt || '') > (existing.finalizedAt || '')) {
      map.set(key, { denumire, [priceKey]: pretRaw, finalizedAt })
    }
  }

  for (const fisa of all) {
    const marca = fisa.auto?.marca?.trim()
    const model = fisa.auto?.model?.trim()
    if (marca) {
      const marcaKey = foldForMatch(marca)
      if (!marci.has(marcaKey)) marci.set(marcaKey, marca)
      if (model) {
        if (!modelePerMarca[marcaKey]) modelePerMarca[marcaKey] = new Set()
        modelePerMarca[marcaKey].add(model)
      }
    }

    for (const p of fisa.piese || []) upsertItem(piese, p.denumire, p.pretUnitar, fisa.finalizedAt, 'pretUnitar')
    for (const l of fisa.lucrari || []) upsertItem(lucrari, l.denumire, l.pret, fisa.finalizedAt, 'pret')
  }

  return {
    marci: [...marci.values()].sort((a, b) => a.localeCompare(b)),
    modelePerMarca: Object.fromEntries(
      Object.entries(modelePerMarca).map(([k, set]) => [k, [...set].sort((a, b) => a.localeCompare(b))])
    ),
    piese: [...piese.values()].sort((a, b) => a.denumire.localeCompare(b.denumire)),
    lucrari: [...lucrari.values()].sort((a, b) => a.denumire.localeCompare(b.denumire))
  }
}

function fisaHaystack(fisa) {
  return foldForMatch(
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
  const q = foldForMatch(query).trim()
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

// Setarile firmei (nume, adresa, telefon, CUI/IDNO) - afisate pe PDF, langa
// datele clientului. Salvate in date/ (portabile odata cu restul datelor de
// business), nu in profilul Windows.
const DEFAULT_SETTINGS = { numeService: '', adresa: '', telefon: '', cui: '' }

function settingsFilePath() {
  return path.join(resolvedBaseDir, 'setari.json')
}

export async function getSettings() {
  await ensureDirs()
  try {
    const raw = await fs.readFile(settingsFilePath(), 'utf-8')
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function saveSettings(settings) {
  await ensureDirs()
  const merged = { ...DEFAULT_SETTINGS, ...settings }
  await writeJsonAtomic(settingsFilePath(), merged)
  return merged
}

// Toate fisele finalizate pentru un numar de inmatriculare exact - "ce s-a
// mai facut la masina asta" inainte de a incepe o lucrare noua.
export async function getVehicleHistory(nrInmatriculare) {
  await ensureDirs()
  const key = foldForMatch(nrInmatriculare)
  if (!key) return []
  const all = await readAllFiseFinalizate()
  return all
    .filter((f) => foldForMatch(f.auto?.nrInmatriculare) === key)
    .sort((a, b) => (b.finalizedAt || '').localeCompare(a.finalizedAt || ''))
}

function periodStart(period) {
  const start = new Date()
  if (period === 'azi') {
    start.setHours(0, 0, 0, 0)
  } else if (period === 'saptamana') {
    const zi = (start.getDay() + 6) % 7 // luni = 0
    start.setDate(start.getDate() - zi)
    start.setHours(0, 0, 0, 0)
  } else if (period === 'luna') {
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
  } else {
    return null // 'tot' - fara filtrare de data
  }
  return start
}

// Raport simplu: total incasat si cele mai cerute piese/lucrari intr-o
// perioada. Calculat din fisele finalizate, nu tinut separat - mereu
// consistent cu ce s-a salvat efectiv.
export async function getRapoarte(period) {
  await ensureDirs()
  const all = await readAllFiseFinalizate()
  const start = periodStart(period)
  const filtered = start ? all.filter((f) => f.finalizedAt && new Date(f.finalizedAt) >= start) : all

  let totalIncasat = 0
  const pieseMap = new Map()
  const lucrariMap = new Map()

  function upsertAgregat(map, denumireRaw, cantitate, valoare) {
    const denumire = denumireRaw?.trim()
    if (!denumire) return
    const key = foldForMatch(denumire)
    const entry = map.get(key) || { denumire, count: 0, valoare: 0 }
    entry.count += Number(cantitate) || 0
    entry.valoare = round2(entry.valoare + valoare)
    map.set(key, entry)
  }

  for (const fisa of filtered) {
    const t = calcTotaluri(fisa.piese, fisa.lucrari, fisa.reducerePercent)
    totalIncasat += t.totalFinal
    for (const p of fisa.piese || []) {
      upsertAgregat(pieseMap, p.denumire, p.cantitate, calcLinieTotal(p.cantitate, p.pretUnitar))
    }
    for (const l of fisa.lucrari || []) {
      upsertAgregat(lucrariMap, l.denumire, l.cantitate, calcLinieTotal(l.cantitate, l.pret))
    }
  }

  return {
    numarFise: filtered.length,
    totalIncasat: round2(totalIncasat),
    topPiese: [...pieseMap.values()].sort((a, b) => b.count - a.count).slice(0, 5),
    topLucrari: [...lucrariMap.values()].sort((a, b) => b.count - a.count).slice(0, 5)
  }
}

export { AppError }
