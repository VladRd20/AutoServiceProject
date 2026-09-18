// Normalizare defensiva a fisei primite prin IPC, inainte sa ajunga pe disc.
// Renderer-ul e "de incredere" doar in mod normal - un bug sau un draft
// editat manual nu trebuie sa poata scrie obiecte uriase, campuri necunoscute
// sau tipuri gresite in fisierele de date. Pastram forma exacta pe care o
// produce UI-ul (inclusiv valori inca in curs de tastare, ex. "1." la
// cantitate), deci NU convertim la numere aici - asta face finalizeaza().
const MAX_TEXT = 200
const MAX_LINES = 300

const str = (v, max = MAX_TEXT) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max))

// Numerele pot veni ca sir (din <input>) sau numar; pastram doar text/numar
// scurt, nimic altceva (obiecte, array-uri, functii).
const scalar = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : str(v, 32))

function lines(list, priceKey) {
  if (!Array.isArray(list)) return []
  return list.slice(0, MAX_LINES).map((it) => ({
    id: str(it?.id, 64),
    denumire: str(it?.denumire),
    cantitate: scalar(it?.cantitate),
    [priceKey]: scalar(it?.[priceKey])
  }))
}

export function sanitizeFisa(fisa) {
  const f = fisa && typeof fisa === 'object' ? fisa : {}
  const out = {
    id: f.id == null ? null : str(f.id, 64),
    client: { nume: str(f.client?.nume), telefon: str(f.client?.telefon, 40) },
    auto: {
      nrInmatriculare: str(f.auto?.nrInmatriculare, 32),
      marca: str(f.auto?.marca, 64),
      model: str(f.auto?.model, 64),
      vin: str(f.auto?.vin, 32),
      an: scalar(f.auto?.an)
    },
    data: str(f.data, 40),
    dataCurenta: Boolean(f.dataCurenta),
    piese: lines(f.piese, 'pretUnitar'),
    lucrari: lines(f.lucrari, 'pret')
  }
  if (f.reducerePiesePercent !== undefined) out.reducerePiesePercent = scalar(f.reducerePiesePercent)
  if (f.reducereLucrariPercent !== undefined) out.reducereLucrariPercent = scalar(f.reducereLucrariPercent)
  if (f.reducerePercent !== undefined) out.reducerePercent = scalar(f.reducerePercent)
  if (f._replaceBaseName) out._replaceBaseName = str(f._replaceBaseName, 128)
  if (f.finalizedAt) out.finalizedAt = str(f.finalizedAt, 40)
  if (f.status) out.status = str(f.status, 16)
  return out
}
