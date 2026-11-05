import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { FIRST_RUN_KEY, lsGet, lsSet } from '../fisaModel'

// Prima rulare (modalul "Datele service-ului") + "Ce e nou". ORDINEA conteaza:
//  1. Decizia "prima rulare" se ia INAINTE ca formularul sa fie afisat/interactiv
//     (firstRunChecked) - altfel modalul apare peste ce a inceput utilizatorul sa tasteze.
//  2. "Ce e nou" se decide tot in timpul pornirii ascunse si apare odata cu interfata
//     (dupa initialCheckDone + firstRunChecked), doar daca nu e deschisa prima configurare.
//  3. Dupa o prima configurare (firstRunShownRef) NU aratam "Ce e nou": marcam doar
//     versiunea ca vazuta.
export default function useFirstRun({ initialCheckDone }) {
  const [firstRunOpen, setFirstRunOpen] = useState(false)
  const [firstRunChecked, setFirstRunChecked] = useState(false)
  const firstRunShownRef = useRef(false)
  const [whatsNew, setWhatsNew] = useState(null) // { entries, markSeen }
  const whatsNewCheckedRef = useRef(false)

  // Intrarile "Ce e nou" nevazute, aduse in timpul pornirii (cat interfata e inca ascunsa).
  const pendingWhatsNewRef = useRef(null)

  // Prima pornire: cerem numele service-ului daca nu e completat. In paralel aducem si
  // "Ce e nou", ca decizia sa fie luata INAINTE ca formularul sa devina interactiv
  // (altfel modalul putea aparea tarziu, peste ce tasta/apasa deja utilizatorul).
  // Intoarce promisiunea (mereu rezolvata) - folosita de poarta de vizibilitate din App.
  function checkFirstRun() {
    const settingsP = window.serviceAuto.settings
      .get()
      .then((res) => {
        if (!res.ok) return
        if (!res.data?.numeService && lsGet(FIRST_RUN_KEY) !== '1') {
          firstRunShownRef.current = true
          setFirstRunOpen(true)
        }
      })
      .catch(() => {})
    const whatsNewP = window.serviceAuto.app
      .getWhatsNew('unseen')
      .then((res) => {
        if (res?.ok && res.data.entries.length) pendingWhatsNewRef.current = res.data.entries
      })
      .catch(() => {})
    return Promise.all([settingsP, whatsNewP]).finally(() => setFirstRunChecked(true))
  }

  const markFirstRunChecked = useCallback(() => setFirstRunChecked(true), [])

  // "Ce e nou": o singura data dupa o actualizare, in ACELASI cadru in care interfata
  // devine vizibila (layout effect = inainte de desenare), nu mai tarziu. Daca poarta
  // s-a deschis pe timeout si raspunsul vine dupa, nu il mai aratam acum (ramane
  // nevazut si apare la urmatoarea pornire) - niciodata peste o lucrare inceputa.
  useLayoutEffect(() => {
    if (!initialCheckDone || !firstRunChecked || firstRunOpen || whatsNewCheckedRef.current) return
    whatsNewCheckedRef.current = true
    // Instalare noua (tocmai a trecut prin prima configurare): nu are ce sa afle "nou".
    if (firstRunShownRef.current) {
      window.serviceAuto.app.markWhatsNewSeen().catch(() => {})
      return
    }
    const entries = pendingWhatsNewRef.current
    pendingWhatsNewRef.current = null
    if (entries) setWhatsNew({ entries, markSeen: true })
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
