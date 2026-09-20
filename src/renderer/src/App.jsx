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
import WhatsNewModal from './components/WhatsNewModal'
import OverflowMenu from './components/OverflowMenu'
import Icon from './components/Icon'
import { formatLei } from './format'
import { validateFisa, reduceriDinFisa, isFisaEmpty, calcTotaluri } from '../../shared/calculations'
import { draftBackupRef, autosaverRef } from './draftBackup'
import { createAutosaver } from './autosave'
import './app-extra.css'

// Ultimul draft deschis - la pornire revenim direct la el.
const LAST_DRAFT_KEY = 'lastOpenDraftId'
const FIRST_RUN_KEY = 'firstRunSettingsDismissed'
const BACKUP_POLL_MS = 2 * 60 * 1000
const BACKUP_LATE_AFTER_MS = 10 * 60 * 1000

// "1 fișă" / "2 fișe"
const fise = (n) => `${n} ${n === 1 ? 'fișă' : 'fișe'}`

function lsGet(key) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}
function lsSet(key, value) {
  try {
    if (value == null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // localStorage indisponibil - nu e critic
  }
}

const APP_START = Date.now()

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
    client: { nume: '', telefon: '', cui: '' },
    auto: { nrInmatriculare: '', marca: '', model: '', vin: '', an: '' },
    km: '',
    observatii: '',
    plata: { status: '', metoda: '' },
    data: todayISO(),
    dataCurenta: true,
    piese: [],
    lucrari: [],
    reducerePiesePercent: 0,
    reducereLucrariPercent: 0
  }
}

// Completeaza campurile adaugate ulterior, ca input-urile sa ramana controlate.
function withNewFieldDefaults(f) {
  const client = f.client || {}
  const plata = f.plata || {}
  if (
    client.cui !== undefined &&
    f.km !== undefined &&
    f.observatii !== undefined &&
    f.plata &&
    plata.status !== undefined &&
    plata.metoda !== undefined
  ) {
    return f
  }
  return {
    ...f,
    client: { ...client, cui: client.cui ?? '' },
    km: f.km ?? '',
    observatii: f.observatii ?? '',
    plata: { ...plata, status: plata.status ?? '', metoda: plata.metoda ?? '' }
  }
}

// Fisele salvate inainte de separarea reducerii in piese/lucrari au un singur
// camp `reducerePercent`. Il migram la deschidere in cele doua campuri noi,
// ca formularul si PDF-ul sa lucreze mereu cu aceeasi forma de date.
function normalizeFisa(f) {
  if (!f) return f
  f = withNewFieldDefaults(f)
  if (f.reducerePiesePercent === undefined && f.reducereLucrariPercent === undefined && f.reducerePercent === undefined) {
    f = { ...f, reducerePiesePercent: 0, reducereLucrariPercent: 0 }
  }
  if (f.reducerePiesePercent !== undefined || f.reducereLucrariPercent !== undefined) return f
  if (f.reducerePercent === undefined) return f
  const { reducerePercent: _legacy, ...rest } = f
  const r = reduceriDinFisa(f)
  return { ...rest, reducerePiesePercent: r.piese, reducereLucrariPercent: r.lucrari }
}

// Chip discret pentru starea backup-ului automat.
function getBackupChip(status) {
  if (!status) return null
  const uptime = Date.now() - APP_START
  if (status.lastError) {
    return { warn: true, text: 'Backup întârziat', title: `Ultimul backup a eșuat: ${status.lastError}` }
  }
  if (!status.lastBackupAt) {
    if (uptime < BACKUP_LATE_AFTER_MS) return null
    return { warn: true, text: 'Backup întârziat', title: 'Nu s-a făcut niciun backup de la pornirea aplicației.' }
  }
  const t = new Date(status.lastBackupAt)
  const hhmm = Number.isNaN(t.getTime())
    ? ''
    : t.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })
  return { warn: false, text: `Backup ${hhmm}`, title: `Ultimul backup automat: ${t.toLocaleString('ro-RO')}` }
}

export default function App({ readOnly = false, onRequestActivation } = {}) {
  const [fisa, setFisa] = useState(emptyFisa)
  const [drafts, setDrafts] = useState([])
  const [errors, setErrors] = useState({})
  const [toasts, setToasts] = useState([])
  const toastIdRef = useRef(0)
  const [releasing, setReleasing] = useState(false)
  const [pdfRetry, setPdfRetry] = useState(null) // { fisa, baseName }
  const [locationBanner, setLocationBanner] = useState(null) // { override, dir }
  const [firstRunOpen, setFirstRunOpen] = useState(false)
  const [whatsNew, setWhatsNew] = useState(null) // { entries, markSeen }
  const whatsNewCheckedRef = useRef(false)
  const [backupStatus, setBackupStatus] = useState(null)
  const [saveError, setSaveError] = useState(null) // mesajul erorii curente de salvare
  // Refuri ca handlerele stabile (autosaver, evenimente) sa vada mereu valorile curente.
  const fisaRef = useRef(null)
  const readOnlyRef = useRef(readOnly)
  const refreshDraftsRef = useRef(null)
  const errorToastedRef = useRef(false)
  // true cat timp finalizam: nu trimitem update-uri catre autosaver, altfel
  // dupa reset(null) fisa finalizata ar fi re-salvata ca draft "fantoma".
  const suspendAutosaveRef = useRef(false)
  // true cat timp ruleaza o finalizare: comutarile de fisa/scurtaturile sunt ignorate.
  const releasingRef = useRef(false)
  const modalOpenRef = useRef(false)
  const isCurrentEmpty = useCallback(() => isFisaEmpty(fisaRef.current), [])

  // Salvarea propriu-zisa (serializare, flush, retry, garda de generatie) e in
  // autosave.js; aici doar o legam de UI. Callback-urile citesc din refuri.
  const [autosaver] = useState(() =>
    createAutosaver({
      save: (f) => window.serviceAuto.fisa.saveDraft(f),
      onState: ({ state, error, savedAt }) => {
        setSaveState(state)
        if (savedAt) setSavedAt(savedAt)
        if (state === 'error') {
          const msg = error?.message || 'Eroare necunoscută'
          setSaveError(msg)
          if (!errorToastedRef.current) {
            errorToastedRef.current = true
            showToastRef.current?.('error', `Salvare automată eșuată: ${msg}`, null, { sticky: true })
          }
        } else {
          setSaveError(null)
          errorToastedRef.current = false
          if (state === 'saved') refreshDraftsRef.current?.()
        }
      },
      onId: (id) => setFisa((f) => (f.id ? f : { ...f, id }))
    })
  )
  const showToastRef = useRef(null)
  const manualUpdateCheckRef = useRef(false)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchRange, setSearchRange] = useState({ from: '', to: '' })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const searchActive = Boolean(searchQuery.trim() || searchRange.from || searchRange.to || filtersOpen)
  const closeSearch = useCallback(() => {
    setSearchQuery('')
    setSearchRange({ from: '', to: '' })
    setFiltersOpen(false)
  }, [])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [reportsOpen, setReportsOpen] = useState(false)
  const [vehicleHistoryQuery, setVehicleHistoryQuery] = useState(null) // { vin, nrInmatriculare }
  const [recentFise, setRecentFise] = useState([])
  const [updateInfo, setUpdateInfo] = useState({ status: 'idle' })
  const [updateFlash, setUpdateFlash] = useState(null) // 'no-update' | 'error' - dispare singur dupa cateva secunde
  const [autocomplete, setAutocomplete] = useState({ marci: [], modelePerMarca: {}, piese: [], lucrari: [] })
  const [saveState, setSaveState] = useState('idle') // idle | saving | saved | error
  const [savedAt, setSavedAt] = useState(null)
  const [exportingLogs, setExportingLogs] = useState(false)
  // Blocheaza autosave-ul "instant" de la pornire pana stim daca exista deja
  // un draft gol de refolosit - altfel castiga cursa cu IPC-ul de listDrafts
  // si salveaza un draft nou inainte sa apucam sa-l refolosim pe cel vechi.
  const [initialCheckDone, setInitialCheckDone] = useState(false)

  const draftsRef = useRef([])
  const searchBoxRef = useRef(null)
  const searchInputRef = useRef(null)

  const showToast = useCallback((type, message, action, opts) => {
    const id = ++toastIdRef.current
    setToasts((ts) => [...ts, { id, type, message, action, sticky: opts?.sticky }])
    return id
  }, [])
  showToastRef.current = showToast
  fisaRef.current = fisa
  readOnlyRef.current = readOnly

  const closeToast = useCallback((id) => setToasts((ts) => ts.filter((t) => t.id !== id)), [])

  // Inlocuieste window.confirm() nativ (arata cu titlul procesului si stilul
  // brut al SO, in afara temei aplicatiei) cu un dialog propriu. confirmAction
  // pastreaza acelasi API simplu (Promise<boolean>, await-uibil de la locul
  // de apel), doar ca randarea reala e delegata catre ConfirmDialog de mai
  // jos, controlat prin confirmState.
  const [confirmState, setConfirmState] = useState(null)
  const confirmAction = useCallback((message, opts) => {
    return new Promise((resolve) => {
      // Un al doilea dialog nu are voie sa lase primul promise nerezolvat.
      setConfirmState((prev) => {
        prev?.resolve(false)
        return { message, resolve, ...opts }
      })
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
    let res
    try {
      res = await window.serviceAuto.fisa.listDrafts()
    } catch (err) {
      res = { ok: false, error: { message: err?.message || 'Lista de fișe nu a putut fi citită.' } }
    }
    if (!res.ok) {
      showToast('error', res.error.message)
      return []
    }
    let deduped = res.data
    if (!readOnlyRef.current) {
      try {
        deduped = await dedupeEmptyDrafts(res.data, fisaRef.current?.id || autosaver.getId())
      } catch {
        // curatarea drafturilor goale e un confort - lista ramane cea citita
      }
    }
    draftsRef.current = deduped
    setDrafts(deduped)
    return deduped
  }, [showToast, autosaver])
  refreshDraftsRef.current = refreshDrafts

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
    const draftsReady = refreshDrafts().then((deduped) => {
      // Mai intai revenim la ultimul draft deschis (daca exista si are continut),
      // altfel refolosim un draft gol existent.
      const lastId = lsGet(LAST_DRAFT_KEY)
      const last = lastId ? deduped.find((d) => d.id === lastId && !isFisaEmpty(d)) : null
      // Fara un "ultim draft" valid (ex: localStorage nescris dupa o inchidere fortata),
      // deschidem cel mai recent draft cu continut, apoi unul gol.
      const target = last || deduped.find((d) => !isFisaEmpty(d)) || deduped.find((d) => isFisaEmpty(d))
      if (target) {
        const loaded = normalizeFisa(target)
        autosaver.reset(loaded, { clean: true })
        setFisa(loaded)
      }
    }).finally(() => setInitialCheckDone(true))
    const recentReady = refreshRecentFise()
    refreshAutocomplete()
    // Informatiile despre refaceri/carantina se citesc DUPA prima incarcare a
    // fiselor si drafturilor: refacerea unui fisier corupt are loc chiar la citire.
    Promise.all([draftsReady, recentReady]).catch(() => {}).then(() => window.serviceAuto.fise.getLocationInfo()).then((res) => {
      if (!res.ok) return
      const d = res.data
      if (d.overrideUnavailable) {
        setLocationBanner({ override: d.overrideUnavailable, dir: d.dir })
      } else if (d.usingFallback) {
        showToast(
          'error',
          `Folderul de date nu e scriptibil - fișele se salvează temporar în ${d.dir}`,
          null,
          { sticky: true }
        )
      }
      if (d.recoveredFromSafetyBackup) {
        showToast(
          'error',
          'Folderul principal de date a fost găsit gol la pornire - fișele au fost restaurate automat din backup-ul de siguranță.'
        )
      } else if (d.migratedFromLegacy) {
        showToast(
          'success',
          'Datele au fost mutate automat într-o locație mai sigură (nu mai dispar la actualizări).'
        )
      }
      if (d.healedFise > 0) {
        showToast('warning', `${fise(d.healedFise)} ${d.healedFise === 1 ? 'lipsea' : 'lipseau'} din folderul principal și ${d.healedFise === 1 ? 'a fost restaurată' : 'au fost restaurate'} din backup.`)
      }
      if (d.mergedBackFromTemp > 0) {
        showToast('success', `${d.mergedBackFromTemp} ${d.mergedBackFromTemp === 1 ? 'fișier creat' : 'fișiere create'} temporar ${d.mergedBackFromTemp === 1 ? 'a fost adus' : 'au fost aduse'} înapoi în folderul principal.`)
      }
      if (d.quarantinedLost > 0) {
        showToast(
          'error',
          `${fise(d.quarantinedLost)} ${d.quarantinedLost === 1 ? 'este coruptă' : 'sunt corupte'} și nu ${d.quarantinedLost === 1 ? 'a putut' : 'au putut'} fi refăcut${d.quarantinedLost === 1 ? 'ă' : 'e'} — ${d.quarantinedLost === 1 ? 'este păstrată' : 'sunt păstrate'} în folderul «corupte».`,
          null,
          { sticky: true }
        )
      }
      if (d.quarantinedRestored > 0) {
        showToast('info', `${fise(d.quarantinedRestored)} ${d.quarantinedRestored === 1 ? 'coruptă a fost refăcută' : 'corupte au fost refăcute'} automat din backup.`)
      }
    })
    // Prima pornire: cerem numele service-ului daca nu e completat.
    window.serviceAuto.settings.get().then((res) => {
      if (!res.ok) return
      if (!res.data?.numeService && lsGet(FIRST_RUN_KEY) !== '1') setFirstRunOpen(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    draftBackupRef.current = readOnly ? null : fisa
    autosaverRef.current = readOnly ? null : autosaver
  }, [fisa, readOnly, autosaver])

  // Retinem ultimul draft deschis, ca la pornire sa revenim la el.
  useEffect(() => {
    if (fisa.id && !readOnly) lsSet(LAST_DRAFT_KEY, fisa.id)
  }, [fisa.id, readOnly])

  // Autosave: toata logica (prima salvare instanta, debounce, serializare,
  // retry la eroare) e in autosave.js. Aici doar ii spunem la fiecare schimbare.
  useEffect(() => {
    if (!initialCheckDone || readOnly || suspendAutosaveRef.current) return
    autosaver.update(fisa)
  }, [fisa, initialCheckDone, readOnly, autosaver])

  // Licenta revocata in timpul sesiunii: oprim autosave-ul (main refuza oricum
  // scrierile) ca sa nu reincerce la nesfarsit.
  useEffect(() => {
    if (readOnly && fisaRef.current) autosaver.reset(fisaRef.current, { clean: true })
  }, [readOnly, autosaver])

  // Inchiderea ferestrei / instalarea unui update: main cere salvarea imediata.
  useEffect(() => {
    const unsubscribe = window.serviceAuto.app.onFlushRequest(async (id) => {
      try {
        if (!readOnlyRef.current) await autosaver.flush()
      } finally {
        window.serviceAuto.app.flushDone(id)
      }
    })
    return unsubscribe
  }, [autosaver])

  // Ascundere fereastra (minimizare, schimbare tab) = moment bun de salvare.
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === 'hidden') autosaver.flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [autosaver])

  // Reload / repornire dupa eroare cu modificari nesalvate: avertizam.
  useEffect(() => {
    function onBeforeUnload(e) {
      if (autosaver.isDirty()) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [autosaver])

  // "Ce e nou": o singura data dupa o actualizare, dupa ce aplicatia s-a incarcat
  // si nu e deschisa fereastra de prima configurare.
  useEffect(() => {
    if (!initialCheckDone || firstRunOpen || whatsNewCheckedRef.current) return
    whatsNewCheckedRef.current = true
    window.serviceAuto.app
      .getWhatsNew('unseen')
      .then((res) => {
        if (res?.ok && res.data.entries.length) setWhatsNew({ entries: res.data.entries, markSeen: true })
      })
      .catch(() => {})
  }, [initialCheckDone, firstRunOpen])

  const openWhatsNew = useCallback(async () => {
    try {
      const res = await window.serviceAuto.app.getWhatsNew('recent')
      if (res?.ok && res.data.entries.length) setWhatsNew({ entries: res.data.entries, markSeen: false })
    } catch {
      // nu e critic
    }
  }, [])

  const closeWhatsNew = useCallback(() => {
    setWhatsNew((w) => {
      if (w?.markSeen) window.serviceAuto.app.markWhatsNewSeen().catch(() => {})
      return null
    })
  }, [])

  // Starea backup-ului automat: la pornire, la 2 minute si dupa finalizare.
  const refreshBackupStatus = useCallback(async () => {
    try {
      const res = await window.serviceAuto.backup.status()
      if (res?.ok) setBackupStatus(res.data)
    } catch {
      // nu e critic
    }
  }, [])
  useEffect(() => {
    refreshBackupStatus()
    const t = setInterval(refreshBackupStatus, BACKUP_POLL_MS)
    return () => clearInterval(t)
  }, [refreshBackupStatus])

  // Panoul de rezultate e un dropdown ancorat (nu mai are propriul backdrop
  // intunecat peste tot ecranul) - fara asta, click-ul in afara lui n-ar mai
  // avea cum sa-l inchida. Aceeasi conventie ca la Autocomplete/OverflowMenu.
  useEffect(() => {
    if (!searchActive) return undefined
    function handleClickOutside(e) {
      // Nu inchidem panoul de cautare la click-uri in alte overlay-uri proprii
      // (ex: ConfirmDialog deschis din interiorul SearchModal, la stergerea
      // unui rezultat) - acelea sunt randate la nivel de App, in afara
      // .search-box, dar fac parte din acelasi flux, nu sunt "in afara".
      if (e.target.closest?.('.confirm-overlay')) return
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target)) closeSearch()
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [searchActive, closeSearch])

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
        setUpdateInfo({ status: 'available', version: evt.version, notes: evt.notes })
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

  // Fisa noua, goala: nesalvata (prima modificare o salveaza; fisa goala
  // primeste totusi un draft imediat prin update()).
  const resetToNewFisa = useCallback(() => {
    const e = emptyFisa()
    autosaver.reset(e, { clean: readOnlyRef.current })
    setFisa(e)
  }, [autosaver])

  // Orice comutare pe alta fisa salveaza MAI INTAI ce e nesalvat (inainte se
  // pierdeau ultimele <1s de tastat). Daca salvarea esueaza (disc plin, folder
  // blocat), NU comutam: fisa curenta ramane pe ecran, cu modificarile in ea.
  const flushOrAbort = useCallback(async () => {
    // Mod doar-citire: nu se salveaza nimic (main refuza), deci nu blocam comutarea.
    if (readOnlyRef.current) return true
    if (releasingRef.current) return false
    const ok = await autosaver.flush()
    if (!ok) {
      showToast(
        'error',
        'Fișa curentă nu a putut fi salvată, așa că nu am schimbat fișa - ca să nu pierzi modificările. Verifică spațiul liber pe disc și folderul de date.'
      )
    }
    return ok
  }, [autosaver, showToast])

  // Deschide un draft FARA flush prealabil (apelantul a tratat deja fisa curenta).
  const openDraftNow = useCallback(
    async (id) => {
      const res = await window.serviceAuto.fisa.loadDraft(id)
      if (!res.ok) {
        showToast('error', res.error.message)
        return false
      }
      const loaded = normalizeFisa(res.data)
      autosaver.reset(loaded, { clean: true })
      setFisa(loaded)
      setErrors({})
      setPdfRetry(null)
      return true
    },
    [showToast, autosaver]
  )

  const handleOpenDraft = useCallback(
    async (id) => {
      if (!(await flushOrAbort())) return false
      return openDraftNow(id)
    },
    [flushOrAbort, openDraftNow]
  )

  // Referinta stabila (deps: doar id-ul fisei curente) - altfel DraftsSidebar
  // s-ar re-randa la fiecare litera tastata in formular, desi lista de
  // drafturi/lucrari recente nu s-a schimbat deloc.
  const handleDeleteDraft = useCallback(
    async (id) => {
      if (releasingRef.current) return
      const isCurrent = fisaRef.current?.id === id || autosaver.getId() === id
      // Draftul curent: comutam pe o fisa goala INAINTE de stergere (reset
      // anuleaza orice salvare programata) - altfel un autosave care porneste
      // intre timp ar recrea fisierul imediat dupa stergere. NU facem flush.
      if (isCurrent) {
        resetToNewFisa()
        setErrors({})
      }
      const res = await window.serviceAuto.fisa.deleteDraft(id)
      if (res.ok) {
        if (lsGet(LAST_DRAFT_KEY) === id) lsSet(LAST_DRAFT_KEY, null)
        refreshDrafts()
      } else {
        showToast('error', res.error.message)
        refreshDrafts()
      }
    },
    [autosaver, resetToNewFisa, refreshDrafts, showToast]
  )

  // Dupa finalizare, trecem la o alta fisa in lucru daca exista una (cazul
  // uzual la un flux cu mai multe masini in paralel); daca nu mai e nimic
  // in lucru, deschidem o fisa noua goala.
  async function goToNextDraftOrNew() {
    refreshRecentFise()
    refreshAutocomplete()
    const deduped = await refreshDrafts()
    // Fisa curenta tocmai a fost finalizata (autosaver.reset(null) deja facut):
    // nu mai e nimic de salvat, deci deschidem direct, fara flush. Daca nu se
    // poate deschide, cadem pe o fisa noua - fisa finalizata NU ramane in formular.
    if (deduped.length === 0 || !(await openDraftNow(deduped[0].id))) {
      resetToNewFisa()
      setErrors({})
      setPdfRetry(null)
    }
  }

  const handleNewFisa = useCallback(async () => {
    // Daca fisa curenta e deja o fisa noua, goala, nu mai cream inca una -
    // ar duplica "Fisa noua" in sidebar la fiecare click. Citim din ref (nu
    // din state) ca handleNewFisa sa ramana stabil intre randari.
    if (isFisaEmpty(fisaRef.current)) {
      showToast('success', 'Ești deja pe o fișă nouă, goală.')
      return
    }
    if (!(await flushOrAbort())) return
    // Sau, daca exista deja un draft gol NEFOLOSIT in lista (creat mai
    // devreme si abandonat), il redeschidem in loc sa cream un altul.
    const golExistent = draftsRef.current.find((d) => isFisaEmpty(d) && d.id !== autosaver.getId())
    if (golExistent) {
      await openDraftNow(golExistent.id)
      return
    }
    resetToNewFisa()
    setErrors({})
    setPdfRetry(null)
  }, [resetToNewFisa, showToast, openDraftNow, flushOrAbort, autosaver])

  // Scurtaturi: Ctrl+K muta focusul in cautare, Ctrl+N deschide o fisa noua.
  useEffect(() => {
    function onKey(e) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
      // Nu actionam scurtaturile in spatele unui dialog/modal deschis.
      if (modalOpenRef.current || releasingRef.current) return
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
      let res
      try {
        res = await window.serviceAuto.fisa.finalize({ ...current, id: current.id || autosaver.getId() })
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
  const handleEditRecent = useCallback(
    async (finalizedFisa) => {
      if (!(await flushOrAbort())) return
      const { _file, id: _id, status: _status, finalizedAt: _finalizedAt, ...rest } = finalizedFisa
      const next = normalizeFisa({
        ...rest,
        id: null,
        _replaceBaseName: _file ? _file.replace(/\.json$/, '') : null
      })
      autosaver.reset(next, { clean: readOnlyRef.current })
      setFisa(next)
      setErrors({})
      setPdfRetry(null)
    },
    [autosaver, flushOrAbort]
  )

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

  modalOpenRef.current = Boolean(confirmState || settingsOpen || firstRunOpen || reportsOpen || vehicleHistoryQuery || whatsNew)

  // Dupa o restaurare din backup/trash (din Setari) listele din bara laterala trebuie reimprospatate.
  const onDataChanged = useCallback(() => {
    refreshDrafts()
    refreshRecentFise()
    refreshAutocomplete()
  }, [refreshDrafts, refreshRecentFise, refreshAutocomplete])

  const handleOpenSettings = useCallback(() => setSettingsOpen(true), [])

  const updateBtn = getUpdateButtonState()
  const totals = calcTotaluri(fisa.piese, fisa.lucrari, fisa.reducerePiesePercent, fisa.reducereLucrariPercent)
  const plate = fisa.auto.nrInmatriculare?.trim()
  const vehicul = [fisa.auto.marca, fisa.auto.model].map((x) => x?.trim()).filter(Boolean).join(' ')
  const fisaGoala = isFisaEmpty(fisa)
  const savedTime = savedAt ? savedAt.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }) : ''
  const backupChip = getBackupChip(backupStatus)
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
        isCurrentEmpty={isCurrentEmpty}
      />

      <main className="main">
        {readOnly && (
          <div className="app-banner" role="alert">
            <span>
              Licență revocată — mod doar-citire. Poți deschide, căuta, tipări și exporta fișele existente.
            </span>
            <button type="button" onClick={onRequestActivation}>
              Introdu cheie nouă
            </button>
          </div>
        )}
        {locationBanner && (
          <div className="app-banner warn" role="alert">
            <span>
              Folderul de date «{locationBanner.override}» nu este disponibil (unitate scoasă/rețea căzută?). Lucrezi
              temporar în «{locationBanner.dir}». Reconectează folderul și repornește aplicația — datele de acum vor
              fi aduse înapoi automat.
            </span>
          </div>
        )}
        <UpdateBanner
          status={updateInfo.status}
          version={updateInfo.version}
          notes={updateInfo.notes}
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
                title="Caută (Ctrl+K)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') closeSearch()
                }}
              />
              <button
                type="button"
                className={`btn-sm search-filter-btn${filtersOpen || searchRange.from || searchRange.to ? ' active' : ''}`}
                title="Filtrează după dată"
                aria-label="Filtrează după dată"
                onClick={() => setFiltersOpen((v) => !v)}
              >
                <Icon name="calendar" size={14} />
              </button>
              {searchActive && (
                <SearchModal
                  query={searchQuery}
                  range={searchRange}
                  onRangeChange={setSearchRange}
                  onClose={closeSearch}
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
                { label: 'Ce e nou', icon: 'info', onClick: openWhatsNew },
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
          errors={errors}
        />

        <div className="release-bar">
          <div className="release-total">
            <span className="release-total-label">Total final</span>
            <span className="release-total-value">{formatLei(totals.totalFinal)}</span>
          </div>
          {saveState === 'error' ? (
            <span className="chip chip-error" role="alert" title={saveError || ''}>
              <Icon name="refresh" size={13} /> Nesalvat! Se reîncearcă…
            </span>
          ) : (
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
          )}
          {backupChip && (
            <span
              className={`chip chip-backup ${backupChip.warn ? 'chip-warn' : 'saved'}`}
              title={backupChip.title}
            >
              {backupChip.text}
            </span>
          )}
          <div className="release-bar-actions">
            {pdfRetry && (
              <button type="button" onClick={() => handleRetryPdf(pdfRetry.baseName)}>
                <Icon name="refresh" /> Reîncearcă generarea PDF
              </button>
            )}
            <button
              type="button"
              className="btn-primary btn-release"
              disabled={releasing || readOnly}
              title={readOnly ? 'Licență revocată — mod doar-citire' : undefined}
              onClick={handleRelease}
            >
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

      {(settingsOpen || firstRunOpen) && (
        <SettingsModal
          onClose={() => {
            if (firstRunOpen) lsSet(FIRST_RUN_KEY, '1')
            setFirstRunOpen(false)
            setSettingsOpen(false)
          }}
          showToast={showToast}
          confirm={confirmAction}
          onDataChanged={onDataChanged}
          firstRun={firstRunOpen}
          readOnly={readOnly}
        />
      )}

      {whatsNew && <WhatsNewModal entries={whatsNew.entries} onClose={closeWhatsNew} />}

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
