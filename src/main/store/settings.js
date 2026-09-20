import { AppError } from '../errors'
import { writeJsonAtomic } from './io'
import { readJsonHealing } from './integrity'
import { ensureDirs, getSettingsPath } from './paths'

// Setarile firmei (nume, adresa, telefon, CUI/IDNO) - afisate pe PDF.
const DEFAULT_SETTINGS = { numeService: '', adresa: '', telefon: '', cui: '' }
const FIELD_MAX = 200

function clean(settings) {
  const out = { ...DEFAULT_SETTINGS }
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    const v = settings?.[k]
    out[k] = typeof v === 'string' ? v.slice(0, FIELD_MAX) : ''
  }
  return out
}

// Lipsa fisierului = setari implicite. Un fisier CORUPT e refacut din backup
// (vezi integrity.js); daca nici asta nu merge, aruncam eroare in loc sa
// intoarcem tacit valori goale - urmatorul "Salveaza" ar fi suprascris
// definitiv datele reale ale firmei.
export async function getSettings() {
  await ensureDirs()
  const res = await readJsonHealing(getSettingsPath(), 'setari')
  if (res.ok) return clean(res.value)
  if (res.missing) return { ...DEFAULT_SETTINGS }
  throw new AppError('SETTINGS_CORRUPT', 'Setările firmei sunt corupte și nu au putut fi refăcute. Reintrodu-le și salvează.')
}

export async function saveSettings(settings) {
  await ensureDirs()
  const merged = clean(settings)
  await writeJsonAtomic(getSettingsPath(), merged, 'Nu s-au putut salva setările pe disc.')
  return merged
}
