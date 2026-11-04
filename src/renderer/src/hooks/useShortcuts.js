import { useEffect, useRef, useSyncExternalStore } from 'react'

// Lista unica a scurtaturilor - o citesc atat handlerul, cat si ShortcutsOverlay.
export const SHORTCUTS = [
  { keys: 'Ctrl+K', label: 'Caută fișe' },
  { keys: 'Ctrl+N', label: 'Fișă nouă' },
  { keys: 'Ctrl+S', label: 'Salvează acum' },
  { keys: 'Ctrl+Enter', label: 'Finalizează fișa' },
  { keys: 'Ctrl+P', label: 'Previzualizează PDF' },
  { keys: '?', label: 'Afișează scurtăturile' }
]

// Stare minimala (extern, pentru ShortcutsOverlay): overlay-ul de ajutor se
// poate deschide din tasta "?" sau din meniul "mai multe", iar scurtaturile
// trebuie sa fie dezactivate cat timp e deschis.
let helpOpen = false
const listeners = new Set()
function setHelpOpen(v) {
  if (helpOpen === v) return
  helpOpen = v
  listeners.forEach((l) => l())
}
export const openShortcutsHelp = () => setHelpOpen(true)
export const closeShortcutsHelp = () => setHelpOpen(false)
export function useShortcutsHelpOpen() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => helpOpen
  )
}

function isTyping(el) {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

// Scurtaturi: Ctrl+K cautare, Ctrl+N fisa noua, Ctrl+S salvare imediata,
// Ctrl+Enter finalizare, Ctrl+P previzualizare PDF, "?" ajutor.
// `modalOpen` e oglindit intr-un ref (citit de handlerul de tastatura, ca sa
// ramana stabil intre randari); releasingRef vine gata de la useFisaEditor.
// Parametrii noi (autosaver, showToast, onRelease, onPreview, readOnly) sunt
// optionali: scurtatura corespunzatoare e ignorata daca lipseste handlerul.
export default function useShortcuts({
  modalOpen,
  releasingRef,
  searchInputRef,
  onNewFisa,
  autosaver,
  showToast,
  onRelease,
  onPreview,
  readOnly = false
}) {
  const modalOpenRef = useRef(false)
  modalOpenRef.current = modalOpen
  const readOnlyRef = useRef(false)
  readOnlyRef.current = readOnly
  // Handlerele se citesc din ref: efectul de mai jos nu se re-leaga la fiecare
  // randare (onRelease/onPreview sunt functii noi la fiecare randare in useRelease).
  const handlersRef = useRef({})
  handlersRef.current = { autosaver, showToast, onRelease, onPreview, onNewFisa }
  const busyRef = useRef(false)
  // Ctrl+P: o previzualizare PDF in curs nu mai porneste una a doua.
  const previewBusyRef = useRef(false)

  useEffect(() => {
    async function save() {
      const { autosaver: a, showToast: toast } = handlersRef.current
      if (!a || busyRef.current) return
      busyRef.current = true
      try {
        const ok = await a.flush()
        if (ok !== false) toast?.('success', 'Salvat', null, { duration: 2000 })
      } finally {
        busyRef.current = false
      }
    }

    async function preview() {
      if (previewBusyRef.current) return
      previewBusyRef.current = true
      try {
        await handlersRef.current.onPreview?.()
      } finally {
        previewBusyRef.current = false
      }
    }

    function onKey(e) {
      // Compunere IME (tastatura pe cai multiple): tastele nu sunt scurtaturi.
      if (e.isComposing || e.keyCode === 229) return
      const isTypingNow = isTyping(e.target)
      // Dezactivate in spatele unui dialog/modal deschis sau cat timp se finalizeaza;
      // cele care modifica/produc date (S, Enter, P) si in modul doar-citire
      // (aceeasi garda ca la butonul Finalizeaza). Cautarea si fisa noua raman ca inainte.
      const blocked = modalOpenRef.current || releasingRef?.current || helpOpen
      const blockedWrite = blocked || readOnlyRef.current

      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === '?') {
        if (blocked || isTypingNow) return
        e.preventDefault()
        openShortcutsHelp()
        return
      }

      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const k = e.key.toLowerCase()
      // Ctrl+P: preventDefault chiar si cand e blocat, ca Chromium sa nu deschida print-ul nativ.
      if (k === 'p' && !e.shiftKey) {
        e.preventDefault()
        // Tasta tinuta apasata (repeat) nu declanseaza a doua previzualizare.
        if (blockedWrite || e.repeat) return
        preview()
        return
      }
      if (blocked || e.shiftKey) return
      if (k === 'k') {
        e.preventDefault()
        searchInputRef?.current?.focus()
        searchInputRef?.current?.select()
      } else if (k === 'n') {
        e.preventDefault()
        handlersRef.current.onNewFisa?.()
      } else if (k === 's') {
        e.preventDefault()
        if (!blockedWrite && !e.repeat) save()
      } else if (k === 'enter') {
        e.preventDefault()
        // Ctrl+Enter tinut apasat nu finalizeaza mai multe fise la rand; nici cat
        // timp e deschisa o lista Autocomplete (aria-expanded="true").
        const expanded =
          e.target?.getAttribute?.('aria-expanded') === 'true' ||
          document.activeElement?.getAttribute?.('aria-expanded') === 'true'
        if (!blockedWrite && !e.repeat && !expanded) handlersRef.current.onRelease?.()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [releasingRef, searchInputRef])
}
