// Intervale de date pentru filtre (cautare, rapoarte, CSV). Date LOCALE, in format
// ISO "YYYY-MM-DD" - compararea ca text e corecta pentru acest format.
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

const p2 = (n) => String(n).padStart(2, '0')
export const toISODate = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`

export function isRealISODate(v) {
  const m = ISO_DATE.exec(String(v || ''))
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

// Curata un interval primit din UI/IPC: date invalide devin "", iar capetele
// inversate se intorc (utilizatorul nu trebuie sa primeasca "niciun rezultat"
// doar pentru ca a ales data de sfarsit inaintea celei de inceput).
export function normalizeRange(range) {
  let from = isRealISODate(range?.from) ? range.from : ''
  let to = isRealISODate(range?.to) ? range.to : ''
  if (from && to && from > to) [from, to] = [to, from]
  return { from, to }
}

export const hasRange = (r) => Boolean(r && (r.from || r.to))

export const PRESETS = [
  { key: 'azi', label: 'Azi' },
  { key: '7zile', label: 'Ultimele 7 zile' },
  { key: 'luna', label: 'Luna aceasta' },
  { key: 'luna-trecuta', label: 'Luna trecută' },
  { key: 'anul', label: 'Anul acesta' }
]

export function presetRange(key, now = new Date()) {
  const y = now.getFullYear()
  const m = now.getMonth()
  switch (key) {
    case 'azi':
      return { from: toISODate(now), to: toISODate(now) }
    case '7zile': {
      const s = new Date(y, m, now.getDate() - 6)
      return { from: toISODate(s), to: toISODate(now) }
    }
    case 'luna':
      return { from: toISODate(new Date(y, m, 1)), to: toISODate(new Date(y, m + 1, 0)) }
    case 'luna-trecuta':
      return { from: toISODate(new Date(y, m - 1, 1)), to: toISODate(new Date(y, m, 0)) }
    case 'anul':
      return { from: `${y}-01-01`, to: `${y}-12-31` }
    default:
      return { from: '', to: '' }
  }
}

// Ziua (locala) la care se refera o fisa: data intervenitiei; daca lipseste,
// ziua finalizarii. `data` poate fi "YYYY-MM-DD" sau un datetime local complet.
export function fisaDay(fisa) {
  const d = String(fisa?.data || '').slice(0, 10)
  if (isRealISODate(d)) return d
  const t = fisa?.finalizedAt ? new Date(fisa.finalizedAt) : null
  return t && !isNaN(t) ? toISODate(t) : ''
}

export function inRange(day, range) {
  if (!day) return !hasRange(range)
  if (range?.from && day < range.from) return false
  if (range?.to && day > range.to) return false
  return true
}
