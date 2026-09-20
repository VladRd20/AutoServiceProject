import path from 'path'
import fs from 'fs/promises'
import log from '../logger'
import { toAppError, AppError } from '../errors'
import { foldForMatch } from '../../shared/calculations'
import { fisaDay, hasRange, inRange, normalizeRange } from '../../shared/dateRange'
import { migrateFisa, SCHEMA_VERSION } from '../../shared/schema'
import { SEED_MARCI_MODELE, SEED_PIESE, SEED_LUCRARI } from '../../shared/seedData'
import {
  assertSafeId,
  exists,
  isTmpName,
  listFiles,
  mapLimit,
  moveFile,
  readJson,
  runExclusive,
  sanitizeSegment,
  writeJsonAtomic,
  copyFileAtomic,
  withRetry
} from './io'
import { readJsonHealing } from './integrity'
import {
  ensureDirs,
  getBackupDir,
  getCounterPath,
  getFiseDir,
  getHistoryDirs,
  getSafetyBackupDir,
  getTrashDir,
  parseTrashName,
  registerInvalidator
} from './paths'
import { scheduleBackup } from './backup'
import { deleteDraft } from './drafts'

// Data/ora LOCALA in format ISO fara sufix de fus orar ("2026-09-18T00:30:00").
// toISOString() e mereu UTC - intre 00:00 si ora offset-ului local, data din
// numele fisierului/PDF ar fi iesit cu o zi in urma.
export function toLocalISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function formatDataFilename(dataISO) {
  const [y, m, d] = String(dataISO).slice(0, 10).split('-')
  if (!y || !m || !d) return sanitizeSegment(dataISO)
  return `${d}-${m}-${y}`
}

export function fisaBaseName(fisa) {
  const nr = sanitizeSegment(fisa?.auto?.nrInmatriculare) || 'FARA-NR'
  const data = formatDataFilename(fisa?.data) || sanitizeSegment(fisa?.data) || 'FARA-DATA'
  return `${nr}_${data}`
}

// ---------------------------------------------------------------- cache ----
// Cache in memorie al tuturor fiselor finalizate (Map nume-fisier -> fisa).
// Populat lazy; scrierile il actualizeaza INCREMENTAL, doar schimbarea
// folderului de date il invalideaza complet.
let fiseMap = null
let fiseLoad = null
let fiseList = null
// Creste la fiecare modificare/invalidare - o incarcare in curs care termina
// DUPA o modificare concurenta ar publica un snapshot deja invechit.
let fiseGen = 0
let fiseVersion = 0
let autocompleteMemo = null

export function invalidateFiseCache() {
  fiseMap = null
  fiseLoad = null
  fiseList = null
  fiseGen += 1
  fiseVersion += 1
  autocompleteMemo = null
}
registerInvalidator(invalidateFiseCache)

function touched() {
  fiseGen += 1
  fiseVersion += 1
  fiseList = null
  autocompleteMemo = null
}
function cacheUpsert(file, fisa) {
  touched()
  if (fiseMap) fiseMap.set(file, fisa)
}
function cacheRemove(file) {
  touched()
  if (fiseMap) fiseMap.delete(file)
}

export async function readAllFiseFinalizate() {
  for (let attempt = 0; attempt < 3 && !fiseMap; attempt++) {
    if (!fiseLoad) {
      const genAtStart = fiseGen
      const p = (async () => {
        let files
        try {
          files = (await fs.readdir(getFiseDir())).filter((f) => f.endsWith('.json') && !isTmpName(f))
        } catch (err) {
          throw toAppError(err, 'Nu s-a putut citi lista de fișe finalizate.')
        }
        const map = new Map()
        await mapLimit(files, 32, async (f) => {
          const res = await readJsonHealing(path.join(getFiseDir(), f), 'fise')
          if (res.ok) map.set(f, { ...migrateFisa(res.value), _file: f })
        })
        return map
      })()
      fiseLoad = p
      p.then(
        (map) => {
          if (fiseLoad === p && fiseGen === genAtStart) fiseMap = map
        },
        () => {
          if (fiseLoad === p) fiseLoad = null
        }
      )
    }
    const map = await fiseLoad
    if (!fiseMap) {
      fiseLoad = null
      if (attempt === 2) return [...map.values()]
    }
  }
  if (!fiseList) fiseList = [...fiseMap.values()]
  return fiseList
}

export function getFiseVersion() {
  return fiseVersion
}

export async function listFiseFinalizate() {
  await ensureDirs()
  try {
    return (await fs.readdir(getFiseDir())).filter((f) => f.endsWith('.json') && !isTmpName(f))
  } catch (err) {
    throw toAppError(err, 'Nu s-a putut citi lista de fișe finalizate.')
  }
}

// Citeste o fisa finalizata direct de pe disc (cu refacere din backup daca e corupta).
export async function readFisaByBaseName(baseName) {
  assertSafeId(baseName)
  await ensureDirs()
  const res = await readJsonHealing(path.join(getFiseDir(), `${baseName}.json`), 'fise')
  if (res.missing) throw new AppError('NOT_FOUND', 'Fișa nu a fost găsită pe disc.')
  if (!res.ok) throw new AppError('CORRUPT', 'Fișa este coruptă și nu a putut fi refăcută din backup.')
  return { ...migrateFisa(res.value), _file: `${baseName}.json` }
}

export function getPdfPath(baseName) {
  assertSafeId(baseName)
  return path.join(getFiseDir(), `${baseName}.pdf`)
}

// ------------------------------------------------------------ mirrors -----
function mirrorRoots() {
  return [path.join(getBackupDir(), 'mirror'), getSafetyBackupDir()]
}

// O fisa stearsa/redenumita intentionat trebuie scoasa si din backup, altfel
// vindecarea automata de la pornire (paths.js) ar readuce-o. Recuperarea ei
// ramane posibila din trash/ (stergere) sau history/ (editare).
// Ruleaza in coada backup-ului: un backup aflat in curs ar putea copia fisa
// (listata inainte de mutare) DUPA ce am scos-o din oglinzi, readucand-o.
function removeFromMirrors(baseName) {
  return runExclusive('backup', async () => {
    for (const root of mirrorRoots()) {
      for (const ext of ['.json', '.pdf']) {
        const p = path.join(root, 'fise', `${baseName}${ext}`)
        try {
          await withRetry(() => fs.unlink(p))
        } catch (err) {
          if (err.code !== 'ENOENT') log.warn(`[fise] nu s-a putut scoate ${p} din backup`, err)
        }
      }
    }
  })
}

// Pastreaza versiunea INAINTE de suprascriere (fluxul "Editeaza"): 2 copii
// independente. Doar daca ambele esueaza, editarea se opreste - nu suprascriem
// singura copie a unei facturi deja emise.
async function archiveVersion(baseName) {
  const src = path.join(getFiseDir(), `${baseName}.json`)
  if (!(await exists(src))) return
  const stamp = Date.now()
  let ok = 0
  for (const dir of getHistoryDirs()) {
    try {
      await fs.mkdir(dir, { recursive: true })
      await copyFileAtomic(src, path.join(dir, `${baseName}__${stamp}.json`))
      ok++
    } catch (err) {
      log.warn(`[fise] arhivare versiune in ${dir} esuata`, err)
    }
  }
  if (ok === 0) throw new AppError('ARCHIVE_FAILED', 'Nu s-a putut păstra versiunea anterioară a fișei. Nimic nu a fost modificat.')
}

// -------------------------------------------------------- numbering -------
const NR_RE = /^(\d{4})-(\d{4,})$/

async function maxNrForYear(year) {
  let max = 0
  const consider = (nr) => {
    const m = typeof nr === 'string' ? NR_RE.exec(nr) : null
    if (m && Number(m[1]) === year) max = Math.max(max, Number(m[2]))
  }
  for (const f of await readAllFiseFinalizate()) consider(f.nr)
  // Numerele fiselor sterse (in trash) NU se refolosesc - continuitatea
  // numerotarii unui document emis conteaza chiar daca fisa a fost stearsa.
  const trashFiles = (await listFiles(getTrashDir())).filter((n) => n.endsWith('.json'))
  await mapLimit(trashFiles, 16, async (n) => {
    const r = await readJson(path.join(getTrashDir(), n))
    if (r.ok) consider(r.value.nr)
  })
  const counter = await readJson(getCounterPath())
  if (counter.ok) consider(`${year}-${String(counter.value[year] || 0).padStart(4, '0')}`)
  return max
}

async function nextNr(year) {
  const n = (await maxNrForYear(year)) + 1
  const nr = `${year}-${String(n).padStart(4, '0')}`
  const counter = await readJson(getCounterPath())
  const next = { ...(counter.ok ? counter.value : {}), [year]: n }
  await writeJsonAtomic(getCounterPath(), next).catch((err) => log.warn('[fise] contor nescris', err))
  return nr
}

// ------------------------------------------------------- finalize ---------
// Doua fise finalizate pentru aceeasi masina in aceeasi zi sunt legitime -
// fisaBaseName() produce acelasi nume; fara verificare a doua ar suprascrie
// silentios prima. Adaugam sufix numeric pana gasim un nume liber.
// excludeBaseName = fisa pe care o INLOCUIM efectiv (Editeaza): nu conteaza
// drept coliziune cu ea insasi.
async function uniqueFinalBaseName(baseName, excludeBaseName) {
  let candidate = baseName
  let n = 2
  for (;;) {
    if (candidate === excludeBaseName) return candidate
    if (!(await exists(path.join(getFiseDir(), `${candidate}.json`)))) return candidate
    candidate = `${baseName}-${n}`
    n++
  }
}

export function finalizeFisa(fisa, options = {}) {
  // Finalizarile/stergerile ruleaza una dupa alta: numarul de ordine si
  // numele de fisier nu pot fi alese de doua ori.
  return runExclusive('fise-write', () => doFinalize(fisa, options))
}

async function doFinalize(fisa, options) {
  await ensureDirs()
  const now = new Date()
  // Daca "Data curenta" e bifat, data folosita e data/ora exacta a finalizarii.
  let data = fisa.dataCurenta ? toLocalISO(now) : fisa.data
  const replaceBaseName = options.replaceBaseName || null
  if (replaceBaseName) assertSafeId(replaceBaseName)

  let original = null
  if (replaceBaseName) {
    const r = await readJsonHealing(path.join(getFiseDir(), `${replaceBaseName}.json`), 'fise')
    if (r.ok) original = r.value
    // Fisierul original EXISTA dar nu poate fi citit (corupt, refacere imposibila):
    // nu il tratam ca "fisa noua" (ar primi alt numar si originalul ar ramane orfan).
    else if (!r.missing) {
      throw new AppError('CORRUPT', 'Fișa originală nu poate fi citită. Editarea a fost oprită - nimic nu a fost modificat.')
    }
  }

  // O editare NU re-dateaza fisa: la "Data curenta" pastram data/ora originala
  // (altfel s-ar schimba si numele fisierului, si data de pe factura deja emisa).
  if (original?.data && fisa.dataCurenta) data = original.data

  const { nr: _ignoredNr, ...fisaFaraNr } = fisa
  const finalFisa = {
    ...fisaFaraNr,
    schemaVersion: SCHEMA_VERSION,
    data,
    status: 'finalizata',
    finalizedAt: now.toISOString()
  }
  // Numarul de ordine il decide DOAR main process: o fisa editata pastreaza
  // numarul originalului; una noua primeste urmatorul din an.
  if (original) {
    if (original.nr) finalFisa.nr = original.nr
  } else {
    finalFisa.nr = await nextNr(now.getFullYear())
  }

  const baseName = await uniqueFinalBaseName(fisaBaseName(finalFisa), original ? replaceBaseName : null)
  const jsonPath = path.join(getFiseDir(), `${baseName}.json`)

  if (original) await archiveVersion(replaceBaseName)
  await writeJsonAtomic(jsonPath, finalFisa)

  if (original && replaceBaseName !== baseName) {
    // Numele calculat s-a schimbat (nr. inmatriculare/data): scriem sub noul
    // nume, apoi scoatem fisele vechi ca sa nu ramana o fisa "fantoma".
    for (const ext of ['.json', '.pdf']) {
      await fs.unlink(path.join(getFiseDir(), `${replaceBaseName}${ext}`)).catch(() => {})
    }
    cacheRemove(`${replaceBaseName}.json`)
    await removeFromMirrors(replaceBaseName)
  }
  cacheUpsert(`${baseName}.json`, { ...finalFisa, _file: `${baseName}.json` })
  scheduleBackup()

  if (fisa.id) {
    try {
      await deleteDraft(fisa.id)
    } catch (err) {
      // Draftul ramas orfan nu e critic - fisa finala e deja salvata.
      log.warn('[fise] nu s-a putut sterge draftul dupa finalizare', err)
    }
  }

  return { jsonPath, baseName, fisa: finalFisa, replaced: Boolean(original) }
}

// ---------------------------------------------------------- trash ---------
// Sterge o fisa finalizata: o MUTA in trash/ (JSON + PDF), recuperabila 30 de
// zile (vezi paths.js housekeeping) - nu mai e o stergere ireversibila.
export function deleteFinalizedFisa(fileNameOrBaseName) {
  return runExclusive('fise-write', async () => {
    await ensureDirs()
    const baseName = String(fileNameOrBaseName || '').replace(/\.json$/, '')
    assertSafeId(baseName)
    const jsonPath = path.join(getFiseDir(), `${baseName}.json`)
    if (!(await exists(jsonPath))) {
      cacheRemove(`${baseName}.json`)
      return { trashId: null }
    }
    const stamp = Date.now()
    const trashId = `${baseName}__${stamp}`
    try {
      await moveFile(jsonPath, path.join(getTrashDir(), `${trashId}.json`))
    } catch (err) {
      throw toAppError(err, 'Nu s-a putut șterge fișa.')
    }
    try {
      await moveFile(path.join(getFiseDir(), `${baseName}.pdf`), path.join(getTrashDir(), `${trashId}.pdf`))
    } catch (err) {
      // PDF-ul se poate regenera din JSON - lipsa/blocarea lui nu opreste stergerea.
      // Un PDF ramas orfan ar fi servit ulterior in locul unei fise noi cu acelasi nume.
      if (err.code !== 'ENOENT') {
        log.warn(`[fise] PDF-ul ${baseName} nu a putut fi mutat in trash`, err)
        await fs.unlink(path.join(getFiseDir(), `${baseName}.pdf`)).catch(() => {})
      }
    }
    cacheRemove(`${baseName}.json`)
    await removeFromMirrors(baseName)
    return { trashId }
  })
}

export async function listTrash() {
  await ensureDirs()
  const files = (await listFiles(getTrashDir())).filter((n) => n.endsWith('.json'))
  const out = []
  await mapLimit(files, 16, async (n) => {
    const t = parseTrashName(n)
    if (!t) return
    const r = await readJson(path.join(getTrashDir(), n))
    const f = r.ok ? r.value : {}
    out.push({
      trashId: n.replace(/\.json$/, ''),
      base: t.base,
      deletedAt: new Date(t.ts).toISOString(),
      nr: f.nr || '',
      client: f.client?.nume || '',
      plate: f.auto?.nrInmatriculare || ''
    })
  })
  return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
}

export function restoreFromTrash(trashId) {
  return runExclusive('fise-write', async () => {
    await ensureDirs()
    assertSafeId(trashId)
    const t = parseTrashName(`${trashId}.json`)
    const src = path.join(getTrashDir(), `${trashId}.json`)
    if (!t || !(await exists(src))) throw new AppError('NOT_FOUND', 'Fișa nu mai există în coșul de gunoi.')
    if (!(await readJson(src)).ok) throw new AppError('CORRUPT', 'Fișa din coș este coruptă.')
    const baseName = await uniqueFinalBaseName(t.base, null)
    await moveFile(src, path.join(getFiseDir(), `${baseName}.json`))
    await moveFile(path.join(getTrashDir(), `${trashId}.pdf`), path.join(getFiseDir(), `${baseName}.pdf`)).catch(() => {})
    const r = await readJson(path.join(getFiseDir(), `${baseName}.json`))
    if (r.ok) cacheUpsert(`${baseName}.json`, { ...migrateFisa(r.value), _file: `${baseName}.json` })
    else invalidateFiseCache()
    scheduleBackup()
    return { baseName }
  })
}

// ------------------------------------------------------ autocomplete ------
// Date pentru auto-completare: marci/modele si denumiri de piese/lucrari
// deja folosite, extrase din fisele finalizate + un set de baza.
export async function getAutocompleteData() {
  await ensureDirs()
  const all = await readAllFiseFinalizate()
  if (autocompleteMemo && autocompleteMemo.version === fiseVersion) return autocompleteMemo.data
  const versionAtStart = fiseVersion

  const marci = new Map()
  const modelePerMarca = {}
  const piese = new Map()
  const lucrari = new Map()

  for (const [marca, modele] of Object.entries(SEED_MARCI_MODELE)) {
    const marcaKey = foldForMatch(marca)
    marci.set(marcaKey, marca)
    modelePerMarca[marcaKey] = new Set(modele)
  }
  for (const denumire of SEED_PIESE) piese.set(foldForMatch(denumire), { denumire, finalizedAt: '' })
  for (const denumire of SEED_LUCRARI) lucrari.set(foldForMatch(denumire), { denumire, finalizedAt: '' })

  function upsertItem(map, denumireRaw, pretRaw, finalizedAt, priceKey) {
    const denumire = typeof denumireRaw === 'string' ? denumireRaw.trim() : ''
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
    for (const p of Array.isArray(fisa.piese) ? fisa.piese : []) {
      upsertItem(piese, p?.denumire, p?.pretUnitar, fisa.finalizedAt, 'pretUnitar')
    }
    for (const l of Array.isArray(fisa.lucrari) ? fisa.lucrari : []) {
      upsertItem(lucrari, l?.denumire, l?.pret, fisa.finalizedAt, 'pret')
    }
  }

  const data = {
    marci: [...marci.values()].sort((a, b) => a.localeCompare(b)),
    modelePerMarca: Object.fromEntries(
      Object.entries(modelePerMarca).map(([k, set]) => [k, [...set].sort((a, b) => a.localeCompare(b))])
    ),
    piese: [...piese.values()].sort((a, b) => a.denumire.localeCompare(b.denumire)),
    lucrari: [...lucrari.values()].sort((a, b) => a.denumire.localeCompare(b.denumire))
  }
  if (fiseVersion === versionAtStart) autocompleteMemo = { version: versionAtStart, data }
  return data
}

// ---------------------------------------------------------- search --------
function fisaHaystack(fisa) {
  return foldForMatch(
    [
      fisa.nr,
      fisa.client?.nume,
      fisa.client?.telefon,
      fisa.client?.cui,
      fisa.auto?.nrInmatriculare,
      fisa.auto?.marca,
      fisa.auto?.model,
      fisa.auto?.vin
    ]
      .filter(Boolean)
      .join(' ')
  )
}

const SEARCH_MAX_RESULTS = 200
const byFinalizedDesc = (a, b) => (b.finalizedAt || '').localeCompare(a.finalizedAt || '')

// query gol + interval = toate fisele din interval; fara niciunul = nimic.
export async function searchFise(query, rangeIn) {
  await ensureDirs()
  const q = foldForMatch(query).trim()
  const range = normalizeRange(rangeIn)
  if (!q && !hasRange(range)) return []
  const all = await readAllFiseFinalizate()
  return all
    .filter((fisa) => (!q || fisaHaystack(fisa).includes(q)) && inRange(fisaDay(fisa), range))
    .sort(byFinalizedDesc)
    .slice(0, SEARCH_MAX_RESULTS)
}

export async function listRecentFise(limit = 8) {
  await ensureDirs()
  const n = Math.min(Math.max(Number(limit) || 8, 1), 50)
  const all = await readAllFiseFinalizate()
  return [...all].sort(byFinalizedDesc).slice(0, n)
}

// Cauta dupa VIN SAU numar de inmatriculare - o masina reinmatriculata isi
// schimba numarul, dar VIN-ul ramane; invers, VIN-ul lipseste adesea pe fise vechi.
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
    .sort(byFinalizedDesc)
}

export { AppError }
