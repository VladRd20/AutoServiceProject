import { useCallback, useEffect, useRef, useState } from 'react'

// Toast-urile aplicatiei. showToast/closeToast au referinta stabila (deps goale):
// o pot primi in siguranta hook-uri si componente memo.
export default function useToasts() {
  const [toasts, setToasts] = useState([])
  const toastIdRef = useRef(0)

  const showToast = useCallback((type, message, action, opts) => {
    const id = ++toastIdRef.current
    setToasts((ts) => [...ts, { id, type, message, action, sticky: opts?.sticky }])
    return id
  }, [])

  const closeToast = useCallback((id) => setToasts((ts) => ts.filter((t) => t.id !== id)), [])

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

  return { toasts, showToast, closeToast }
}
