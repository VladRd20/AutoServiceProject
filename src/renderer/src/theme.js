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
}
