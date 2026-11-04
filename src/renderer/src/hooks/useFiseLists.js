import { useCallback, useState } from 'react'

// Datele laterale ale formularului: lucrari recente (fise finalizate),
// date pentru auto-completare si actiunile pe fise deja finalizate
// (deschidere / tiparire PDF, stergere).
export default function useFiseLists({ showToast, confirmAction }) {
  const [recentFise, setRecentFise] = useState([])
  const [autocomplete, setAutocomplete] = useState({ marci: [], modelePerMarca: {}, piese: [], lucrari: [] })

  const refreshRecentFise = useCallback(async () => {
    const res = await window.serviceAuto.fisa.listRecent(8)
    if (res.ok) setRecentFise(res.data)
    else showToast('error', res.error.message)
  }, [showToast])

  // Nu esueaza vizibil daca nu merge - auto-completarea e un confort, nu o
  // functionalitate critica; daca lipseste, formularul functioneaza normal.
  const refreshAutocomplete = useCallback(async () => {
    const res = await window.serviceAuto.fisa.getAutocompleteData()
    if (res.ok) setAutocomplete(res.data)
  }, [])

  const handleOpenPdfFromSearch = useCallback(
    async (fileName) => {
      const res = await window.serviceAuto.fise.openPdf(fileName)
      if (!res.ok) showToast('error', res.error.message)
    },
    [showToast]
  )

  const handlePrintPdfFromList = useCallback(
    async (fileName) => {
      const res = await window.serviceAuto.fise.printPdf(fileName)
      if (!res.ok) showToast('error', res.error.message)
    },
    [showToast]
  )

  // Sterge o fisa deja finalizata (PDF-ul + inregistrarea), nu un draft in
  // lucru - spre deosebire de handleDeleteDraft, e ireversibil (o factura
  // deja emisa), de-aia trece prin confirmAction. Returneaza true doar daca
  // s-a sters efectiv, ca listele care o afiseaza (Lucrari recente, Cautare,
  // Istoric masina) sa-si poata actualiza propria stare locala pe loc, fara
  // sa astepte un refresh complet.
  const handleDeleteFinalized = useCallback(
    async (fileName) => {
      const ok = await confirmAction(
        'Ștergi această fișă finalizată? Va fi mutată în coșul de gunoi și o poți recupera timp de 30 de zile.',
        { confirmLabel: 'Șterge' }
      )
      if (!ok) return false
      const res = await window.serviceAuto.fisa.deleteFinalizata(fileName)
      if (!res.ok) {
        showToast('error', res.error.message)
        return false
      }
      const trashId = res.data?.trashId
      if (trashId) {
        const restore = async () => {
          const r = await window.serviceAuto.trash.restore(trashId)
          if (r.ok) {
            refreshRecentFise()
            refreshAutocomplete()
            showToast('success', 'Fișa a fost restaurată.')
          } else {
            showToast('error', `Restaurarea a eșuat: ${r.error.message}`)
          }
        }
        showToast('success', 'Fișa finalizată a fost ștearsă (în coș 30 de zile).', {
          label: 'Anulează',
          onClick: restore
        })
      } else {
        showToast('success', 'Fișa finalizată a fost ștearsă.')
      }
      refreshRecentFise()
      return true
    },
    [confirmAction, showToast, refreshRecentFise, refreshAutocomplete]
  )

  return {
    recentFise,
    autocomplete,
    refreshRecentFise,
    refreshAutocomplete,
    handleOpenPdfFromSearch,
    handlePrintPdfFromList,
    handleDeleteFinalized
  }
}
