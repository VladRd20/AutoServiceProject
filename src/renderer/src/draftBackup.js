// Referinta mutabila catre fisa curenta, actualizata de App la fiecare schimbare.
// ErrorBoundary o foloseste ca ultima plasa de siguranta: daca UI-ul crapa,
// incercam sa salvam draftul curent INAINTE de a arata ecranul de eroare,
// ca utilizatorul sa nu piarda ce a introdus.
export const draftBackupRef = { current: null }

export async function trySaveBackup() {
  const fisa = draftBackupRef.current
  if (!fisa || !window.serviceAuto?.fisa?.saveDraft) return
  try {
    await window.serviceAuto.fisa.saveDraft(fisa)
  } catch {
    // Nu mai e nimic altceva de facut aici - e deja calea de urgenta.
  }
}
