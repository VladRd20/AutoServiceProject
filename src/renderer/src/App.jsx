import React, { useCallback, useEffect, useRef, useState } from 'react'
import FisaForm from './components/FisaForm'
import ListaItems from './components/ListaItems'
import Totaluri from './components/Totaluri'
import Toast from './components/Toast'
import DraftsSidebar from './components/DraftsSidebar'
import SearchModal from './components/SearchModal'
import UpdateBanner from './components/UpdateBanner'
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

export default function App() {
  const [fisa, setFisa] = useState(emptyFisa)
  const [drafts, setDrafts] = useState([])
  const [errors, setErrors] = useState({})
  const [toast, setToast] = useState(null)
  const [releasing, setReleasing] = useState(false)
  const [pdfRetry, setPdfRetry] = useState(null) // { fisa, baseName }
  const saveTimerRef = useRef(null)
  const hasSavedOnceRef = useRef(false)
  const manualUpdateCheckRef = useRef(false)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [recentFise, setRecentFise] = useState([])
  const [updateInfo, setUpdateInfo] = useState({ status: 'idle' })

  const showToast = useCallback((type, message, action) => setToast({ type, message, action }), [])

  const refreshDrafts = useCallback(async () => {
    const res = await window.serviceAuto.fisa.listDrafts()
    if (res.ok) setDrafts(res.data)
    else showToast('error', res.error.message)
  }, [showToast])

  const refreshRecentFise = useCallback(async () => {
    const res = await window.serviceAuto.fisa.listRecent(8)
    if (res.ok) setRecentFise(res.data)
    else showToast('error', res.error.message)
  }, [showToast])

  useEffect(() => {
    refreshDrafts()
    refreshRecentFise()
    window.serviceAuto.fise.getLocationInfo().then((res) => {
      if (res.ok && res.data.usingFallback) {
        showToast(
          'error',
          `Folderul din proiect nu e scriptibil - fisele se salveaza in schimb in ${res.data.dir}`
        )
      }
    })
  }, [refreshDrafts, refreshRecentFise, showToast])

  useEffect(() => {
    draftBackupRef.current = fisa
  }, [fisa])

  // Update-urile de versiune noua/gata de instalare sunt anuntate si printr-un
  // dialog nativ (main process), dar tinem si o stare persistenta in UI
  // (banner) - daca utilizatorul inchide dialogul fara sa raspunda, tot vede
  // ca exista o actualizare disponibila, nu doar un toast care dispare.
  useEffect(() => {
    const unsubscribe = window.serviceAuto.app.onUpdateEvent((evt) => {
      if (evt.type === 'checking') {
        setCheckingUpdates(true)
        return
      }
      setCheckingUpdates(false)

      if (evt.type === 'available') {
        setUpdateInfo({ status: 'available', version: evt.version })
      } else if (evt.type === 'downloading') {
        setUpdateInfo((info) => ({ status: 'downloading', version: info.version, percent: 0 }))
      } else if (evt.type === 'progress') {
        setUpdateInfo((info) => ({ ...info, status: 'downloading', percent: evt.percent }))
      } else if (evt.type === 'downloaded') {
        setUpdateInfo({ status: 'downloaded', version: evt.version })
      }

      if (!manualUpdateCheckRef.current) return
      manualUpdateCheckRef.current = false

      if (evt.type === 'not-available') {
        showToast('success', 'Ai deja cea mai recenta versiune.')
      } else if (evt.type === 'error') {
        showToast('error', `Verificarea actualizarilor a esuat: ${evt.message || 'eroare necunoscuta'}.`)
      }
    })
    return unsubscribe
  }, [showToast])

  function handleCheckForUpdates() {
    manualUpdateCheckRef.current = true
    window.serviceAuto.app.checkForUpdates()
  }

  function handleDownloadUpdate() {
    window.serviceAuto.app.downloadUpdate()
  }

  function handleInstallUpdate() {
    window.serviceAuto.app.installUpdate()
  }

  // Autosave: prima salvare e instanta (fisa apare imediat in "Fise in lucru",
  // chiar goala, sub o denumire generica), salvarile urmatoare sunt
  // debounce-uite ca sa nu scriem pe disc la fiecare apasare de tasta.
  useEffect(() => {
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

  const resetToNewFisa = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    hasSavedOnceRef.current = false
    setFisa(emptyFisa())
  }, [])

  const handleOpenDraft = useCallback(
    async (id) => {
      const res = await window.serviceAuto.fisa.loadDraft(id)
      if (res.ok) {
        setFisa(res.data)
        setErrors({})
        setPdfRetry(null)
      } else {
        showToast('error', res.error.message)
      }
    },
    [showToast]
  )

  // Referinta stabila (deps: doar id-ul fisei curente) - altfel DraftsSidebar
  // s-ar re-randa la fiecare litera tastata in formular, desi lista de
  // drafturi/lucrari recente nu s-a schimbat deloc.
  const handleDeleteDraft = useCallback(
    async (id) => {
      const res = await window.serviceAuto.fisa.deleteDraft(id)
      if (res.ok) {
        if (fisa.id === id) resetToNewFisa()
        refreshDrafts()
      } else {
        showToast('error', res.error.message)
      }
    },
    [fisa.id, resetToNewFisa, refreshDrafts, showToast]
  )

  // Dupa finalizare, trecem la o alta fisa in lucru daca exista una (cazul
  // uzual la un flux cu mai multe masini in paralel); daca nu mai e nimic
  // in lucru, deschidem o fisa noua goala.
  async function goToNextDraftOrNew() {
    refreshRecentFise()
    const res = await window.serviceAuto.fisa.listDrafts()
    if (!res.ok) {
      showToast('error', res.error.message)
      resetToNewFisa()
      setErrors({})
      setPdfRetry(null)
      return
    }

    setDrafts(res.data)
    if (res.data.length > 0) {
      await handleOpenDraft(res.data[0].id)
    } else {
      resetToNewFisa()
      setErrors({})
      setPdfRetry(null)
    }
  }

  const handleNewFisa = useCallback(() => {
    resetToNewFisa()
    setErrors({})
    setPdfRetry(null)
  }, [resetToNewFisa])

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
      await goToNextDraftOrNew()
    } else {
      setPdfRetry({ fisa: res.data.fisa, baseName: res.data.baseName })
      showToast(
        'error',
        `Fisa a fost salvata, dar PDF-ul a esuat: ${res.data.pdfError}`,
        { label: 'Reincearca PDF', onClick: () => handleRetryPdf(res.data.fisa, res.data.baseName) }
      )
      refreshDrafts()
    }
  }

  async function handleRetryPdf(finalFisa, baseName) {
    const res = await window.serviceAuto.fisa.retryPdf({ fisa: finalFisa, baseName })
    if (res.ok) {
      showToast('success', `PDF salvat: ${baseName}.pdf`)
      setPdfRetry(null)
      await goToNextDraftOrNew()
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

  async function handleExportLogs() {
    const res = await window.serviceAuto.app.exportLogs()
    if (res.ok) {
      showToast('success', `Loguri exportate pe Desktop (${res.data.copied} fisiere) - trimite folderul pentru debugging.`)
    } else {
      showToast('error', res.error.message)
    }
  }

  // "Editeaza" pe o lucrare recenta nu modifica fisa finalizata/PDF-ul
  // existent - creeaza o fisa noua, in lucru, pre-completata cu aceleasi
  // date, ca istoricul deja finalizat sa ramana intact.
  const handleEditRecent = useCallback((finalizedFisa) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    hasSavedOnceRef.current = false
    const { _file, id, status, finalizedAt, ...rest } = finalizedFisa
    setFisa({ ...rest, id: null })
    setErrors({})
    setPdfRetry(null)
  }, [])

  const handleOpenPdfFromSearch = useCallback(
    async (fileName) => {
      const res = await window.serviceAuto.fise.openPdf(fileName)
      if (!res.ok) showToast('error', res.error.message)
    },
    [showToast]
  )

  return (
    <div className="app">
      <DraftsSidebar
        drafts={drafts}
        currentId={fisa.id}
        onOpen={handleOpenDraft}
        onDelete={handleDeleteDraft}
        onNew={handleNewFisa}
        recentFise={recentFise}
        onEditRecent={handleEditRecent}
        onOpenPdf={handleOpenPdfFromSearch}
      />

      <main className="main">
        <UpdateBanner
          status={updateInfo.status}
          version={updateInfo.version}
          percent={updateInfo.percent}
          onDownload={handleDownloadUpdate}
          onInstall={handleInstallUpdate}
        />

        <header className="topbar">
          <h1>Fisa de service auto</h1>
          <div className="topbar-actions">
            <button type="button" onClick={() => setSearchOpen(true)}>
              Cauta clienti
            </button>
            <button type="button" disabled={checkingUpdates} onClick={handleCheckForUpdates}>
              {checkingUpdates ? 'Se verifica...' : 'Verifica actualizari'}
            </button>
            <button type="button" onClick={handleOpenFolder}>
              Deschide folderul cu fise
            </button>
            <button type="button" title="Exporta fisierele de log pe Desktop, pentru debugging" onClick={handleExportLogs}>
              Exporta loguri
            </button>
          </div>
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

      {searchOpen && (
        <SearchModal
          onClose={() => setSearchOpen(false)}
          onOpenPdf={handleOpenPdfFromSearch}
          showToast={showToast}
        />
      )}
    </div>
  )
}
