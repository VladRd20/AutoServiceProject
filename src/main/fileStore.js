import { app } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import log from './logger'
import { toAppError, AppError } from './errors'
import { foldForMatch, calcTotaluri, calcLinieTotal, round2, reduceriDinFisa } from '../shared/calculations'
import { SEED_MARCI_MODELE, SEED_PIESE, SEED_LUCRARI } from '../shared/seedData'
import { getDataPathOverride, setDataPathOverride } from './appConfig'

// Locatia implicita: folderul de date al utilizatorului (AppData), NU langa
// exe - un update auto (NSIS) dezinstaleaza intai versiunea veche, ceea ce
// sterge recursiv folderul de instalare. Orice fisier pus acolo (cum era
// "date" inainte, langa exe) disparea la fiecare update. AppData nu e
// atins niciodata de instalare/dezinstalare, doar de utilizator sau de un
// dezinstalare EXPLICITA cu "sterge si datele" - motiv pentru care license.dat
// (deja in AppData) a supravietuit updateurilor cand "date" nu a supravietuit.
// In dev, ramane langa proiect, ca sa nu se amestece cu instalari reale.
export function getDefaultDataPath() {
  if (!app.isPackaged) return path.join(app.getAppPath(), 'date')
  return path.join(app.getPath('userData'), 'date')
}

// Locatia veche (pre-fix), folosita de orice instalare care a pornit inainte
// de schimbarea de mai sus - migrata automat o singura data la pornire, ca
// niciun utilizator existent sa nu ramana pe vechea locatie nesigura.
function getLegacyDefaultDataPath() {
  if (!app.isPackaged) return null
  return path.join(path.dirname(process.execPath), 'date')
}

// Plasa de siguranta independenta: TOT in AppData, deci niciodata in aceeasi
// locatie cu folderul de date principal (implicit SAU ales manual din
// Setari) - daca acela dispare din orice motiv (update, antivirus, greseala
// umana, disc), backup-ul de aici nu dispare odata cu el.
export function getSafetyBackupDir() {
  return path.join(app.getPath('userData'), 'safety-backup')
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
let migratedFromLegacy = false
let recoveredFromSafetyBackup = false

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

// Adevarat o singura data, la pornirea in care s-a intamplat migrarea
// automata dinspre vechea locatie (langa exe) - vezi getLegacyDefaultDataPath.
export function isMigratedFromLegacy() {
  return migratedFromLegacy
}

// Adevarat o singura data, la pornirea in care s-a detectat ca folderul de
// date principal era gol desi exista un backup independent cu continut -
// semn ca ceva a sters datele principale, si au fost restaurate automat.
export function isRecoveredFromSafetyBackup() {
  return recoveredFromSafetyBackup
}

async function tryUseDir(dir) {
  await fs.mkdir(dir, { recursive: true })
  // Nume unic per apel, ca doua verificari concurente sa nu-si stearga
  // reciproc fisierul de test (ar produce ENOENT fals-pozitiv la unlink).
  const testFile = path.join(dir, `.write-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await fs.writeFile(testFile, 'ok')
  await fs.unlink(testFile)
}

async function dirEntryCount(dir) {
  try {
    const entries = await fs.readdir(dir)
    return entries.length
  } catch {
    return 0
  }
}

// Copiaza doar ce lipseste la destinatie - nu suprascrie si nu sterge
// niciodata nimic la sursa. Folosita atat pentru migrarea din vechea locatie,
// cat si pentru restaurarea din backup-ul de siguranta.
async function copyMissing(srcDir, destDir) {
  try {
    await fs.access(srcDir)
  } catch {
    return 0
  }
  await fs.mkdir(destDir, { recursive: true })
  let copiate = 0
  const entries = await fs.readdir(srcDir, { withFileTypes: true })
  for (const entry of entries) {
    const destPath = path.join(destDir, entry.name)
    try {
      await fs.access(destPath)
      continue // exista deja la destinatie - nu atingem
    } catch {
      // nu exista - copiem
    }
    if (entry.isDirectory()) {
      await fs.cp(path.join(srcDir, entry.name), destPath, { recursive: true, force: false, errorOnExist: false })
    } else {
      await fs.copyFile(path.join(srcDir, entry.name), destPath)
    }
    copiate++
  }
  return copiate
}

// Migrare + recuperare automata, o singura data per pornire, dupa ce
// directorul principal a fost rezolvat si creat:
//  1) daca foloseste locatia implicita NOUA si e goala, dar exista date la
//     vechea locatie (langa exe, de pe instalari mai vechi) - le copiaza.
//  2) daca fise+drafturi sunt AMBELE goale, dar backup-ul de siguranta
//     (independent, in AppData) are continut - il restaureaza. Asta prinde
//     orice cauza de disparitie (update, antivirus, stergere accidentala),
//     nu doar cazul specific de mai sus.
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
        try {
          await fs.copyFile(path.join(legacyBase, 'setari.json'), path.join(baseDir, 'setari.json'))
        } catch {
          // setari.json poate sa nu existe - nicio problema
        }
        if (n1 + n2 > 0) {
          migratedFromLegacy = true
          log.warn(
            `[fileStore] migrare automata din locatia veche (${legacyBase}) in locatia noua, sigura (${baseDir}): ${n1} fise, ${n2} drafturi`
          )
        }
      }
    }
  }

  const isEmpty = (await dirEntryCount(fiseDir)) === 0 && (await dirEntryCount(draftsDir)) === 0
  if (isEmpty) {
    const safetyDir = getSafetyBackupDir()
    const hasSafetyData =
      (await dirEntryCount(path.join(safetyDir, 'fise'))) > 0 ||
      (await dirEntryCount(path.join(safetyDir, 'drafturi'))) > 0
    if (hasSafetyData) {
      const n1 = await copyMissing(path.join(safetyDir, 'fise'), fiseDir)
      const n2 = await copyMissing(path.join(safetyDir, 'drafturi'), draftsDir)
      try {
        await fs.copyFile(path.join(safetyDir, 'setari.json'), path.join(baseDir, 'setari.json'))
      } catch {
        // setari.json poate sa nu existe in backup - nicio problema
      }
      recoveredFromSafetyBackup = true
      log.error(
        `[fileStore] ATENTIE: folderul principal de date era gol - restaurat automat din backup-ul de siguranta (${safetyDir}): ${n1} fise, ${n2} drafturi`
      )
    }
  }
}

// Rezolvarea locatiei (primary vs fallback) se face o singura data per pornire
// a aplicatiei - toate apelurile concurente la ensureDirs() (listDrafts,
// saveDraft, etc, care pot porni aproape simultan la incarcarea UI-ului)
// asteapta acelasi rezultat, in loc sa ruleze fiecare propriul test de scriere.
let baseDirPromise = null

function resolveBaseDir() {
  if (!baseDirPromise) {
    baseDirPromise = (async () => {
      let dir
      try {
        await tryUseDir(primaryDir())
        usingFallback = false
        dir = primaryDir()
      } catch (err) {
        log.warn(
          `[fileStore] folderul "${primaryDir()}" nu e scriptibil, revin la folderul de date standard (AppData)`,
          err
        )
        usingFallback = true
        dir = fallbackDir()
      }
      try {
        await migrateAndRecover(dir)
      } catch (err) {
        // Migrarea/recuperarea sunt masuri suplimentare - un esec aici nu
        // trebuie sa opreasca aplicatia, doar sa fie logat clar.
        log.error('[fileStore] migrare/recuperare automata esuata', err)
      }
      return dir
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
  invalidateFiseCache()

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

// Id-ul vine mereu din `draft-${Date.now()}` (vezi mai jos) sau de la un id
// deja salvat astfel - niciodata text liber introdus de utilizator. Validam
// oricum strict inainte sa-l punem intr-o cale de fisier: apararea in
// adancime nu costa nimic, iar un id neasteptat (bug viitor, fisa
// corupta/editata manual) nu trebuie sa poata iesi din folderul de drafturi.
function assertSafeId(id) {
  if (!/^[\w-]+$/.test(String(id || ''))) {
    throw new AppError('INVALID_ID', 'Identificator de fisa invalid.')
  }
}

export async function saveDraft(fisa) {
  await ensureDirs()
  const id = fisa.id || `draft-${Date.now()}`
  assertSafeId(id)
  const filePath = path.join(getDraftsDir(), `${id}.json`)
  await writeJsonAtomic(filePath, { ...fisa, id, status: 'draft' })
  return id
}

export async function loadDraft(id) {
  assertSafeId(id)
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
  assertSafeId(id)
  const filePath = path.join(getDraftsDir(), `${id}.json`)
  try {
    await fs.unlink(filePath)
  } catch (err) {
    if (err.code === 'ENOENT') return // deja sters, nu e o eroare
    throw toAppError(err, 'Nu s-a putut sterge fisa.')
  }
}

// Doua fise finalizate pentru aceeasi masina in aceeasi zi sunt un caz
// legitim (ex: schimb ulei dimineata + o reparatie separata dupa-amiaza,
// sau o corectie facuta in aceeasi zi) - fisaBaseName() produce acelasi
// nume pentru amandoua. Fara verificare, a doua finalizare ar suprascrie
// silentios JSON-ul SI PDF-ul primei fise, cu pierdere completa si
// ireversibila a facturii anterioare. Adaugam un sufix numeric pana gasim
// un nume liber, exact cum ar face orice "salveaza ca" de pe desktop.
//
// excludeBaseName e numele fisei pe care o INLOCUIM efectiv (fluxul
// "Editeaza" de pe o lucrare recenta) - acel nume nu conteaza drept coliziune
// cu el insusi, altfel re-finalizarea unei editari ar primi mereu un sufix
// nou in loc sa suprascrie fisa originala.
async function uniqueFinalBaseName(baseName, excludeBaseName) {
  let candidate = baseName
  let n = 2
  for (;;) {
    if (candidate === excludeBaseName) return candidate
    try {
      await fs.access(path.join(getFiseDir(), `${candidate}.json`))
      candidate = `${baseName}-${n}`
      n++
    } catch {
      return candidate
    }
  }
}

// Finalizeaza fisa: scrie JSON-ul definitiv in folderul de fise (nu drafturi)
// si returneaza calea, pentru a fi asociata cu PDF-ul generat separat.
//
// options.replaceBaseName: setat cand fisa vine din "Editeaza" pe o lucrare
// deja finalizata (vezi handleEditRecent in App.jsx) - in loc sa creeze o a
// doua fisa separata pentru aceeasi lucrare, refolosim acelasi nume de
// fisier (suprascriem JSON-ul si PDF-ul original cu versiunea editata). Daca
// intre timp s-au schimbat date care schimba numele calculat (nr.
// inmatriculare sau data), scriem sub noul nume si stergem fisierele vechi,
// ca sa nu ramana o fisa "fantoma" duplicata sub numele vechi.
export async function finalizeFisa(fisa, options = {}) {
  await ensureDirs()
  const now = new Date()
  // Daca "Data curenta" e bifat, data folosita in fisa/PDF e data si ora
  // exacta a finalizarii (Release), nu momentul in care a fost bifat checkbox-ul.
  const data = fisa.dataCurenta ? now.toISOString() : fisa.data
  const finalFisa = { ...fisa, data, status: 'finalizata', finalizedAt: now.toISOString() }
  const replaceBaseName = options.replaceBaseName || null
  if (replaceBaseName) assertSafeId(replaceBaseName)
  const baseName = await uniqueFinalBaseName(fisaBaseName(finalFisa), replaceBaseName)
  const jsonPath = path.join(getFiseDir(), `${baseName}.json`)
  await writeJsonAtomic(jsonPath, finalFisa)

  if (replaceBaseName && replaceBaseName !== baseName) {
    for (const ext of ['.json', '.pdf']) {
      try {
        await fs.unlink(path.join(getFiseDir(), `${replaceBaseName}${ext}`))
      } catch {
        // fisierul vechi poate sa nu mai existe (ex: deja sters de altundeva) - ignoram
      }
    }
  }
  invalidateFiseCache()

  if (fisa.id) {
    try {
      await deleteDraft(fisa.id)
    } catch (err) {
      // Draftul ramas orfan nu e critic - fisa finala e deja salvata cu succes.
      log.warn('[fileStore] nu s-a putut sterge draftul dupa finalizare', err)
    }
  }

  return { jsonPath, baseName, fisa: finalFisa, replaced: Boolean(replaceBaseName) }
}

export function getPdfPath(baseName) {
  assertSafeId(baseName)
  return path.join(getFiseDir(), `${baseName}.pdf`)
}

// Sterge definitiv o fisa finalizata (JSON + PDF) - spre deosebire de
// deleteDraft (o fisa in lucru, niciodata expusa clientului), asta sterge o
// factura deja emisa/printata. Confirmarea ramane responsabilitatea UI-ului
// (vezi App.jsx/confirmAction) - functia asta doar executa stergerea.
export async function deleteFinalizedFisa(fileNameOrBaseName) {
  await ensureDirs()
  const baseName = String(fileNameOrBaseName || '').replace(/\.json$/, '')
  assertSafeId(baseName)
  for (const ext of ['.json', '.pdf']) {
    try {
      await fs.unlink(path.join(getFiseDir(), `${baseName}${ext}`))
    } catch (err) {
      if (err.code !== 'ENOENT') throw toAppError(err, 'Nu s-a putut sterge fisa.')
    }
  }
  invalidateFiseCache()
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

// Cache in memorie a continutului tuturor fiselor finalizate - search/
// rapoarte/autocompletare/istoric vehicul il foloseau pe fiecare apel citind
// si parsand TOATE fisele de pe disc de fiecare data (bine la zeci-sute de
// fise, vizibil de incet dupa cativa ani de utilizare reala, cand ajung mii).
// Populat lazy la prima citire, invalidat explicit doar la scrierile care
// chiar schimba continutul folderului de fise (finalizeFisa, changeDataPath)
// - intre doua asemenea scrieri, orice numar de cautari/rapoarte refolosesc
// aceeasi lista deja citita, in loc sa rescaneze discul de fiecare data.
let _fiseFinalizateCache = null

function invalidateFiseCache() {
  _fiseFinalizateCache = null
}

// Citeste toate fisele finalizate de pe disc. Suficient de rapid pentru
// volumul unui singur service auto (sute-mii de fise) - o fisa corupta
// individual e logata si sarita, nu blocheaza restul.
async function readAllFiseFinalizate() {
  if (_fiseFinalizateCache) return _fiseFinalizateCache

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
  _fiseFinalizateCache = result
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
// Doua straturi de backup, actualizate incremental (doar ce lipseste, nu
// suprascrie nimic) la fiecare apel:
//  1) "mirror" local, langa datele principale - convenabil de gasit/copiat
//     manual, dar dispare odata cu ele daca folderul principal e sters.
//  2) "safety-backup", intotdeauna in AppData, complet independent de unde e
//     folderul principal (implicit sau ales de utilizator) - asta e plasa
//     reala de siguranta, si e cea folosita de migrateAndRecover() daca
//     folderul principal e vreodata gasit gol la pornire.
export async function backupNow() {
  await ensureDirs()
  const localMirror = path.join(getBackupDir(), 'mirror')
  const safetyDir = getSafetyBackupDir()
  try {
    let total = 0
    for (const dest of [localMirror, safetyDir]) {
      total += await copyMissing(getFiseDir(), path.join(dest, 'fise'))
      total += await copyMissing(getDraftsDir(), path.join(dest, 'drafturi'))
      try {
        await fs.copyFile(settingsFilePath(), path.join(dest, 'setari.json'))
      } catch {
        // setari.json poate sa nu existe inca - nicio problema
      }
    }
    log.info(`[fileStore] backup actualizat (local + safety-backup): ${total} fisiere noi copiate`)
    return safetyDir
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
// Cauta dupa VIN SAU numar de inmatriculare (oricare se potriveste) - o
// masina revanduta/reinmatriculata isi schimba numarul, dar VIN-ul ramane
// acelasi; invers, VIN-ul lipseste adesea pe fise mai vechi, dar numarul e
// aproape mereu completat. Impreuna acopera ambele cazuri.
export async function getVehicleHistory(vin, nrInmatriculare) {
  await ensureDirs()
  const vinKey = foldForMatch(vin)
  const nrKey = foldForMatch(nrInmatriculare)
  if (!vinKey && !nrKey) return []
  const all = await readAllFiseFinalizate()
  return all
    .filter(
      (f) =>
        (vinKey && foldForMatch(f.auto?.vin) === vinKey) ||
        (nrKey && foldForMatch(f.auto?.nrInmatriculare) === nrKey)
    )
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
    const reduceri = reduceriDinFisa(fisa)
    const t = calcTotaluri(fisa.piese, fisa.lucrari, reduceri.piese, reduceri.lucrari)
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
