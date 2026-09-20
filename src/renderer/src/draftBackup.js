// Referinta mutabila catre fisa curenta, actualizata de App la fiecare schimbare.
// ErrorBoundary o foloseste ca ultima plasa de siguranta: daca UI-ul crapa,
// incercam sa salvam draftul curent INAINTE de a arata ecranul de eroare,
// ca utilizatorul sa nu piarda ce a introdus.
export const draftBackupRef = { current: null }

// Autosaver-ul activ (pus de App). Daca exista, il folosim: are deja cel mai
// recent document si id-ul corect (evita un draft dublu daca prima salvare e in curs).
export const autosaverRef = { current: null }

export async function trySaveBackup() {
  try {
    const autosaver = autosaverRef.current
    if (autosaver) {
      await autosaver.flush()
      return
    }
    const fisa = draftBackupRef.current
    if (!fisa || !window.serviceAuto?.fisa?.saveDraft) return
    await window.serviceAuto.fisa.saveDraft(fisa)
  } catch {
    // Nu mai e nimic altceva de facut aici - e deja calea de urgenta.
  }
}
