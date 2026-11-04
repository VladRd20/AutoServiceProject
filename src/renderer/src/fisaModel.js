// Modelul fisei si utilitare pure (fara React) - folosite de App si de hook-uri.
import { isFisaEmpty, reduceriDinFisa } from '../../shared/calculations'

// Ultimul draft deschis - la pornire revenim direct la el.
export const LAST_DRAFT_KEY = 'lastOpenDraftId'
export const FIRST_RUN_KEY = 'firstRunSettingsDismissed'
export const BACKUP_LATE_AFTER_MS = 10 * 60 * 1000

// "1 fișă" / "2 fișe"
export const fise = (n) => `${n} ${n === 1 ? 'fișă' : 'fișe'}`

export function lsGet(key) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}
export function lsSet(key, value) {
  try {
    if (value == null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // localStorage indisponibil - nu e critic
  }
}

const APP_START = Date.now()

// Data LOCALA (nu UTC): toISOString() ar da ziua precedenta dupa miezul noptii
// intr-un fus orar cu offset pozitiv.
export function todayISO() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function emptyFisa() {
  return {
    id: null,
    client: { nume: '', telefon: '', cui: '' },
    auto: { nrInmatriculare: '', marca: '', model: '', vin: '', an: '', capacitate: '', combustibil: '' },
    km: '',
    observatii: '',
    observatiiPrint: false,
    plata: { status: '', metoda: '' },
    data: todayISO(),
    dataCurenta: true,
    piese: [],
    lucrari: [],
    reducerePiesePercent: 0,
    reducereLucrariPercent: 0
  }
}

// Completeaza campurile adaugate ulterior, ca input-urile sa ramana controlate.
function withNewFieldDefaults(f) {
  const client = f.client || {}
  const plata = f.plata || {}
  if (
    client.cui !== undefined &&
    f.km !== undefined &&
    f.observatii !== undefined &&
    f.observatiiPrint !== undefined &&
    f.auto?.capacitate !== undefined &&
    f.auto?.combustibil !== undefined &&
    f.plata &&
    plata.status !== undefined &&
    plata.metoda !== undefined
  ) {
    return f
  }
  return {
    ...f,
    client: { ...client, cui: client.cui ?? '' },
    km: f.km ?? '',
    observatii: f.observatii ?? '',
    observatiiPrint: f.observatiiPrint ?? false,
    auto: { ...(f.auto || {}), capacitate: f.auto?.capacitate ?? '', combustibil: f.auto?.combustibil ?? '' },
    plata: { ...plata, status: plata.status ?? '', metoda: plata.metoda ?? '' }
  }
}

// Fisele salvate inainte de separarea reducerii in piese/lucrari au un singur
// camp `reducerePercent`. Il migram la deschidere in cele doua campuri noi,
// ca formularul si PDF-ul sa lucreze mereu cu aceeasi forma de date.
export function normalizeFisa(f) {
  if (!f) return f
  f = withNewFieldDefaults(f)
  if (f.reducerePiesePercent === undefined && f.reducereLucrariPercent === undefined && f.reducerePercent === undefined) {
    f = { ...f, reducerePiesePercent: 0, reducereLucrariPercent: 0 }
  }
  if (f.reducerePiesePercent !== undefined || f.reducereLucrariPercent !== undefined) return f
  if (f.reducerePercent === undefined) return f
  const { reducerePercent: _legacy, ...rest } = f
  const r = reduceriDinFisa(f)
  return { ...rest, reducerePiesePercent: r.piese, reducereLucrariPercent: r.lucrari }
}

// Draftul de deschis la pornire: cel mai recent MODIFICAT (updatedAt) dintre cele
// cu continut; fara asa ceva, unul gol (reutilizat, ca sa nu se adune "Fisa noua").
// NU ne bazam pe localStorage (lastOpenDraftId): dupa o inchidere fortata el poate
// lipsi sau indica un draft mai vechi, iar formularul ar porni gol / pe alta fisa.
export function pickStartupDraft(drafts) {
  const byRecency = [...(drafts || [])].sort(
    (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') || (b.id || '').localeCompare(a.id || '')
  )
  return byRecency.find((d) => !isFisaEmpty(d)) || byRecency[0] || null
}

// Chip discret pentru starea backup-ului automat.
export function getBackupChip(status) {
  if (!status) return null
  const uptime = Date.now() - APP_START
  if (status.lastError) {
    return { warn: true, text: 'Backup întârziat', title: `Ultimul backup a eșuat: ${status.lastError}` }
  }
  if (!status.lastBackupAt) {
    if (uptime < BACKUP_LATE_AFTER_MS) return null
    return { warn: true, text: 'Backup întârziat', title: 'Nu s-a făcut niciun backup de la pornirea aplicației.' }
  }
  const t = new Date(status.lastBackupAt)
  const hhmm = Number.isNaN(t.getTime())
    ? ''
    : t.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })
  return { warn: false, text: `Backup ${hhmm}`, title: `Ultimul backup automat: ${t.toLocaleString('ro-RO')}` }
}
