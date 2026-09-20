import path from 'path'
import fs from 'fs/promises'
import { toAppError } from '../errors'
import { migrateFisa } from '../../shared/schema'
import { assertSafeId, isTmpName, mapLimit, runExclusive, writeJsonAtomic } from './io'
import { readJsonHealing } from './integrity'
import { ensureDirs, getDraftsDir, registerInvalidator } from './paths'

// Lista drafturilor tinuta in memorie (Map id -> draft): autosave-ul apeleaza
// listDrafts dupa fiecare salvare, iar recitirea tuturor fisierelor de fiecare
// data era inutila - singurul care scrie in folderul de drafturi e acest proces.
let cache = null
let load = null

export function invalidateDraftsCache() {
  cache = null
  load = null
}
registerInvalidator(invalidateDraftsCache)

async function loadCache() {
  if (cache) return cache
  if (!load) {
    const p = (async () => {
      const map = new Map()
      const files = (await fs.readdir(getDraftsDir())).filter((f) => f.endsWith('.json') && !isTmpName(f))
      await mapLimit(files, 32, async (f) => {
        const res = await readJsonHealing(path.join(getDraftsDir(), f), 'drafturi')
        if (res.ok) map.set(f.replace(/\.json$/, ''), migrateFisa(res.value))
      })
      return map
    })()
    load = p
    p.then(
      (map) => {
        if (load === p) cache = map
      },
      () => {
        if (load === p) load = null
      }
    )
  }
  return load
}

export async function saveDraft(fisa) {
  await ensureDirs()
  // Sufixul aleator evita coliziunea a doua drafturi create in aceeasi milisecunda.
  const id = fisa.id || `draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  assertSafeId(id)
  // Scrieri pe acelasi draft strict in ordinea apelului - altfel o salvare mai
  // veche, terminata dupa una mai noua, ar suprascrie-o cu date invechite.
  return runExclusive(`draft:${id}`, async () => {
    const draft = { ...fisa, id, status: 'draft', updatedAt: new Date().toISOString() }
    await writeJsonAtomic(path.join(getDraftsDir(), `${id}.json`), draft)
    if (cache) cache.set(id, draft)
    else load = null // o incarcare in curs ar putea sa nu includa aceasta salvare - nu o publicam
    return id
  })
}

export async function loadDraft(id) {
  assertSafeId(id)
  await ensureDirs()
  const res = await readJsonHealing(path.join(getDraftsDir(), `${id}.json`), 'drafturi')
  if (!res.ok) throw toAppError(res.error, 'Nu s-a putut încărca fișa salvată.')
  return migrateFisa(res.value)
}

export async function listDrafts() {
  await ensureDirs()
  try {
    const map = await loadCache()
    // Cel mai recent modificat primul; cele fara `updatedAt` la coada, dupa id.
    return [...map.values()].sort(
      (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') || (b.id || '').localeCompare(a.id || '')
    )
  } catch (err) {
    throw toAppError(err, 'Nu s-a putut citi lista de fișe în lucru.')
  }
}

export async function deleteDraft(id) {
  assertSafeId(id)
  await ensureDirs()
  await runExclusive(`draft:${id}`, async () => {
    try {
      await fs.unlink(path.join(getDraftsDir(), `${id}.json`))
    } catch (err) {
      if (err.code !== 'ENOENT') throw toAppError(err, 'Nu s-a putut șterge fișa.')
    }
    if (cache) cache.delete(id)
    else load = null
  })
}
