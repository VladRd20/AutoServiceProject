import { useState } from 'react'
import { validateFisa, isFisaEmpty } from '../../../shared/calculations'
import { LAST_DRAFT_KEY, lsGet, lsSet } from '../fisaModel'

// Finalizarea fisei (validare, salvare, PDF, trecere la urmatoarea fisa),
// previzualizarea PDF si reincercarea PDF-ului esuat.
export default function useRelease({
  fisa,
  readOnly,
  showToast,
  autosaver,
  fisaRef,
  readOnlyRef,
  releasingRef,
  suspendAutosaveRef,
  removedDraftIdsRef,
  setErrors,
  setPdfRetry,
  resetToNewFisa,
  goToNextDraftOrNew,
  refreshBackupStatus
}) {
  const [releasing, setReleasing] = useState(false)
  const [previewingPdf, setPreviewingPdf] = useState(false)

  async function handleRelease() {
    const { valid, errors: localErrors } = validateFisa(fisa)
    setErrors(localErrors)
    if (!valid) {
      showToast('error', 'Fișa conține câmpuri incomplete sau invalide. Verifică câmpurile evidențiate cu roșu.')
      return
    }

    if (readOnly || releasingRef.current) return
    releasingRef.current = true
    setReleasing(true)
    // Oprim update-urile catre autosaver cat timp finalizam, ca fisa finalizata
    // sa nu fie re-salvata ca draft "fantoma" dupa reset(null).
    suspendAutosaveRef.current = true
    // Salvam mai intai ce e nesalvat: astfel stim id-ul draftului (chiar daca
    // prima salvare era inca in curs) si main il sterge la finalizare.
    const ok = await autosaver.flush()
    if (!ok) {
      // Continuam oricum - finalize salveaza fisa singur; dar draftul poate ramane
      // duplicat doar daca disc-ul a fost picat, caz in care finalize va esua oricum.
    }
    let finalizedOk = false
    try {
      const current = fisaRef.current || fisa
      const finalId = current.id || autosaver.getId()
      let res
      try {
        res = await window.serviceAuto.fisa.finalize({ ...current, id: finalId })
      } catch (err) {
        res = { ok: false, error: { code: 'IPC', message: err?.message || 'Finalizarea a eșuat.' } }
      }

      if (!res.ok) {
        suspendAutosaveRef.current = false
        autosaver.update(fisaRef.current)
        if (res.error.code === 'VALIDATION' && res.error.fields) setErrors(res.error.fields)
        showToast('error', res.error.message)
        return
      }

      // Draftul a disparut (main l-a sters la finalizare) - nimic de mai salvat.
      finalizedOk = true
      if (finalId) removedDraftIdsRef.current.add(finalId)
      autosaver.reset(null)
      if (lsGet(LAST_DRAFT_KEY) === (current.id || null)) lsSet(LAST_DRAFT_KEY, null)
      refreshBackupStatus()

      if (res.data.pdfSaved) {
        showToast(
          'success',
          res.data.replaced
            ? `Fișă actualizată și PDF salvat: ${res.data.baseName}.pdf`
            : `Fișă finalizată și PDF salvat: ${res.data.baseName}.pdf`,
          { label: 'Printează', onClick: () => handlePrintPdf(res.data.baseName) }
        )
        await goToNextDraftOrNew()
        suspendAutosaveRef.current = false
      } else {
        // Fisa finalizata NU ramane in formular (id-ul ei ar arata spre un draft
        // sters si autosave ar recrea un draft fantoma). Trecem pe urmatoarea
        // fisa si abia apoi setam pdfRetry (handleOpenDraft il goleste).
        await goToNextDraftOrNew()
        suspendAutosaveRef.current = false
        const baseName = res.data.baseName
        setPdfRetry({ baseName })
        showToast(
          'error',
          `Fișa a fost salvată, dar PDF-ul a eșuat: ${res.data.pdfError}`,
          { label: 'Reîncearcă PDF', onClick: () => handleRetryPdf(baseName) },
          { sticky: true }
        )
      }
    } catch (err) {
      // Finalizarea a reusit dar trecerea pe alta fisa a esuat: fisa finalizata
      // NU are voie sa ramana in formular (autosave ar recrea un draft fantoma).
      if (!finalizedOk) throw err
      resetToNewFisa()
      setErrors({})
    } finally {
      releasingRef.current = false
      suspendAutosaveRef.current = false
      setReleasing(false)
      if (!finalizedOk && !readOnlyRef.current && fisaRef.current) autosaver.update(fisaRef.current)
    }
  }

  async function handlePrintPdf(baseName) {
    const res = await window.serviceAuto.fise.printPdf(baseName)
    if (!res.ok) showToast('error', res.error.message)
  }

  // Genereaza si deschide un PDF din fisa curenta a formularului, FARA sa o
  // finalizeze/salveze - util pentru un calcul/oferta pe care clientul nu a
  // acceptat-o inca. Nu trece prin validateFisa (o oferta poate fi incompleta
  // intentionat), dar nu are rost pe o fisa complet goala.
  async function handlePreviewPdf() {
    if (isFisaEmpty(fisaRef.current)) {
      showToast('error', 'Adaugă cel puțin o piesă/lucrare sau datele clientului înainte de previzualizare.')
      return
    }
    setPreviewingPdf(true)
    try {
      const res = await window.serviceAuto.fisa.previewPdf(fisaRef.current || fisa)
      if (!res.ok) showToast('error', res.error.message)
    } finally {
      setPreviewingPdf(false)
    }
  }

  // Main regenereaza PDF-ul din fisa de pe disc - avem nevoie doar de baseName.
  async function handleRetryPdf(baseName) {
    const res = await window.serviceAuto.fisa.retryPdf({ baseName })
    if (res.ok) {
      showToast('success', `PDF salvat: ${baseName}.pdf`, {
        label: 'Printează',
        onClick: () => handlePrintPdf(baseName)
      })
      setPdfRetry((p) => (p && p.baseName === baseName ? null : p))
    } else {
      showToast('error', `PDF tot a eșuat: ${res.error.message}`, {
        label: 'Reîncearcă',
        onClick: () => handleRetryPdf(baseName)
      })
    }
  }

  return { releasing, previewingPdf, handleRelease, handlePreviewPdf, handleRetryPdf }
}
