// Secventa de pornire a randarii. Scop: poarta de vizibilitate (visibility:hidden pana se
// stiu prima rulare + drafturile) nu are voie sa ramana inchisa pentru totdeauna.
//  - fiecare pas e izolat: o exceptie sincrona sau o promisiune respinsa nu sare peste ceilalti;
//  - un timeout unic deschide ambele steaguri chiar daca un IPC nu raspunde niciodata.

export const STARTUP_REVEAL_TIMEOUT_MS = 4000

// Ruleaza un pas; nu arunca niciodata (nici sincron, nici asincron). Returneaza o promisiune mereu rezolvata.
function safeStep(name, fn, warn) {
  try {
    return Promise.resolve(fn()).catch((err) => {
      warn(`[startup] pasul "${name}" a esuat: ${err?.message || err}`)
    })
  } catch (err) {
    warn(`[startup] pasul "${name}" a aruncat: ${err?.message || err}`)
    return Promise.resolve()
  }
}

/**
 * Ordinea apelurilor = ordinea in care pornesc cererile IPC (vezi App.jsx).
 * Returneaza o functie de anulare a timeout-ului (pentru cleanup-ul efectului).
 */
export function runStartup({
  loadInitialDrafts,
  refreshRecentFise,
  refreshAutocomplete,
  checkLocation,
  checkFirstRun,
  markInitialDone,
  markFirstRunChecked,
  timeoutMs = STARTUP_REVEAL_TIMEOUT_MS,
  warn = (m) => console.warn(m)
}) {
  let draftsDone = false
  let checkedDone = false
  const timer = setTimeout(() => {
    if (draftsDone && checkedDone) return
    warn(`[startup] pornirea nu s-a terminat in ${timeoutMs}ms - afisam oricum interfata`)
    markInitialDone()
    markFirstRunChecked()
  }, timeoutMs)
  const maybeClear = () => {
    if (draftsDone && checkedDone) clearTimeout(timer)
  }

  const draftsReady = safeStep('drafturi', loadInitialDrafts, warn).then(() => {
    draftsDone = true
    markInitialDone()
    maybeClear()
  })
  const recentReady = safeStep('fise recente', refreshRecentFise, warn)
  safeStep('autocomplete', refreshAutocomplete, warn)
  safeStep('locatie', () => checkLocation(Promise.all([draftsReady, recentReady])), warn)
  // checkFirstRun intoarce promisiunea care a setat deja steagul; daca a aruncat, il setam noi.
  safeStep('prima rulare', checkFirstRun, warn).then(() => {
    checkedDone = true
    markFirstRunChecked()
    maybeClear()
  })
  return () => clearTimeout(timer)
}
