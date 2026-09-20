import { calcTotaluri, calcLinieTotal, foldForMatch, reduceriDinFisa, round2 } from '../../shared/calculations'
import { fisaDay, hasRange, inRange, normalizeRange } from '../../shared/dateRange'
import { ensureDirs } from './paths'
import { readAllFiseFinalizate } from './fise'

// Totalul unei fise, calculat o singura data (WeakMap pe obiectul din cache).
const totalsMemo = new WeakMap()
function totalsOf(fisa) {
  let t = totalsMemo.get(fisa)
  if (!t) {
    const r = reduceriDinFisa(fisa)
    t = calcTotaluri(fisa.piese, fisa.lucrari, r.piese, r.lucrari)
    totalsMemo.set(fisa, t)
  }
  return t
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

function inPeriod(all, period, rangeIn) {
  if (period === 'interval') {
    const range = normalizeRange(rangeIn)
    return hasRange(range) ? all.filter((f) => inRange(fisaDay(f), range)) : all
  }
  const start = periodStart(period)
  if (!start) return all
  return all.filter((f) => {
    const d = f.finalizedAt ? new Date(f.finalizedAt) : null
    return d && !isNaN(d) && d >= start
  })
}

// Raport simplu: total incasat si cele mai cerute piese/lucrari intr-o
// perioada. Calculat din fisele finalizate, nu tinut separat.
export async function getRapoarte(period, range) {
  await ensureDirs()
  const all = await readAllFiseFinalizate()
  const filtered = inPeriod(all, period, range)

  let totalIncasat = 0
  let totalPiese = 0
  let totalLucrari = 0
  const pieseMap = new Map()
  const lucrariMap = new Map()

  function upsertAgregat(map, denumireRaw, cantitate, valoare) {
    const denumire = typeof denumireRaw === 'string' ? denumireRaw.trim() : ''
    if (!denumire) return
    const key = foldForMatch(denumire)
    const entry = map.get(key) || { denumire, count: 0, valoare: 0 }
    entry.count += Number(cantitate) || 0
    entry.valoare = round2(entry.valoare + valoare)
    map.set(key, entry)
  }

  for (const fisa of filtered) {
    const t = totalsOf(fisa)
    totalIncasat += t.totalFinal
    totalPiese += t.totalPiese - t.valoareReducerePiese
    totalLucrari += t.totalLucrari - t.valoareReducereLucrari
    for (const p of Array.isArray(fisa.piese) ? fisa.piese : []) {
      upsertAgregat(pieseMap, p?.denumire, p?.cantitate, calcLinieTotal(p?.cantitate, p?.pretUnitar))
    }
    for (const l of Array.isArray(fisa.lucrari) ? fisa.lucrari : []) {
      upsertAgregat(lucrariMap, l?.denumire, l?.cantitate, calcLinieTotal(l?.cantitate, l?.pret))
    }
  }

  // Venit lunar pe ultimele 6 luni, independent de perioada aleasa.
  const acum = new Date()
  const lunar = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(acum.getFullYear(), acum.getMonth() - i, 1)
    lunar.push({ year: d.getFullYear(), month: d.getMonth(), total: 0, count: 0 })
  }
  for (const fisa of all) {
    if (!fisa.finalizedAt) continue
    const d = new Date(fisa.finalizedAt)
    if (isNaN(d)) continue
    const slot = lunar.find((m) => m.year === d.getFullYear() && m.month === d.getMonth())
    if (!slot) continue
    slot.total = round2(slot.total + totalsOf(fisa).totalFinal)
    slot.count += 1
  }

  return {
    numarFise: filtered.length,
    totalIncasat: round2(totalIncasat),
    totalPiese: round2(totalPiese),
    totalLucrari: round2(totalLucrari),
    lunar,
    topPiese: [...pieseMap.values()].sort((a, b) => b.count - a.count).slice(0, 5),
    topLucrari: [...lucrariMap.values()].sort((a, b) => b.count - a.count).slice(0, 5)
  }
}

// Celula CSV sigura: ghilimele duble, si prefix ' contra "formula injection"
// in Excel (=, +, -, @ la inceput de text venit de la utilizator).
export function csvCell(value) {
  let s = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

const HEADERS = [
  'Nr. fișă',
  'Data',
  'Nr. înmatriculare',
  'Marcă',
  'Model',
  'Client',
  'Telefon',
  'Total piese',
  'Total lucrări',
  'Reducere',
  'Total final',
  'Plată'
]

// CSV pentru contabil (separator ; si BOM UTF-8 - Excel RO il deschide corect).
export async function exportFiseCsv(period, range) {
  await ensureDirs()
  const rows = [...inPeriod(await readAllFiseFinalizate(), period, range)].sort((a, b) =>
    (a.finalizedAt || '').localeCompare(b.finalizedAt || '')
  )
  const num = (n) => n.toFixed(2).replace('.', ',')
  const lines = [HEADERS.map(csvCell).join(';')]
  for (const f of rows) {
    const t = totalsOf(f)
    lines.push(
      [
        f.nr || '',
        String(f.data || '').slice(0, 10),
        f.auto?.nrInmatriculare,
        f.auto?.marca,
        f.auto?.model,
        f.client?.nume,
        f.client?.telefon,
        num(t.totalPiese),
        num(t.totalLucrari),
        num(t.valoareReducere),
        num(t.totalFinal),
        f.plata?.status || ''
      ]
        .map(csvCell)
        .join(';')
    )
  }
  return { csv: `\uFEFF${lines.join('\r\n')}\r\n`, count: rows.length }
}
