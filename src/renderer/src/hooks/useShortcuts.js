import { useEffect, useRef } from 'react'

// Scurtaturi: Ctrl+K muta focusul in cautare, Ctrl+N deschide o fisa noua.
// `modalOpen` e oglindit intr-un ref (citit de handlerul de tastatura, ca sa
// ramana stabil intre randari); releasingRef vine gata de la useFisaEditor.
export default function useShortcuts({ modalOpen, releasingRef, searchInputRef, onNewFisa }) {
  const modalOpenRef = useRef(false)
  modalOpenRef.current = modalOpen

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
        onNewFisa()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onNewFisa, releasingRef, searchInputRef])
}
