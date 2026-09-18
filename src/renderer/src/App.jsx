import React, { useCallback, useEffect, useRef, useState } from 'react'
import FisaForm from './components/FisaForm'
import ListaItems from './components/ListaItems'
import Totaluri from './components/Totaluri'
import Toast from './components/Toast'
import ConfirmDialog from './components/ConfirmDialog'
import DraftsSidebar from './components/DraftsSidebar'
import SearchModal from './components/SearchModal'
import UpdateBanner from './components/UpdateBanner'
import ThemeToggle from './components/ThemeToggle'
import SettingsModal from './components/SettingsModal'
import ReportsModal from './components/ReportsModal'
import VehicleHistoryModal from './components/VehicleHistoryModal'
import OverflowMenu from './components/OverflowMenu'
import Icon from './components/Icon'
import { formatLei } from './format'
import { validateFisa, reduceriDinFisa, isFisaEmpty, calcTotaluri } from '../../shared/calculations'
import { draftBackupRef } from './draftBackup'

// Prima salvare (cand fisa capata continut) e instanta, ca sa apara imediat
// in "Fise in lucru". Salvarile urmatoare se fac la scurt timp dupa ce
// utilizatorul se opreste din tastat, nu pe fiecare litera.
const AUTOSAVE_DEBOUNCE_MS = 1000

// Data LOCALA (nu UTC): toISOString() ar da ziua precedenta dupa miezul noptii
// intr-un fus orar cu offset pozitiv.
function todayISO() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
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
    reducerePiesePercent: 0,
    reducereLucrariPercent: 0
  }
}

// Fisele salvate inainte de separarea reducerii in piese/lucrari au un singur
// camp `reducerePercent`. Il migram la deschidere in cele doua campuri noi,
// ca formularul si PDF-ul sa lucreze mereu cu aceeasi forma de date.
function normalizeFisa(f) {
  if (!f) return f
  if (f.reducerePiesePercent !== undefined || f.reducereLucrariPercent !== undefined) return f
  if (f.reducerePercent === undefined) return f
  const { reducerePercent, ...rest } = f
  const r = reduceriDinFisa(f)
  return { ...rest, reducerePiesePercent: r.piese, reducereLucrariPercent: r.lucrari }
}

export default function App() {
  const [fisa, setFisa] = useState(emptyFisa)
  const [drafts, setDrafts] = useState([])
  const [errors, setErrors] = useState({})
  const [toasts, setToasts] = useState([])
  const toastIdRef = useRef(0)
  const [releasing, setReleasing] = useState(false)
  const [pdfRetry, setPdfRetry] = useState(null) // { fisa, baseName }
  const saveTimerRef = useRef(null)
  const hasSavedOnceRef = useRef(false)
  // Creste de fiecare data cand comutam pe alta fisa (noua/deschisa/editata).
  // Un autosave in curs cand utilizatorul comuta poate raspunde DUPA ce fisa
  // curenta s-a schimbat deja - fara acest gard, i-ar "lipi" id-ul vechi
  // peste fisa noua (arata ca "nu pot crea o fisa noua, tot in cea veche
  // raman"). Rezultatul unei salvari e aplicat doar daca generatia se potriveste.
  const fisaGenRef = useRef(0)
  const manualUpdateCheckRef = useRef(false)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [reportsOpen, setReportsOpen] = useState(false)
  const [vehicleHistoryQuery, setVehicleHistoryQuery] = useState(null) // { vin, nrInmatriculare }
  const [recentFise, setRecentFise] = useState([])
  const [updateInfo, setUpdateInfo] = useState({ status: 'idle' })
  const [updateFlash, setUpdateFlash] = useState(null) // 'no-update' | 'error' - dispare singur dupa cateva secunde
  const [autocomplete, setAutocomplete] = useState({ marci: [], modelePerMarca: {}, piese: [], lucrari: [] })
  const [saveState, setSaveState] = useState('idle') // idle | saving | saved
  const [exportingLogs, setExportingLogs] = useState(false)
  // Blocheaza autosave-ul "instant" de la pornire pana stim daca exista deja
  // un draft gol de refolosit - altfel castiga cursa cu IPC-ul de listDrafts
  // si salveaza un draft nou inainte sa apucam sa-l refolosim pe cel vechi.
  const [initialCheckDone, setInitialCheckDone] = useState(false)

  const draftsRef = useRef([])
  const searchBoxRef = useRef(null)
  const searchInputRef = useRef(null)
  const savedAtRef = useRef(null)

  const showToast = useCallback((type, message, action, opts) => {
    const id = ++toastIdRef.current
    setToasts((ts) => [...ts, { id, type, message, action, sticky: opts?.sticky }])
  }, [])

  const closeToast = useCallback((id) => setToasts((ts) => ts.filter((t) => t.id !== id)), [])

  // Inlocuieste window.confirm() nativ (arata cu titlul procesului si stilul
  // brut al SO, in afara temei aplicatiei) cu un dialog propriu. confirmAction
  // pastreaza acelasi API simplu (Promise<boolean>, await-uibil de la locul
  // de apel), doar ca randarea reala e delegata catre ConfirmDialog de mai
  // jos, controlat prin confirmState.
  const [confirmState, setConfirmState] = useState(null)
  const confirmAction = useCallback((message, opts) => {
    return new Promise((resolve) => {
      setConfirmState({ message, resolve, ...opts })
    })
  }, [])
  const handleConfirmResult = useCallback(
    (result) => {
      confirmState?.resolve(result)
      setConfirmState(null)
    },
    [confirmState]
  )

  // Daca exista mai multe drafturi goale simultan (acumulate din pornirile
  // anterioare, inainte de acest fix), pastram doar cel mai recent si stergem
  // restul - nu are rost sa tinem 5 "Fisa noua" identice si goale.
  async function dedupeEmptyDrafts(allDrafts, keepId) {
    const goale = allDrafts.filter((d) => isFisaEmpty(d) && d.id !== keepId)
    if (goale.length <= 1) return allDrafts
    const sorted = [...goale].sort((a, b) => (b.id || '').localeCompare(a.id || ''))
    const deStars = sorted.slice(1)
    for (const d of deStars) {
      await window.serviceAuto.fisa.deleteDraft(d.id)
    }
    const idsSterse = new Set(deStars.map((d) => d.id))
    return allDrafts.filter((d) => !idsSterse.has(d.id))
  }

  const refreshDrafts = useCallback(async () => {
    const res = await window.serviceAuto.fisa.listDrafts()
    if (!res.ok) {
      showToast('error', res.error.message)
      return []
    }
    const deduped = await dedupeEmptyDrafts(res.data, draftBackupRef.current?.id)
    draftsRef.current = deduped
    setDrafts(deduped)
    return deduped
  }, [showToast])

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

  useEffect(() => {
    // Refolosim un draft gol existent in loc sa cream automat unul nou la
    // fiecare pornire a aplicatiei - altfel se acumuleaza cate o "Fisa noua"
    // goala de fiecare data cand deschizi/repornesti aplicatia.
    refreshDrafts().then((deduped) => {
      const golExistent = deduped.find((d) => isFisaEmpty(d))
      if (golExistent) {
        fisaGenRef.current += 1
        hasSavedOnceRef.current = true
        setFisa(normalizeFisa(golExistent))
        setSaveState('saved')
      }
      setInitialCheckDone(true)
    })
    refreshRecentFise()
    refreshAutocomplete()
    window.serviceAuto.fise.getLocationInfo().then((res) => {
      if (!res.ok) return
      if (res.data.recoveredFromSafetyBackup) {
        showToast(
          'error',
          'Folderul principal de date a fost găsit gol la pornire - fișele au fost restaurate automat din backup-ul de siguranță.'
        )
      } else if (res.data.migratedFromLegacy) {
        showToast(
          'success',
          'Datele au fost mutate automat într-o locație mai sigură (nu mai dispar la actualizări).'
        )
      } else if (res.data.usingFallback) {
        showToast(
          'error',
          `Folderul din proiect nu e scriptibil - fișele se salvează în schimb în ${res.data.dir}`
        )
      }
    })
  }, [refreshDrafts, refreshRecentFise, refreshAutocomplete, showToast])

  useEffect(() => {
    draftBackupRef.current = fisa
  }, [fisa])

  // Panoul de rezultate e un dropdown ancorat (nu mai are propriul backdrop
  // intunecat peste tot ecranul) - fara asta, click-ul in afara lui n-ar mai
  // avea cum sa-l inchida. Aceeasi conventie ca la Autocomplete/OverflowMenu.
  useEffect(() => {
    if (!searchQuery.trim()) return undefined
    function handleClickOutside(e) {
      // Nu inchidem panoul de cautare la click-uri in alte overlay-uri proprii
      // (ex: ConfirmDialog deschis din interiorul SearchModal, la stergerea
      // unui rezultat) - acelea sunt randate la nivel de App, in afara
      // .search-box, dar fac parte din acelasi flux, nu sunt "in afara".
      if (e.target.closest?.('.confirm-overlay')) return
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target)) setSearchQuery('')
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [searchQuery])

  // Procesul principal e intr-o stare nedefinita dupa o exceptie neprinsa -
  // fara acest anunt, aplicatia parea sa mearga normal in continuare pe
  // ecran, desi ceva a mers prost undeva. Un toast sticky (nu dispare
  // singur) cere explicit un restart, la prima ocazie convenabila - fisa
  // curenta ramane oricum salvata ca draft prin autosave.
  useEffect(() => {
    const unsubscribe = window.serviceAuto.app.onFatalError(() => {
      showToast(
        'error',
        'Aplicația a întâlnit o eroare neașteptată. Salvează-ți lucrul în curs și repornește-o când poți.',
        null,
        { sticky: true }
      )
    })
    return unsubscribe
  }, [showToast])

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

      // Doar starea butonului "Verifica actualizari" - fara toast in plus,
      // ar duplica exact acelasi mesaj de doua ori pe ecran.
      if (evt.type === 'not-available') {
        setUpdateFlash('no-update')
        setTimeout(() => setUpdateFlash(null), 3000)
      } else if (evt.type === 'error') {
        setUpdateFlash('error')
        setTimeout(() => setUpdateFlash(null), 3000)
      }
    })
    return unsubscribe
  }, [showToast])

  // Starea completa a butonului "Verifica actualizari" - utilizatorul trebuie
  // sa vada in orice moment ce se intampla efectiv (verifica, nu a gasit
  // nimic, descarca cu procent, gata de instalat), nu doar un text static.
  function getUpdateButtonState() {
    if (checkingUpdates) return { text: 'Se verifică...', variant: 'info' }
    if (updateInfo.status === 'downloading') {
      return { text: `Se descarcă... ${updateInfo.percent ?? 0}%`, variant: 'info' }
    }
    if (updateInfo.status === 'downloaded') return { text: 'Gata de instalat', variant: 'success' }
    if (updateInfo.status === 'available') return { text: `Versiune nouă: v${updateInfo.version}`, variant: 'accent' }
    if (updateFlash === 'no-update') return { text: 'Ești la zi', variant: 'success' }
    if (updateFlash === 'error') return { text: 'Verificare eșuată', variant: 'error' }
    return { text: 'Verifică actualizări', variant: null }
  }

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
    if (!initialCheckDone) return undefined

    const isFirstSave = !fisa.id && !hasSavedOnceRef.current
    const delay = isFirstSave ? 0 : AUTOSAVE_DEBOUNCE_MS
    const gen = fisaGenRef.current

    saveTimerRef.current = setTimeout(async () => {
      hasSavedOnceRef.current = true
      setSaveState('saving')
      const res = await window.serviceAuto.fisa.saveDraft(fisa)
      if (fisaGenRef.current !== gen) return // utilizatorul a comutat deja pe alta fisa - ignoram rezultatul
      if (res.ok) {
        if (!fisa.id) setFisa((f) => (f.id ? f : { ...f, id: res.data }))
        savedAtRef.current = new Date()
        setSaveState('saved')
        refreshDrafts()
      } else {
        setSaveState('idle')
        showToast('error', `Salvare automată eșuată: ${res.error.message}`)
      }
    }, delay)

    return () => clearTimeout(saveTimerRef.current)
  }, [fisa, refreshDrafts, showToast, initialCheckDone])

  const resetToNewFisa = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    fisaGenRef.current += 1
    hasSavedOnceRef.current = false
    setSaveState('idle')
    setFisa(emptyFisa())
  }, [])

  const handleOpenDraft = useCallback(
    async (id) => {
      const res = await window.serviceAuto.fisa.loadDraft(id)
      if (res.ok) {
        fisaGenRef.current += 1
        hasSavedOnceRef.current = true
        setFisa(normalizeFisa(res.data))
        setErrors({})
        setPdfRetry(null)
        setSaveState('saved')
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
    refreshAutocomplete()
    const deduped = await refreshDrafts()
    if (deduped.length > 0) {
      await handleOpenDraft(deduped[0].id)
    } else {
      resetToNewFisa()
      setErrors({})
      setPdfRetry(null)
    }
  }

  const handleNewFisa = useCallback(() => {
    // Daca fisa curenta e deja o fisa noua, goala, nu mai cream inca una -
    // ar duplica "Fisa noua" in sidebar la fiecare click. Citim din ref (nu
    // din state) ca handleNewFisa sa ramana stabil intre randari.
    if (isFisaEmpty(draftBackupRef.current)) {
      showToast('success', 'Ești deja pe o fișă nouă, goală.')
      return
    }
    // Sau, daca exista deja un draft gol NEFOLOSIT in lista (creat mai
    // devreme si abandonat), il redeschidem in loc sa cream un altul.
    const golExistent = draftsRef.current.find((d) => isFisaEmpty(d))
    if (golExistent) {
      handleOpenDraft(golExistent.id)
      return
    }
    resetToNewFisa()
    setErrors({})
    setPdfRetry(null)
  }, [resetToNewFisa, showToast, handleOpenDraft])

  // Scurtaturi: Ctrl+K muta focusul in cautare, Ctrl+N deschide o fisa noua.
  useEffect(() => {
    function onKey(e) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      } else if (k === 'n') {
        e.preventDefault()
        handleNewFisa()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [handleNewFisa])

  async function handleRelease() {
    const { valid, errors: localErrors } = validateFisa(fisa)
    setErrors(localErrors)
    if (!valid) {
      showToast('error', 'Fișa conține câmpuri incomplete sau invalide. Verifică câmpurile evidențiate cu roșu.')
      return
    }

    // Fara asta, un autosave programat (debounce de 1s) care ajunge sa se
    // execute DUPA ce finalize() a reusit mai jos ar re-salva fisa curenta
    // ca draft - o fisa "fantoma" duplicata in "Fise in lucru", desi tocmai
    // a fost finalizata cu succes. Cresterea generatiei blocheaza si orice
    // autosave deja pornit (in curs de await) sa-si mai aplice rezultatul.
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    fisaGenRef.current += 1

    setReleasing(true)
    const res = await window.serviceAuto.fisa.finalize(fisa)
    setReleasing(false)

    if (!res.ok) {
      if (res.error.code === 'VALIDATION' && res.error.fields) setErrors(res.error.fields)
      showToast('error', res.error.message)
      return
    }

    if (res.data.pdfSaved) {
      showToast(
        'success',
        res.data.replaced
          ? `Fișă actualizată și PDF salvat: ${res.data.baseName}.pdf`
          : `Fișă finalizată și PDF salvat: ${res.data.baseName}.pdf`,
        { label: 'Printează', onClick: () => handlePrintPdf(res.data.baseName) }
      )
      await goToNextDraftOrNew()
    } else {
      setPdfRetry({ fisa: res.data.fisa, baseName: res.data.baseName })
      showToast(
        'error',
        `Fișa a fost salvată, dar PDF-ul a eșuat: ${res.data.pdfError}`,
        { label: 'Reîncearcă PDF', onClick: () => handleRetryPdf(res.data.fisa, res.data.baseName) }
      )
      refreshDrafts()
    }
  }

  async function handlePrintPdf(baseName) {
    const res = await window.serviceAuto.fise.printPdf(baseName)
    if (!res.ok) showToast('error', res.error.message)
  }

  async function handleRetryPdf(finalFisa, baseName) {
    const res = await window.serviceAuto.fisa.retryPdf({ fisa: finalFisa, baseName })
    if (res.ok) {
      showToast('success', `PDF salvat: ${baseName}.pdf`, {
        label: 'Printează',
        onClick: () => handlePrintPdf(baseName)
      })
      setPdfRetry(null)
      await goToNextDraftOrNew()
    } else {
      showToast('error', `PDF tot a eșuat: ${res.error.message}`, {
        label: 'Reîncearcă',
        onClick: () => handleRetryPdf(finalFisa, baseName)
      })
    }
  }

  async function handleOpenFolder() {
    const res = await window.serviceAuto.fise.openFolder()
    if (!res.ok) showToast('error', res.error.message)
  }

  async function handleExportLogs() {
    setExportingLogs(true)
    const res = await window.serviceAuto.app.exportLogs()
    setExportingLogs(false)
    if (res.ok) {
      showToast('success', `Loguri exportate pe Desktop (${res.data.copied} fișiere) - trimite folderul pentru depanare.`)
    } else {
      showToast('error', res.error.message)
    }
  }

  // "Editeaza" pe o lucrare recenta porneste un draft nou (fisa finalizata
  // originala nu se modifica cat timp editarea e doar in lucru - daca
  // utilizatorul abandoneaza editarea fara sa apese din nou Finalizare,
  // originalul ramane intact). _replaceBaseName retine numele fisierului
  // original: cand editarea e efectiv finalizata, finalizeFisa() il
  // foloseste ca sa suprascrie acea fisa (JSON + PDF), nu sa creeze una noua
  // separata pentru aceeasi lucrare.
  const handleEditRecent = useCallback((finalizedFisa) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    fisaGenRef.current += 1
    hasSavedOnceRef.current = false
    setSaveState('idle')
    const { _file, id, status, finalizedAt, ...rest } = finalizedFisa
    setFisa(
      normalizeFisa({
        ...rest,
        id: null,
        _replaceBaseName: _file ? _file.replace(/\.json$/, '') : null
      })
    )
    setErrors({})
    setPdfRetry(null)
  }, [])

  // Handlere stabile pentru ListaItems/Totaluri - memo() pe acele componente
  // (vezi ListaItems.jsx/Totaluri.jsx) are efect real doar daca props-urile
  // functie primite au aceeasi referinta intre randari; inline arrows aici
  // ar recrea o functie noua la fiecare randare a App.jsx si ar anula memo().
  const handlePieseChange = useCallback((piese) => setFisa((f) => ({ ...f, piese })), [])
  const handleLucrariChange = useCallback((lucrari) => setFisa((f) => ({ ...f, lucrari })), [])
  const handleReducerePieseChange = useCallback((v) => setFisa((f) => ({ ...f, reducerePiesePercent: v })), [])
  const handleReducereLucrariChange = useCallback((v) => setFisa((f) => ({ ...f, reducereLucrariPercent: v })), [])
  const handleShowVehicleHistory = useCallback(
    (vin, nr) => setVehicleHistoryQuery({ vin, nrInmatriculare: nr }),
    []
  )

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
        'Ștergi definitiv această fișă finalizată? PDF-ul și înregistrarea dispar ireversibil.',
        { confirmLabel: 'Șterge' }
      )
      if (!ok) return false
      const res = await window.serviceAuto.fisa.deleteFinalizata(fileName)
      if (!res.ok) {
        showToast('error', res.error.message)
        return false
      }
      showToast('success', 'Fișa finalizată a fost ștearsă.')
      refreshRecentFise()
      return true
    },
    [confirmAction, showToast, refreshRecentFise]
  )

  const handleOpenSettings = useCallback(() => setSettingsOpen(true), [])

  const updateBtn = getUpdateButtonState()
  const totals = calcTotaluri(fisa.piese, fisa.lucrari, fisa.reducerePiesePercent, fisa.reducereLucrariPercent)
  const plate = fisa.auto.nrInmatriculare?.trim()
  const vehicul = [fisa.auto.marca, fisa.auto.model].map((x) => x?.trim()).filter(Boolean).join(' ')
  const fisaGoala = isFisaEmpty(fisa)
  const savedTime = savedAtRef.current
    ? savedAtRef.current.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })
    : ''
  const showUpdatePill = Boolean(updateBtn.variant)

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
        onPrintPdf={handlePrintPdfFromList}
        onDeleteFinalized={handleDeleteFinalized}
        onOpenSettings={handleOpenSettings}
        confirm={confirmAction}
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
          <div className="topbar-title">
            <h1>{fisa._replaceBaseName ? 'Editare fișă' : fisaGoala ? 'Fișă nouă' : 'Fișă de service'}</h1>
            {!fisaGoala && (plate || vehicul || fisa.client.nume?.trim()) && (
              <div className="crumbs">
                {plate && <span className="plate">{plate}</span>}
                {vehicul && <span>{vehicul}</span>}
                {fisa.client.nume?.trim() && (
                  <span className="crumb-client">
                    <Icon name="user" size={13} /> {fisa.client.nume.trim()}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="topbar-actions">
            <div className="search-box" ref={searchBoxRef}>
              <Icon name="search" size={15} className="search-icon" />
              <input
                type="text"
                ref={searchInputRef}
                className="topbar-search"
                placeholder="Caută"
                aria-label="Caută fișe"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setSearchQuery('')
                }}
              />
              {!searchQuery && <kbd className="search-kbd">Ctrl+K</kbd>}
              {searchQuery.trim() && (
                <SearchModal
                  query={searchQuery}
                  onClose={() => setSearchQuery('')}
                  onOpenPdf={handleOpenPdfFromSearch}
                  onPrintPdf={handlePrintPdfFromList}
                  onDeleteFinalized={handleDeleteFinalized}
                  showToast={showToast}
                />
              )}
            </div>
            {showUpdatePill && (
              <button
                type="button"
                className={`btn-sm btn-status-${updateBtn.variant}`}
                disabled={checkingUpdates || updateInfo.status === 'downloading'}
                onClick={handleCheckForUpdates}
              >
                <Icon name={updateInfo.status === 'downloading' || checkingUpdates ? 'loader' : 'refresh'} />
                {updateBtn.text}
              </button>
            )}
            <OverflowMenu
              items={[
                { label: 'Rapoarte', icon: 'chart', onClick: () => setReportsOpen(true) },
                { label: 'Deschide folderul cu fișe', icon: 'folder', onClick: handleOpenFolder },
                {
                  label: updateBtn.variant ? 'Verifică actualizări' : updateBtn.text,
                  icon: 'refresh',
                  disabled: checkingUpdates || updateInfo.status === 'downloading',
                  onClick: handleCheckForUpdates
                },
                {
                  label: exportingLogs ? 'Se exportă...' : 'Exportă loguri',
                  icon: 'download',
                  onClick: handleExportLogs
                }
              ]}
            />
            <ThemeToggle />
          </div>
        </header>

        <FisaForm
          fisa={fisa}
          onChange={setFisa}
          errors={errors}
          autocomplete={autocomplete}
          onShowVehicleHistory={handleShowVehicleHistory}
        />

        <ListaItems
          titlu="Piese"
          singular="piesă"
          items={fisa.piese}
          onChange={handlePieseChange}
          priceKey="pretUnitar"
          priceLabel="Preț unitar"
          errorPrefix="piese"
          errors={errors}
          suggestions={autocomplete.piese}
          confirm={confirmAction}
        />

        <ListaItems
          titlu="Lucrări"
          singular="lucrare"
          items={fisa.lucrari}
          onChange={handleLucrariChange}
          priceKey="pret"
          priceLabel="Preț"
          errorPrefix="lucrari"
          errors={errors}
          suggestions={autocomplete.lucrari}
          confirm={confirmAction}
        />

        <Totaluri
          piese={fisa.piese}
          lucrari={fisa.lucrari}
          reducerePiesePercent={fisa.reducerePiesePercent}
          reducereLucrariPercent={fisa.reducereLucrariPercent}
          onChangeReducerePiese={handleReducerePieseChange}
          onChangeReducereLucrari={handleReducereLucrariChange}
        />

        <div className="release-bar">
          <div className="release-total">
            <span className="release-total-label">Total final</span>
            <span className="release-total-value">{formatLei(totals.totalFinal)}</span>
          </div>
          <span className={`chip autosave-status ${saveState === 'saved' ? 'saved' : ''}`}>
            {saveState === 'saving' && (
              <>
                <Icon name="loader" size={13} className="spin" /> Se salvează...
              </>
            )}
            {saveState === 'saved' && (
              <>
                <Icon name="check" size={13} /> Salvat{savedTime && ` ${savedTime}`}
              </>
            )}
          </span>
          <div className="release-bar-actions">
            {pdfRetry && (
              <button type="button" onClick={() => handleRetryPdf(pdfRetry.fisa, pdfRetry.baseName)}>
                <Icon name="refresh" /> Reîncearcă generarea PDF
              </button>
            )}
            <button type="button" className="btn-primary btn-release" disabled={releasing} onClick={handleRelease}>
              {releasing ? (
                <>
                  <Icon name="loader" className="spin" /> Se finalizează...
                </>
              ) : (
                <>
                  <Icon name="check" /> Finalizează fișa
                </>
              )}
            </button>
          </div>
        </div>
      </main>

      <Toast toasts={toasts} onClose={closeToast} />

      <ConfirmDialog state={confirmState} onResult={handleConfirmResult} />

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} showToast={showToast} />}

      {reportsOpen && <ReportsModal onClose={() => setReportsOpen(false)} showToast={showToast} />}

      {vehicleHistoryQuery && (
        <VehicleHistoryModal
          vin={vehicleHistoryQuery.vin}
          nrInmatriculare={vehicleHistoryQuery.nrInmatriculare}
          onClose={() => setVehicleHistoryQuery(null)}
          onOpenPdf={handleOpenPdfFromSearch}
          onPrintPdf={handlePrintPdfFromList}
          onDeleteFinalized={handleDeleteFinalized}
          showToast={showToast}
        />
      )}
    </div>
  )
}
