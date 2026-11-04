import { useEffect, useState } from 'react'

// Main anunta (`app:closing`) ca a inceput salvarea de dinaintea inchiderii.
// Overlay-ul apare doar daca dureaza peste `delayMs` - o inchidere rapida
// (cazul obisnuit, ~0.4s) nu palpaie. `false` de la main = inchiderea a fost oprita.
export default function useClosing(delayMs = 300) {
  const [showOverlay, setShowOverlay] = useState(false)

  useEffect(() => {
    let timer = null
    const stop = () => {
      clearTimeout(timer)
      timer = null
    }
    const unsubscribe = window.serviceAuto.app.onClosing?.((closing) => {
      stop()
      if (closing) timer = setTimeout(() => setShowOverlay(true), delayMs)
      else setShowOverlay(false)
    })
    return () => {
      stop()
      unsubscribe?.()
    }
  }, [delayMs])

  return showOverlay
}
