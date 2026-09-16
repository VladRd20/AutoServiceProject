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

export function calcListaTotal(items, pretKey) {
  return round2(
    items.reduce((sum, item) => sum + calcLinieTotal(item.cantitate, item[pretKey]), 0)
  )
}

export function calcTotaluri(piese, lucrari, reducerePercent) {
  const totalPiese = calcListaTotal(piese || [], 'pretUnitar')
  const totalLucrari = calcListaTotal(lucrari || [], 'pret')
  const totalGeneral = round2(totalPiese + totalLucrari)

  const procent = Math.min(100, Math.max(0, toNumber(reducerePercent)))
  const valoareReducere = round2((totalGeneral * procent) / 100)
  const totalFinal = round2(totalGeneral - valoareReducere)

  return {
    totalPiese,
    totalLucrari,
    totalGeneral,
    procentReducere: procent,
    valoareReducere,
    totalFinal
  }
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

  if (!fisa.data) errors['data'] = 'Data interventiei este obligatorie'

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
