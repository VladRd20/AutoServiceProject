// Normalizare defensiva a fisei primite prin IPC, inainte sa ajunga pe disc.
// Renderer-ul e "de incredere" doar in mod normal - un bug sau un draft
// editat manual nu trebuie sa poata scrie obiecte uriase, campuri necunoscute
// sau tipuri gresite in fisierele de date. Pastram forma exacta pe care o
// produce UI-ul (inclusiv valori inca in curs de tastare, ex. "1." la
// cantitate), deci NU convertim la numere aici - asta face finalizeaza().
//
// Truncarea de aici e doar plasa de siguranta: la finalizare, validateFisa()
// (shared/calculations.js) ruleaza pe fisa BRUTA si respinge textele/listele
// prea lungi cu un mesaj clar, ca nimic sa nu fie taiat in tacere.
import { LIMITS, PLATA_STATUS, PLATA_METODE } from '../shared/calculations'
import { SCHEMA_VERSION } from '../shared/schema'

const str = (v, max = LIMITS.text) =>
  typeof v === 'string' ? v.slice(0, max) : v == null || typeof v === 'object' ? '' : String(v).slice(0, max)

// Numerele pot veni ca sir (din <input>) sau numar; pastram doar text/numar
// scurt, nimic altceva (obiecte, array-uri, functii).
const scalar = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : str(v, 32))

function lines(list, priceKey) {
  if (!Array.isArray(list)) return []
  return list.slice(0, LIMITS.linii).map((it) => ({
    id: str(it?.id, 64),
    denumire: str(it?.denumire),
    cantitate: scalar(it?.cantitate),
    [priceKey]: scalar(it?.[priceKey])
  }))
}

const oneOf = (v, allowed) => (allowed.includes(v) ? v : '')

export function sanitizeFisa(fisa) {
  const f = fisa && typeof fisa === 'object' && !Array.isArray(fisa) ? fisa : {}
  const out = {
    schemaVersion: SCHEMA_VERSION,
    id: f.id == null || typeof f.id === 'object' ? null : str(f.id, 64),
    client: {
      nume: str(f.client?.nume),
      telefon: str(f.client?.telefon, LIMITS.telefon),
      cui: str(f.client?.cui, LIMITS.cui)
    },
    auto: {
      nrInmatriculare: str(f.auto?.nrInmatriculare, LIMITS.plate),
      marca: str(f.auto?.marca, LIMITS.marca),
      model: str(f.auto?.model, LIMITS.marca),
      vin: str(f.auto?.vin, LIMITS.vin),
      an: scalar(f.auto?.an)
    },
    km: scalar(f.km),
    observatii: str(f.observatii, LIMITS.observatii),
    plata: { status: oneOf(f.plata?.status, PLATA_STATUS), metoda: oneOf(f.plata?.metoda, PLATA_METODE) },
    data: str(f.data, 40),
    dataCurenta: Boolean(f.dataCurenta),
    piese: lines(f.piese, 'pretUnitar'),
    lucrari: lines(f.lucrari, 'pret')
  }
  if (f.reducerePiesePercent !== undefined) out.reducerePiesePercent = scalar(f.reducerePiesePercent)
  if (f.reducereLucrariPercent !== undefined) out.reducereLucrariPercent = scalar(f.reducereLucrariPercent)
  if (f.reducerePercent !== undefined) out.reducerePercent = scalar(f.reducerePercent)
  if (f._replaceBaseName) out._replaceBaseName = str(f._replaceBaseName, 128)
  if (f.nr) out.nr = str(f.nr, 20)
  if (f.finalizedAt) out.finalizedAt = str(f.finalizedAt, 40)
  if (f.status) out.status = str(f.status, 16)
  return out
}
