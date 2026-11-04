import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isFisaEmpty, calcTotaluri } from '../../../shared/calculations'
import { draftBackupRef, autosaverRef } from '../draftBackup'
import { createAutosaver } from '../autosave'
import { LAST_DRAFT_KEY, lsSet, emptyFisa, normalizeFisa } from '../fisaModel'

// Fisa din formular + salvarea ei automata. Salvarea propriu-zisa (serializare,
// flush, retry, garda de generatie) e in autosave.js; aici doar o legam de UI.
// Callback-urile stabile (autosaver, evenimente) citesc din refuri.
//
// `initialCheckDone` blocheaza autosave-ul "instant" de la pornire pana stim daca
// exista deja un draft gol de refolosit (vezi pornirea in App.jsx).
export default function useFisaEditor({ readOnly, showToast, initialCheckDone }) {
  const [fisa, setFisa] = useState(emptyFisa)
  const [errors, setErrors] = useState({})
  const [pdfRetry, setPdfRetry] = useState(null) // { baseName }
  const [saveState, setSaveState] = useState('idle') // idle | saving | saved | error
  const [savedAt, setSavedAt] = useState(null)
  const [saveError, setSaveError] = useState(null) // mesajul erorii curente de salvare

  const fisaRef = useRef(null)
  const readOnlyRef = useRef(readOnly)
  // Setat de useDrafts: patch local al listei dupa o salvare reusita.
  const patchDraftRef = useRef(null)
  const errorToastedRef = useRef(false)
  // true cat timp finalizam: nu trimitem update-uri catre autosaver, altfel
  // dupa reset(null) fisa finalizata ar fi re-salvata ca draft "fantoma".
  const suspendAutosaveRef = useRef(false)
  // true cat timp ruleaza o finalizare: comutarile de fisa/scurtaturile sunt ignorate.
  const releasingRef = useRef(false)
  fisaRef.current = fisa
  readOnlyRef.current = readOnly

  const isCurrentEmpty = useCallback(() => isFisaEmpty(fisaRef.current), [])

  const [autosaver] = useState(() =>
    createAutosaver({
      save: (f) => window.serviceAuto.fisa.saveDraft(f),
      onState: ({ state, error, savedAt, doc, id }) => {
        setSaveState(state)
        if (savedAt) setSavedAt(savedAt)
        if (state === 'error') {
          const msg = error?.message || 'Eroare necunoscută'
          setSaveError(msg)
          if (!errorToastedRef.current) {
            errorToastedRef.current = true
            showToast('error', `Salvare automată eșuată: ${msg}`, null, { sticky: true })
          }
        } else {
          setSaveError(null)
          errorToastedRef.current = false
          // Patch local din datele deja salvate (fara IPC + re-randare a listei
          // la fiecare ~1s de tastat). 'saved' fara `doc` = fisa deschisa de pe
          // disc: lista nu s-a schimbat, nu e nimic de facut.
          if (state === 'saved' && doc) patchDraftRef.current?.(doc, id)
        }
      },
      onId: (id) => setFisa((f) => (f.id ? f : { ...f, id }))
    })
  )

  // Totalurile se recalculeaza doar cand se schimba piesele/lucrarile/reducerile,
  // nu la fiecare re-randare (ex: schimbari de stare ale salvarii).
  const totals = useMemo(
    () => calcTotaluri(fisa.piese, fisa.lucrari, fisa.reducerePiesePercent, fisa.reducereLucrariPercent),
    [fisa.piese, fisa.lucrari, fisa.reducerePiesePercent, fisa.reducereLucrariPercent]
  )

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

  // Din Cautare/Istoric masina: porneste o fisa noua, goala, cu profilul
  // (client + auto) precompletat dintr-o fisa veche a aceluiasi client/masina -
  // spre deosebire de handleEditRecent, NU copiaza piesele/lucrarile vechi si
  // NU suprascrie fisa veche la finalizare (e o comanda noua, separata).
  const handleNewFisaForProfile = useCallback(
    async (sourceFisa) => {
      if (!(await flushOrAbort())) return
      const next = normalizeFisa({
        ...emptyFisa(),
        client: { ...(sourceFisa?.client || {}) },
        auto: { ...(sourceFisa?.auto || {}) }
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
  // functie primite au aceeasi referinta intre randari; inline arrows
  // ar recrea o functie noua la fiecare randare a App.jsx si ar anula memo().
  const handlePieseChange = useCallback((piese) => setFisa((f) => ({ ...f, piese })), [])
  const handleLucrariChange = useCallback((lucrari) => setFisa((f) => ({ ...f, lucrari })), [])
  const handleReducerePieseChange = useCallback((v) => setFisa((f) => ({ ...f, reducerePiesePercent: v })), [])
  const handleReducereLucrariChange = useCallback((v) => setFisa((f) => ({ ...f, reducereLucrariPercent: v })), [])

  return {
    fisa,
    setFisa,
    errors,
    setErrors,
    pdfRetry,
    setPdfRetry,
    saveState,
    savedAt,
    saveError,
    totals,
    autosaver,
    fisaRef,
    readOnlyRef,
    patchDraftRef,
    suspendAutosaveRef,
    releasingRef,
    isCurrentEmpty,
    resetToNewFisa,
    flushOrAbort,
    handleEditRecent,
    handleNewFisaForProfile,
    handlePieseChange,
    handleLucrariChange,
    handleReducerePieseChange,
    handleReducereLucrariChange
  }
}
