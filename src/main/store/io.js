import path from 'path'
import fs from 'fs/promises'
import { toAppError, AppError } from '../errors'

export function tmpSuffix() {
  return `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export const isTmpName = (name) => name.includes('.tmp-')

export function sanitizeSegment(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

// Un id/nume de fisier vine mereu din cod (draft-<ts>-<rnd> sau nume de fisa
// calculat), niciodata text liber - dar il validam oricum strict inainte sa
// intre intr-o cale: apararea in adancime, ca un id neasteptat sa nu poata
// iesi din folderul de date.
export function assertSafeId(id) {
  if (
    !/^[\w-]+$/.test(String(id || '')) ||
    String(id).length > 128 ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(String(id))
  ) {
    throw new AppError('INVALID_ID', 'Identificator de fișă invalid.')
  }
}

// Punct de injectare de erori DOAR pentru teste (in productie ramane null).
export const faults = { beforeRename: null }
const renameFile = (from, to) => {
  faults.beforeRename?.(from, to)
  return fs.rename(from, to)
}

const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES', 'EMFILE', 'ENFILE'])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Pe Windows, antivirusul/indexerul poate tine scurt un fisier deschis si
// rename/unlink esueaza cu EPERM/EBUSY - o reincercare scurta rezolva de
// obicei, in loc sa piarda o salvare.
export async function withRetry(fn, attempts = 4) {
  let last
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      last = err
      if (!TRANSIENT.has(err?.code) || i === attempts - 1) throw err
      await sleep(40 * (i + 1))
    }
  }
  throw last
}

// Scriere atomica + durabila: tmp -> fsync -> rename. Fara fsync, o cadere de
// curent imediat dupa rename poate lasa un fisier gol/trunchiat pe disc.
export async function writeJsonAtomic(filePath, data, failMessage = 'Nu s-a putut salva fișa pe disc.') {
  const tmpPath = `${filePath}${tmpSuffix()}`
  try {
    const handle = await fs.open(tmpPath, 'w')
    try {
      await handle.writeFile(JSON.stringify(data, null, 2), 'utf-8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await withRetry(() => renameFile(tmpPath, filePath))
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {})
    throw toAppError(err, failMessage)
  }
}

// Copie atomica (pentru backup): un crash la mijlocul copierii nu lasa un
// fisier trunchiat sub numele final - doar un .tmp- orfan, ignorat si curatat.
export async function copyFileAtomic(src, dest) {
  const tmp = `${dest}${tmpSuffix()}`
  try {
    await fs.copyFile(src, tmp)
    await withRetry(() => renameFile(tmp, dest))
  } catch (err) {
    await fs.unlink(tmp).catch(() => {})
    throw err
  }
}

// rename; daca sursa/destinatia sunt pe volume diferite (EXDEV) - copie+stergere.
export async function moveFile(src, dest) {
  try {
    await withRetry(() => renameFile(src, dest))
  } catch (err) {
    if (err.code !== 'EXDEV') throw err
    await copyFileAtomic(src, dest)
    await fs.unlink(src)
  }
}

export async function exists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

// Citeste + parseaza un JSON. Returneaza { ok, value } / { ok:false, empty, error }.
export async function readJson(filePath) {
  let raw
  try {
    raw = await withRetry(() => fs.readFile(filePath, 'utf-8'))
  } catch (error) {
    // Eroare de citire (nu de CONTINUT): fisierul e probabil bun, doar
    // temporar inaccesibil (antivirus, prea multe handle-uri) - NU e corupere.
    return { ok: false, missing: error.code === 'ENOENT', transient: error.code !== 'ENOENT', error }
  }
  if (!raw.trim()) return { ok: false, empty: true, error: new Error('fisier gol') }
  try {
    const value = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: new Error('continut JSON neasteptat') }
    }
    return { ok: true, value }
  } catch (error) {
    return { ok: false, error }
  }
}

// Ruleaza `fn` pe elemente cu cel mult `limit` operatii de disc simultane.
export async function mapLimit(items, limit, fn) {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      await fn(items[idx], idx)
    }
  })
  await Promise.all(workers)
}

// Coada pe cheie: operatiile cu aceeasi cheie ruleaza strict una dupa alta
// (ordinea de apel), cele cu chei diferite in paralel. Previne ca doua scrieri
// pe acelasi fisier sa se termine in ordine inversa (cea veche castiga).
const queues = new Map()
export function runExclusive(key, fn) {
  const prev = queues.get(key) || Promise.resolve()
  const next = prev.catch(() => {}).then(fn)
  const tail = next.catch(() => {})
  queues.set(key, tail)
  tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key)
  })
  return next
}

export async function listFiles(dir) {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name)
  } catch {
    return []
  }
}

export async function dirEntryCount(dir) {
  try {
    return (await fs.readdir(dir)).length
  } catch {
    return 0
  }
}

export const joinp = path.join
