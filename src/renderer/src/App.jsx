import React, { useCallback, useEffect, useRef, useState } from 'react'
import FisaForm from './components/FisaForm'
import ListaItems from './components/ListaItems'
import Totaluri from './components/Totaluri'
import Toast from './components/Toast'
import DraftsSidebar from './components/DraftsSidebar'
import { validateFisa } from '../../shared/calculations'
import { draftBackupRef } from './draftBackup'

// Prima salvare (cand fisa capata continut) e instanta, ca sa apara imediat
// in "Fise in lucru". Salvarile urmatoare se fac la scurt timp dupa ce
// utilizatorul se opreste din tastat, nu pe fiecare litera.
const AUTOSAVE_DEBOUNCE_MS = 1000

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function emptyFisa() {
  return {
    id: null,
    client: { nume: '', telefon: '' },
    auto: { nrInmatriculare: '', marca: '', model: '', vin: '', an: '' },
    data: todayISO(),
    dataCurenta: true,
    piese: [],
    lucrari: [],
    reducerePercent: 0
  }
}

function fisaAreContinut(fisa) {
  return Boolean(fisa.client.nume?.trim() || fisa.auto.nrInmatriculare?.trim())
}

export default function App() {
  const [fisa, setFisa] = useState(emptyFisa)
  const [drafts, setDrafts] = useState([])
  const [errors, setErrors] = useState({})
  const [toast, setToast] = useState(null)
  const [releasing, setReleasing] = useState(false)
  const [pdfRetry, setPdfRetry] = useState(null) // { fisa, baseName }
  const saveTimerRef = useRef(null)
  const hasSavedOnceRef = useRef(false)

  const showToast = useCallback((type, message, action) => setToast({ type, message, action }), [])

  const refreshDrafts = useCallback(async () => {
    const res = await window.serviceAuto.fisa.listDrafts()
    if (res.ok) setDrafts(res.data)
    else showToast('error', res.error.message)
  }, [showToast])

  useEffect(() => {
    refreshDrafts()
    window.serviceAuto.fise.getLocationInfo().then((res) => {
      if (res.ok && res.data.usingFallback) {
        showToast(
          'error',
          `Folderul din proiect nu e scriptibil - fisele se salveaza in schimb in ${res.data.dir}`
        )
      }
    })
  }, [refreshDrafts, showToast])

  useEffect(() => {
    draftBackupRef.current = fisa
  }, [fisa])

  // Autosave: prima salvare e instanta (fisa apare imediat in sidebar la primul
  // caracter), salvarile urmatoare sunt debounce-uite ca sa nu scriem pe disc
  // la fiecare apasare de tasta.
  useEffect(() => {
    if (!fisaAreContinut(fisa)) return undefined

    const isFirstSave = !fisa.id && !hasSavedOnceRef.current
    const delay = isFirstSave ? 0 : AUTOSAVE_DEBOUNCE_MS

    saveTimerRef.current = setTimeout(async () => {
      hasSavedOnceRef.current = true
      const res = await window.serviceAuto.fisa.saveDraft(fisa)
      if (res.ok) {
        if (!fisa.id) setFisa((f) => (f.id ? f : { ...f, id: res.data }))
        refreshDrafts()
      } else {
        showToast('error', `Autosave esuat: ${res.error.message}`)
      }
    }, delay)

    return () => clearTimeout(saveTimerRef.current)
  }, [fisa, refreshDrafts, showToast])

  async function handleOpenDraft(id) {
    const res = await window.serviceAuto.fisa.loadDraft(id)
    if (res.ok) {
      setFisa(res.data)
      setErrors({})
      setPdfRetry(null)
    } else {
      showToast('error', res.error.message)
    }
  }

  async function handleDeleteDraft(id) {
    const res = await window.serviceAuto.fisa.deleteDraft(id)
    if (res.ok) {
      if (fisa.id === id) resetToNewFisa()
      refreshDrafts()
    } else {
      showToast('error', res.error.message)
    }
  }

  function resetToNewFisa() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    hasSavedOnceRef.current = false
    setFisa(emptyFisa())
  }

  function handleNewFisa() {
    resetToNewFisa()
    setErrors({})
    setPdfRetry(null)
  }

  async function handleRelease() {
    const { valid, errors: localErrors } = validateFisa(fisa)
    setErrors(localErrors)
    if (!valid) {
      showToast('error', 'Fisa contine campuri incomplete sau invalide. Verifica evidentiate cu rosu.')
      return
    }

    setReleasing(true)
    const res = await window.serviceAuto.fisa.finalize(fisa)
    setReleasing(false)

    if (!res.ok) {
      if (res.error.code === 'VALIDATION' && res.error.fields) setErrors(res.error.fields)
      showToast('error', res.error.message)
      return
    }

    if (res.data.pdfSaved) {
      showToast('success', `Fisa finalizata si PDF salvat: ${res.data.baseName}.pdf`)
      resetToNewFisa()
      setErrors({})
      setPdfRetry(null)
    } else {
      setPdfRetry({ fisa: res.data.fisa, baseName: res.data.baseName })
      showToast(
        'error',
        `Fisa a fost salvata, dar PDF-ul a esuat: ${res.data.pdfError}`,
        { label: 'Reincearca PDF', onClick: () => handleRetryPdf(res.data.fisa, res.data.baseName) }
      )
    }
    refreshDrafts()
  }

  async function handleRetryPdf(finalFisa, baseName) {
    const res = await window.serviceAuto.fisa.retryPdf({ fisa: finalFisa, baseName })
    if (res.ok) {
      showToast('success', `PDF salvat: ${baseName}.pdf`)
      setPdfRetry(null)
      resetToNewFisa()
    } else {
      showToast('error', `PDF tot a esuat: ${res.error.message}`, {
        label: 'Reincearca',
        onClick: () => handleRetryPdf(finalFisa, baseName)
      })
    }
  }

  async function handleOpenFolder() {
    const res = await window.serviceAuto.fise.openFolder()
    if (!res.ok) showToast('error', res.error.message)
  }

  return (
    <div className="app">
      <DraftsSidebar
        drafts={drafts}
        currentId={fisa.id}
        onOpen={handleOpenDraft}
        onDelete={handleDeleteDraft}
        onNew={handleNewFisa}
      />

      <main className="main">
        <header className="topbar">
          <h1>Fisa de service auto</h1>
          <button type="button" onClick={handleOpenFolder}>
            Deschide folderul cu fise
          </button>
        </header>

        <FisaForm fisa={fisa} onChange={setFisa} errors={errors} />

        <ListaItems
          titlu="Piese"
          items={fisa.piese}
          onChange={(piese) => setFisa({ ...fisa, piese })}
          priceKey="pretUnitar"
          priceLabel="Pret unitar"
          errorPrefix="piese"
          errors={errors}
        />

        <ListaItems
          titlu="Lucrari"
          items={fisa.lucrari}
          onChange={(lucrari) => setFisa({ ...fisa, lucrari })}
          priceKey="pret"
          priceLabel="Pret"
          errorPrefix="lucrari"
          errors={errors}
        />

        <Totaluri
          piese={fisa.piese}
          lucrari={fisa.lucrari}
          reducerePercent={fisa.reducerePercent}
          onChangeReducere={(v) => setFisa({ ...fisa, reducerePercent: v })}
        />

        <div className="release-bar">
          {pdfRetry && (
            <button type="button" onClick={() => handleRetryPdf(pdfRetry.fisa, pdfRetry.baseName)}>
              Reincearca generare PDF
            </button>
          )}
          <button type="button" className="btn-primary btn-release" disabled={releasing} onClick={handleRelease}>
            {releasing ? 'Se finalizeaza...' : 'Finalizare / Release'}
          </button>
        </div>
      </main>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}
