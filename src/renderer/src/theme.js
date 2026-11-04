const STORAGE_KEY = 'service-auto-theme' // 'light' | 'dark' | absent = urmeaza sistemul

export function getStoredTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function setStoredTheme(theme) {
  try {
    if (theme === 'light' || theme === 'dark') localStorage.setItem(STORAGE_KEY, theme)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // localStorage indisponibil (fereastra privata etc) - tema ramane doar pentru sesiunea curenta.
  }
}

// Modul ales de utilizator: 'light' | 'dark' | 'system' (= nu e nimic salvat).
export function getThemeMode() {
  const stored = getStoredTheme()
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

// Ciclul butonului din bara de sus: Luminoasa -> Intunecata -> Sistem.
export function nextThemeMode(mode) {
  return mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light'
}

// Salveaza + aplica un mod ('light' | 'dark' | 'system'). Pentru 'system' nu
// ramane niciun atribut pe <html>: CSS-ul urmeaza prefers-color-scheme live.
export function setThemeMode(mode) {
  setStoredTheme(mode)
  applyTheme(mode)
}

export function getEffectiveTheme() {
  const stored = getStoredTheme()
  if (stored === 'light' || stored === 'dark') return stored
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function applyTheme(theme) {
  const root = document.documentElement
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme)
  else root.removeAttribute('data-theme')
}

// Apelat o singura data, cat mai devreme (inainte de primul render), ca sa
// nu clipeasca tema gresita. Daca utilizatorul nu a ales explicit nimic, nu
// setam niciun atribut - lasam CSS-ul sa urmeze prefers-color-scheme live,
// ca schimbarea temei din Windows in timp ce aplicatia ruleaza sa se vada
// imediat, nu doar dupa un restart.
export function initTheme() {
  const stored = getStoredTheme()
  if (stored === 'light' || stored === 'dark') applyTheme(stored)
  initDensity()
}

// ---------------------------------------------------------------------------
// Densitatea interfetei ("Afisare: Compacta / Confortabila"), salvata ca tema,
// in localStorage, si aplicata pe <html> ca data-density. Compacta (implicit) =
// niciun atribut; Confortabila = data-density="comfortable" (campuri ~40px, vezi
// tokens.css). Folosire din Setari:
//   import { getDensity, setDensity } from '../theme'
//   setDensity('comfortable')   // salveaza + aplica imediat
//   getDensity()                // 'compact' | 'comfortable'
const DENSITY_KEY = 'service-auto-density'

export function getDensity() {
  try {
    return localStorage.getItem(DENSITY_KEY) === 'comfortable' ? 'comfortable' : 'compact'
  } catch {
    return 'compact'
  }
}

export function applyDensity(density) {
  const root = document.documentElement
  if (density === 'comfortable') root.setAttribute('data-density', 'comfortable')
  else root.removeAttribute('data-density')
}

export function setDensity(density) {
  const value = density === 'comfortable' ? 'comfortable' : 'compact'
  try {
    if (value === 'comfortable') localStorage.setItem(DENSITY_KEY, value)
    else localStorage.removeItem(DENSITY_KEY)
  } catch {
    // localStorage indisponibil: ramane doar pentru sesiunea curenta.
  }
  applyDensity(value)
}

// Apelata din initTheme(), inainte de primul render.
export function initDensity() {
  applyDensity(getDensity())
}
