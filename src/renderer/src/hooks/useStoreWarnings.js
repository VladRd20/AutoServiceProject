import { useCallback, useEffect, useRef, useState } from 'react'

// Avertismente despre folderul de date (copii de sincronizare OneDrive, numere de
// fisa duplicate). Se citesc la pornire si la fiecare `refresh()` (ex: dupa o
// restaurare din backup/cos). Inchiderea bannerului tine doar pe durata sesiunii
// si e legata de continutul avertismentelor: daca apare altceva nou, bannerul revine.
export function warningsSignature(w) {
  if (!w) return ''
  return JSON.stringify([w.conflictCopies, (w.duplicateNr || []).map((d) => [d.nr, d.files])])
}

export function hasWarnings(w) {
  return Boolean(w && (w.conflictCopies?.length > 0 || w.duplicateNr?.length > 0))
}

export default function useStoreWarnings() {
  const [warnings, setWarnings] = useState(null)
  const [dismissedSig, setDismissedSig] = useState(null)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const res = await window.serviceAuto.store.getWarnings()
      if (mounted.current && res?.ok) setWarnings(res.data)
    } catch {
      // avertismentele sunt un confort - fara ele aplicatia merge normal
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    refresh()
    return () => {
      mounted.current = false
    }
  }, [refresh])

  const sig = warningsSignature(warnings)
  const dismiss = useCallback(() => setDismissedSig(sig), [sig])
  const visible = hasWarnings(warnings) && dismissedSig !== sig

  return { warnings: visible ? warnings : null, refresh, dismiss }
}
