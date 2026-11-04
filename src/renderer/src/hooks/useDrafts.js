import { useCallback, useRef, useState } from 'react'
import { reduceriDinFisa, isFisaEmpty, calcTotaluri } from '../../../shared/calculations'
import { applyDraftPatch } from '../draftPatch'
import { LAST_DRAFT_KEY, lsGet, lsSet, normalizeFisa, pickStartupDraft } from '../fisaModel'

// Drafturile se reciteasca integral cel mult o data la atatea ms in timpul
// salvarilor automate (plasa de siguranta); intre timp se aplica un patch local.
const DRAFTS_SAFETY_REFRESH_MS = 10 * 1000

// Ce vede sidebar-ul pentru un draft (plita, client, total, daca e goala).
// Memoizat pe referinta obiectului, ca sa nu recalculam totalurile degeaba.
const draftViewCache = new WeakMap()
function draftView(d) {
  let v = draftViewCache.get(d)
  if (v === undefined) {
    let total = 0
    try {
      const r = reduceriDinFisa(d)
      total = calcTotaluri(d.piese, d.lucrari, r.piese, r.lucrari).totalFinal
    } catch {
      // ca in DraftsSidebar: total necalculabil = 0
    }
    v = `${d.id}${d.auto?.nrInmatriculare ?? ''}${d.client?.nume ?? ''}${total}${isFisaEmpty(d)}`
    draftViewCache.set(d, v)
  }
  return v
}
// true daca sidebar-ul ar arata exact la fel (aceeasi ordine, aceleasi campuri vizibile).
function sameDraftsView(a, b) {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && draftView(a[i]) !== draftView(b[i])) return false
  return true
}

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

// Lista de drafturi din sidebar: citire, dedupe, patch local dupa salvare,
// deschidere / stergere / trecere la urmatoarea fisa.
export default function useDrafts({
  autosaver,
  fisaRef,
  readOnlyRef,
  patchDraftRef,
  releasingRef,
  showToast,
  setFisa,
  setErrors,
  setPdfRetry,
  resetToNewFisa,
  flushOrAbort,
  refreshRecentFise,
  refreshAutocomplete
}) {
  const [drafts, setDrafts] = useState([])
  const draftsRef = useRef([])
  // Id-uri de drafturi finalizate/sterse: un callback 'saved' intarziat al
  // autosave-ului nu are voie sa le readuca in sidebar.
  const removedDraftIdsRef = useRef(new Set())
  const lastDraftsRefreshRef = useRef(0)

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
    lastDraftsRefreshRef.current = Date.now()
    // Daca sidebar-ul ar arata identic, nu mai setam state-ul (sidebar-ul e memo).
    // Ref-ul pastreaza mereu datele complete (handleNewFisa le citeste de acolo).
    const changed = !sameDraftsView(draftsRef.current, deduped)
    draftsRef.current = deduped
    if (changed) setDrafts(deduped)
    return deduped
  }, [showToast, autosaver, fisaRef, readOnlyRef])

  // Dupa o salvare reusita: actualizam local intrarea draftului din datele
  // salvate. Refresh complet doar pentru draft nou (nu e inca in lista - acopera
  // si dedupe-ul) sau ca plasa de siguranta, cel mult o data la 10s.
  patchDraftRef.current = (doc, id) => {
    const prev = draftsRef.current
    const { action, next } = applyDraftPatch(prev, doc, id, removedDraftIdsRef.current)
    if (action === 'ignore') return
    if (action === 'refresh') {
      refreshDrafts()
      return
    }
    draftsRef.current = next
    if (!sameDraftsView(prev, next)) setDrafts(next)
    if (Date.now() - lastDraftsRefreshRef.current >= DRAFTS_SAFETY_REFRESH_MS) refreshDrafts()
  }

  // La pornire: citim drafturile si refolosim un draft existent in loc sa cream
  // automat unul nou la fiecare pornire a aplicatiei - altfel se acumuleaza cate
  // o "Fisa noua" goala de fiecare data cand deschizi/repornesti aplicatia.
  // Returneaza promisiunea "drafturile sunt incarcate" (apelantul decide ce urmeaza).
  function loadInitialDrafts() {
    return refreshDrafts().then((deduped) => {
      // Cel mai recent modificat draft cu continut, altfel unul gol (vezi pickStartupDraft).
      const target = pickStartupDraft(deduped)
      if (target) {
        const loaded = normalizeFisa(target)
        autosaver.reset(loaded, { clean: true })
        setFisa(loaded)
      }
    })
  }

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
    [showToast, autosaver, setFisa, setErrors, setPdfRetry]
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
      removedDraftIdsRef.current.add(id)
      const res = await window.serviceAuto.fisa.deleteDraft(id)
      if (res.ok) {
        if (lsGet(LAST_DRAFT_KEY) === id) lsSet(LAST_DRAFT_KEY, null)
        refreshDrafts()
      } else {
        removedDraftIdsRef.current.delete(id) // stergerea a esuat: draftul exista in continuare
        showToast('error', res.error.message)
        refreshDrafts()
      }
    },
    [autosaver, resetToNewFisa, refreshDrafts, showToast, releasingRef, fisaRef, setErrors]
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
  }, [resetToNewFisa, showToast, openDraftNow, flushOrAbort, autosaver, fisaRef, setErrors, setPdfRetry])

  return {
    drafts,
    refreshDrafts,
    removedDraftIdsRef,
    loadInitialDrafts,
    handleOpenDraft,
    handleDeleteDraft,
    handleNewFisa,
    goToNextDraftOrNew
  }
}
