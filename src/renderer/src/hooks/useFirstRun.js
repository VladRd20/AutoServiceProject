import { useCallback, useEffect, useRef, useState } from 'react'
import { FIRST_RUN_KEY, lsGet, lsSet } from '../fisaModel'

// Prima rulare (modalul "Datele service-ului") + "Ce e nou". ORDINEA conteaza:
//  1. Decizia "prima rulare" se ia INAINTE ca formularul sa fie afisat/interactiv
//     (firstRunChecked) - altfel modalul apare peste ce a inceput utilizatorul sa tasteze.
//  2. "Ce e nou" apare abia dupa ce: drafturile sunt incarcate (initialCheckDone),
//     decizia de prima rulare e luata si fereastra de prima configurare e inchisa.
//  3. Dupa o prima configurare (firstRunShownRef) NU aratam "Ce e nou": marcam doar
//     versiunea ca vazuta.
export default function useFirstRun({ initialCheckDone }) {
  const [firstRunOpen, setFirstRunOpen] = useState(false)
  const [firstRunChecked, setFirstRunChecked] = useState(false)
  const firstRunShownRef = useRef(false)
  const [whatsNew, setWhatsNew] = useState(null) // { entries, markSeen }
  const whatsNewCheckedRef = useRef(false)

  // Prima pornire: cerem numele service-ului daca nu e completat.
  // Intoarce promisiunea (mereu rezolvata) - folosita de poarta de vizibilitate din App.
  function checkFirstRun() {
    return window.serviceAuto.settings
      .get()
      .then((res) => {
        if (!res.ok) return
        if (!res.data?.numeService && lsGet(FIRST_RUN_KEY) !== '1') {
          firstRunShownRef.current = true
          setFirstRunOpen(true)
        }
      })
      .catch(() => {})
      .finally(() => setFirstRunChecked(true))
  }

  const markFirstRunChecked = useCallback(() => setFirstRunChecked(true), [])

  // "Ce e nou": o singura data dupa o actualizare, dupa ce aplicatia s-a incarcat
  // si nu e deschisa fereastra de prima configurare.
  useEffect(() => {
    if (!initialCheckDone || !firstRunChecked || firstRunOpen || whatsNewCheckedRef.current) return
    whatsNewCheckedRef.current = true
    // Instalare noua (tocmai a trecut prin prima configurare): nu are ce sa afle
    // "nou" - altfel, dupa inchiderea setarilor, ar aparea imediat inca un modal
    // (draftul gol e deja salvat, deci main nu o mai vede ca "fresh").
    if (firstRunShownRef.current) {
      window.serviceAuto.app.markWhatsNewSeen().catch(() => {})
      return
    }
    window.serviceAuto.app
      .getWhatsNew('unseen')
      .then((res) => {
        if (res?.ok && res.data.entries.length) setWhatsNew({ entries: res.data.entries, markSeen: true })
      })
      .catch(() => {})
  }, [initialCheckDone, firstRunChecked, firstRunOpen])

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

  // Inchiderea modalului de prima configurare o tine minte (nu mai apare la urmatoarea pornire).
  function closeFirstRun() {
    if (firstRunOpen) lsSet(FIRST_RUN_KEY, '1')
    setFirstRunOpen(false)
  }

  return { firstRunOpen, firstRunChecked, whatsNew, checkFirstRun, markFirstRunChecked, openWhatsNew, closeWhatsNew, closeFirstRun }
}
