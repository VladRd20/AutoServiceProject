import { useCallback, useEffect, useRef, useState } from 'react'

// Toast-urile aplicatiei. showToast/closeToast au referinta stabila (deps goale):
// o pot primi in siguranta hook-uri si componente memo.
export default function useToasts() {
  const [toasts, setToasts] = useState([])
  const toastIdRef = useRef(0)

  // showToast(type, message, action?, opts?) - semnatura neschimbata.
  // opts: { sticky?: bool (nu dispare singur), duration?: ms (suprascrie regulile
  // implicite din Toast.jsx: erorile raman pana sunt inchise, cele cu actiune 10s) }.
  const showToast = useCallback((type, message, action, opts) => {
    const id = ++toastIdRef.current
    setToasts((ts) => {
      // Aceeasi eroare repetata (ex: autosave care esueaza la fiecare retry) nu
      // se stivuieste: erorile raman pana la inchidere, deci ar umple ecranul.
      if (type === 'error' && ts.some((t) => t.type === 'error' && t.message === message)) return ts
      return [...ts, { id, type, message, action, sticky: opts?.sticky, duration: opts?.duration }]
    })
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
