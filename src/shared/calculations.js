// Calcule pure, fara efecte secundare. Folosit atat in UI (recalcul live)
// cat si in main process (generare PDF), ca sursa unica de adevar.

function toNumber(value) {
  const n = Number(value)
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
    (f.piese?.length ?? 0) === 0 &&
    (f.lucrari?.length ?? 0) === 0 &&
    !f._replaceBaseName
  )
}

export function calcListaTotal(items, pretKey) {
  return round2(
    items.reduce((sum, item) => sum + calcLinieTotal(item.cantitate, item[pretKey]), 0)
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

export function validateFisa(fisa) {
  const errors = {}

  if (!fisa.client?.nume?.trim()) errors['client.nume'] = 'Numele clientului este obligatoriu'
  if (!fisa.client?.telefon?.trim()) errors['client.telefon'] = 'Numarul de telefon este obligatoriu'
  else if (!/^[0-9+()\-\s]{7,20}$/.test(fisa.client.telefon.trim()))
    errors['client.telefon'] = 'Numar de telefon invalid'

  if (!fisa.auto?.nrInmatriculare?.trim())
    errors['auto.nrInmatriculare'] = 'Numarul de inmatriculare este obligatoriu'
  if (!fisa.auto?.marca?.trim()) errors['auto.marca'] = 'Marca este obligatorie'
  if (!fisa.auto?.model?.trim()) errors['auto.model'] = 'Modelul este obligatoriu'
  if (fisa.auto?.vin?.trim() && fisa.auto.vin.trim().length !== 17)
    errors['auto.vin'] = 'VIN-ul trebuie sa aiba exact 17 caractere'
  if (
    fisa.auto?.an &&
    (toNumber(fisa.auto.an) < 1950 || toNumber(fisa.auto.an) > new Date().getFullYear() + 1)
  )
    errors['auto.an'] = 'An fabricatie invalid'

  if (!fisa.dataCurenta && !fisa.data) errors['data'] = 'Data interventiei este obligatorie'

  ;(fisa.piese || []).forEach((p, i) => {
    if (!p.denumire?.trim()) errors[`piese.${i}.denumire`] = 'Denumirea piesei este obligatorie'
    if (toNumber(p.cantitate) <= 0) errors[`piese.${i}.cantitate`] = 'Cantitate invalida'
    if (toNumber(p.pretUnitar) < 0) errors[`piese.${i}.pretUnitar`] = 'Pret invalid'
  })

  ;(fisa.lucrari || []).forEach((l, i) => {
    if (!l.denumire?.trim()) errors[`lucrari.${i}.denumire`] = 'Denumirea lucrarii este obligatorie'
    if (toNumber(l.cantitate) <= 0) errors[`lucrari.${i}.cantitate`] = 'Cantitate invalida'
    if (toNumber(l.pret) < 0) errors[`lucrari.${i}.pret`] = 'Pret invalid'
  })

  return { valid: Object.keys(errors).length === 0, errors }
}
