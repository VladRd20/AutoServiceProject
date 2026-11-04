import { useState } from 'react'
import { fise } from '../fisaModel'

// Informatiile despre refaceri/carantina/folderul de date se citesc DUPA prima
// incarcare a fiselor si drafturilor: refacerea unui fisier corupt are loc chiar
// la citire. `checkLocation(ready)` primeste promisiunea "datele sunt incarcate".
export default function useLocationInfo({ showToast }) {
  const [locationBanner, setLocationBanner] = useState(null) // { override, dir }

  function checkLocation(ready) {
    ready
      .catch(() => {})
      .then(() => window.serviceAuto.fise.getLocationInfo())
      .then((res) => {
        if (!res.ok) return
        const d = res.data
        if (d.overrideUnavailable) {
          setLocationBanner({ override: d.overrideUnavailable, dir: d.dir })
        } else if (d.usingFallback) {
          showToast(
            'error',
            `Folderul de date nu e scriptibil - fișele se salvează temporar în ${d.dir}`,
            null,
            { sticky: true }
          )
        }
        if (d.recoveredFromSafetyBackup) {
          showToast(
            'error',
            'Folderul principal de date a fost găsit gol la pornire - fișele au fost restaurate automat din backup-ul de siguranță.'
          )
        } else if (d.migratedFromLegacy) {
          showToast(
            'success',
            'Datele au fost mutate automat într-o locație mai sigură (nu mai dispar la actualizări).'
          )
        }
        if (d.healedFise > 0) {
          showToast('warning', `${fise(d.healedFise)} ${d.healedFise === 1 ? 'lipsea' : 'lipseau'} din folderul principal și ${d.healedFise === 1 ? 'a fost restaurată' : 'au fost restaurate'} din backup.`)
        }
        if (d.mergedBackFromTemp > 0) {
          showToast('success', `${d.mergedBackFromTemp} ${d.mergedBackFromTemp === 1 ? 'fișier creat' : 'fișiere create'} temporar ${d.mergedBackFromTemp === 1 ? 'a fost adus' : 'au fost aduse'} înapoi în folderul principal.`)
        }
        if (d.quarantinedLost > 0) {
          showToast(
            'error',
            `${fise(d.quarantinedLost)} ${d.quarantinedLost === 1 ? 'este coruptă' : 'sunt corupte'} și nu ${d.quarantinedLost === 1 ? 'a putut' : 'au putut'} fi refăcut${d.quarantinedLost === 1 ? 'ă' : 'e'} — ${d.quarantinedLost === 1 ? 'este păstrată' : 'sunt păstrate'} în folderul «corupte».`,
            null,
            { sticky: true }
          )
        }
        if (d.quarantinedRestored > 0) {
          showToast('info', `${fise(d.quarantinedRestored)} ${d.quarantinedRestored === 1 ? 'coruptă a fost refăcută' : 'corupte au fost refăcute'} automat din backup.`)
        }
      })
  }

  return { locationBanner, checkLocation }
}
