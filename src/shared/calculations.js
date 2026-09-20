// Calcule pure, fara efecte secundare. Folosit atat in UI (recalcul live)
// cat si in main process (generare PDF), ca sursa unica de adevar.

function toNumber(value) {
  const n = typeof value === 'string' ? Number(value.trim().replace(',', '.')) : Number(value)
  return Number.isFinite(n) ? n : 0
}

export function calcLinieTotal(cantitate, pret) {
  return round2(toNumber(cantitate) * toNumber(pret))
}

export function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

// Elimina diacriticele si normalizeaza case-ul, ca "Ștefan"/"stefan" sau
// "Škoda"/"skoda" sa se potriveasca la cautare/auto-completare. Folosit atat
// pentru cheile de auto-completare (main) cat si pentru potrivirea lor in UI.
export function foldForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

// Fisa nu are inca niciun continut real introdus. Sursa unica de adevar
// pentru "e goala" - folosita atat pentru autosave/reuse (App.jsx) cat si
// pentru gate-ul de confirmare la stergere (DraftsSidebar.jsx); un check mai
// ingust intr-un singur loc insemna ca o fisa cu date reale intr-un camp pe
// care celalalt loc nu-l verifica (ex: telefon/marca/model/VIN/piese/lucrari)
// putea fi tratata gresit ca goala - reutilizata din greseala sau stearsa
// fara nicio confirmare.
export function isFisaEmpty(f) {
  return (
    !f.client?.nume?.trim() &&
    !f.client?.telefon?.trim() &&
    !f.auto?.nrInmatriculare?.trim() &&
    !f.auto?.marca?.trim() &&
    !f.auto?.model?.trim() &&
    !f.auto?.vin?.trim() &&
    !f.client?.cui?.trim() &&
    !String(f.km ?? '').trim() &&
    !f.observatii?.trim() &&
    (f.piese?.length ?? 0) === 0 &&
    (f.lucrari?.length ?? 0) === 0 &&
    !f._replaceBaseName
  )
}

export function calcListaTotal(items, pretKey) {
  if (!Array.isArray(items)) return 0
  return round2(
    items.reduce((sum, item) => sum + calcLinieTotal(item?.cantitate, item?.[pretKey]), 0)
  )
}

export function calcTotaluri(piese, lucrari, reducerePiesePercent, reducereLucrariPercent) {
  const totalPiese = calcListaTotal(piese || [], 'pretUnitar')
  const totalLucrari = calcListaTotal(lucrari || [], 'pret')
  const totalGeneral = round2(totalPiese + totalLucrari)

  const procentPiese = Math.min(100, Math.max(0, toNumber(reducerePiesePercent)))
  const procentLucrari = Math.min(100, Math.max(0, toNumber(reducereLucrariPercent)))
  const valoareReducerePiese = round2((totalPiese * procentPiese) / 100)
  const valoareReducereLucrari = round2((totalLucrari * procentLucrari) / 100)
  const valoareReducere = round2(valoareReducerePiese + valoareReducereLucrari)
  const totalFinal = round2(totalGeneral - valoareReducere)

  return {
    totalPiese,
    totalLucrari,
    totalGeneral,
    procentReducerePiese: procentPiese,
    procentReducereLucrari: procentLucrari,
    valoareReducerePiese,
    valoareReducereLucrari,
    valoareReducere,
    totalFinal
  }
}

// Fisele salvate inainte de separarea reducerii in piese/lucrari au un singur
// camp `reducerePercent` aplicat pe totalul general. Il aplicam identic pe
// ambele liste la deschidere, ca totalul unei fise vechi sa nu se schimbe
// retroactiv doar pentru ca a fost redeschisa.
export function reduceriDinFisa(fisa) {
  if (fisa?.reducerePiesePercent !== undefined || fisa?.reducereLucrariPercent !== undefined) {
    return {
      piese: fisa.reducerePiesePercent ?? 0,
      lucrari: fisa.reducereLucrariPercent ?? 0
    }
  }
  const legacy = fisa?.reducerePercent ?? 0
  return { piese: legacy, lucrari: legacy }
}

// Limite comune: sanitize (main) le aplica ca truncare de siguranta, iar
// validateFisa le verifica INAINTE de truncare - o fisa prea lunga este
// respinsa cu un mesaj clar, nu taiata in tacere.
export const LIMITS = {
  text: 200,
  telefon: 40,
  plate: 32,
  marca: 64,
  vin: 32,
  cui: 32,
  observatii: 2000,
  linii: 300,
  pretMax: 1e9,
  cantitateMax: 1e6
}

export const PLATA_STATUS = ['', 'achitat', 'neachitat']
export const PLATA_METODE = ['', 'numerar', 'card', 'transfer']

// Text gol/absent = valid ("nu a fost completat"); text ne-numeric = invalid.
function numericProblem(value) {
  if (value === '' || value == null) return false
  const n = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'))
  return !Number.isFinite(n)
}

function isRealDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return false
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

const tooLong = (v, max) => typeof v === 'string' && v.length > max

export function validateFisa(fisa) {
  const errors = {}
  fisa = fisa && typeof fisa === 'object' ? fisa : {}

  if (!fisa.client?.nume?.trim()) errors['client.nume'] = 'Numele clientului este obligatoriu'
  else if (tooLong(fisa.client.nume, LIMITS.text)) errors['client.nume'] = `Maxim ${LIMITS.text} de caractere`
  if (!fisa.client?.telefon?.trim()) errors['client.telefon'] = 'Numărul de telefon este obligatoriu'
  else if (!/^[0-9+()\-\s]{7,20}$/.test(fisa.client.telefon.trim()))
    errors['client.telefon'] = 'Număr de telefon invalid'
  if (tooLong(fisa.client?.cui, LIMITS.cui)) errors['client.cui'] = `Maxim ${LIMITS.cui} de caractere`

  if (!fisa.auto?.nrInmatriculare?.trim())
    errors['auto.nrInmatriculare'] = 'Numărul de înmatriculare este obligatoriu'
  else if (tooLong(fisa.auto.nrInmatriculare, LIMITS.plate))
    errors['auto.nrInmatriculare'] = `Maxim ${LIMITS.plate} de caractere`
  if (!fisa.auto?.marca?.trim()) errors['auto.marca'] = 'Marca este obligatorie'
  else if (tooLong(fisa.auto.marca, LIMITS.marca)) errors['auto.marca'] = `Maxim ${LIMITS.marca} de caractere`
  if (!fisa.auto?.model?.trim()) errors['auto.model'] = 'Modelul este obligatoriu'
  else if (tooLong(fisa.auto.model, LIMITS.marca)) errors['auto.model'] = `Maxim ${LIMITS.marca} de caractere`
  if (fisa.auto?.vin?.trim() && fisa.auto.vin.trim().length !== 17)
    errors['auto.vin'] = 'VIN-ul trebuie să aibă exact 17 caractere'
  if (
    fisa.auto?.an !== '' &&
    fisa.auto?.an != null &&
    (numericProblem(fisa.auto.an) ||
      toNumber(fisa.auto.an) < 1950 ||
      toNumber(fisa.auto.an) > new Date().getFullYear() + 1)
  )
    errors['auto.an'] = 'An fabricație invalid'
  if (fisa.km !== '' && fisa.km != null && (numericProblem(fisa.km) || toNumber(fisa.km) < 0 || toNumber(fisa.km) > 5e6))
    errors['km'] = 'Kilometraj invalid'

  if (!fisa.dataCurenta && !fisa.data) errors['data'] = 'Data intervenției este obligatorie'
  else if (!fisa.dataCurenta && !isRealDate(fisa.data)) errors['data'] = 'Data intervenției este invalidă'

  if (tooLong(fisa.observatii, LIMITS.observatii)) errors['observatii'] = `Maxim ${LIMITS.observatii} de caractere`
  if (fisa.plata?.status && !PLATA_STATUS.includes(fisa.plata.status)) errors['plata.status'] = 'Stare plată invalidă'
  if (fisa.plata?.metoda && !PLATA_METODE.includes(fisa.plata.metoda)) errors['plata.metoda'] = 'Metodă de plată invalidă'

  for (const [key, list] of [['piese', fisa.piese], ['lucrari', fisa.lucrari]]) {
    if (list != null && !Array.isArray(list)) errors[key] = 'Listă invalidă'
    else if ((list?.length ?? 0) > LIMITS.linii) errors[key] = `Maxim ${LIMITS.linii} de linii`
  }

  const checkLines = (list, key, priceKey) => {
    if (!Array.isArray(list)) return
    list.forEach((it, i) => {
      if (!it?.denumire?.trim()) errors[`${key}.${i}.denumire`] = 'Denumirea este obligatorie'
      else if (tooLong(it.denumire, LIMITS.text)) errors[`${key}.${i}.denumire`] = `Maxim ${LIMITS.text} de caractere`
      if (numericProblem(it?.cantitate) || toNumber(it?.cantitate) <= 0 || toNumber(it?.cantitate) > LIMITS.cantitateMax)
        errors[`${key}.${i}.cantitate`] = 'Cantitate invalidă'
      if (numericProblem(it?.[priceKey]) || toNumber(it?.[priceKey]) < 0 || toNumber(it?.[priceKey]) > LIMITS.pretMax)
        errors[`${key}.${i}.${priceKey}`] = 'Preț invalid'
    })
  }
  checkLines(fisa.piese, 'piese', 'pretUnitar')
  checkLines(fisa.lucrari, 'lucrari', 'pret')

  for (const [k, v] of [
    ['reducerePiesePercent', fisa.reducerePiesePercent],
    ['reducereLucrariPercent', fisa.reducereLucrariPercent]
  ]) {
    if (v !== undefined && v !== '' && (numericProblem(v) || toNumber(v) < 0 || toNumber(v) > 100))
      errors[k] = 'Reducere invalidă (0-100%)'
  }

  return { valid: Object.keys(errors).length === 0, errors }
}
