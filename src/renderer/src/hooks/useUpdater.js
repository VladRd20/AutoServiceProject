import { useEffect, useState } from 'react'

// Update-urile de versiune noua/gata de instalare sunt anuntate si printr-un
// dialog nativ (main process), dar tinem si o stare persistenta in UI
// (banner) - daca utilizatorul inchide dialogul fara sa raspunda, tot vede
// ca exista o actualizare disponibila, nu doar un toast care dispare.
export default function useUpdater({ showToast }) {
  const [updateInfo, setUpdateInfo] = useState({ status: 'idle' })
  const [updateFlash, setUpdateFlash] = useState(null) // 'no-update' | 'error' - dispare singur dupa cateva secunde
  const [checkingUpdates, setCheckingUpdates] = useState(false)

  useEffect(() => {
    const unsubscribe = window.serviceAuto.app.onUpdateEvent((evt) => {
      // Verificarile periodice (la ~10 min) sunt silentioase: "Se verifica..." apare doar
      // pentru verificarea ceruta de utilizator (buton din Setari).
      if (evt.type === 'checking') {
        if (evt.manual) setCheckingUpdates(true)
        return
      }
      setCheckingUpdates(false)

      if (evt.type === 'available') {
        setUpdateInfo({ status: 'available', version: evt.version, notes: evt.notes })
      } else if (evt.type === 'downloading') {
        setUpdateInfo((info) => ({ status: 'downloading', version: info.version, percent: 0 }))
      } else if (evt.type === 'progress') {
        setUpdateInfo((info) => ({ ...info, status: 'downloading', percent: evt.percent }))
      } else if (evt.type === 'downloaded') {
        setUpdateInfo({ status: 'downloaded', version: evt.version })
      }

      // O eroare in timpul DESCARCARII se arata mereu (utilizatorul a cerut descarcarea).
      if (evt.type === 'error' && !evt.manual) {
        setUpdateInfo((info) => (info.status === 'downloading' ? { ...info, status: 'available' } : info))
        showToast('error', 'Descărcarea actualizării a eșuat. O poți reîncerca din banner sau din Setări.')
        return
      }

      // Rezultatul verificarii cerute de utilizator (starea butonului din Setari).
      if (!evt.manual) return
      if (evt.type === 'not-available') {
        setUpdateFlash('no-update')
        setTimeout(() => setUpdateFlash(null), 4000)
      } else if (evt.type === 'error') {
        setUpdateFlash('error')
        setTimeout(() => setUpdateFlash(null), 4000)
      }
    })
    return unsubscribe
  }, [showToast])

  // Starea completa a butonului "Verifica actualizari" - utilizatorul trebuie
  // sa vada in orice moment ce se intampla efectiv (verifica, nu a gasit
  // nimic, descarca cu procent, gata de instalat), nu doar un text static.
  function getUpdateButtonState() {
    if (checkingUpdates) return { text: 'Se verifică...', variant: 'info' }
    if (updateInfo.status === 'downloading') {
      return { text: `Se descarcă... ${updateInfo.percent ?? 0}%`, variant: 'info' }
    }
    if (updateInfo.status === 'downloaded') return { text: 'Gata de instalat', variant: 'success' }
    if (updateInfo.status === 'available') return { text: `Versiune nouă: v${updateInfo.version}`, variant: 'accent' }
    if (updateFlash === 'no-update') return { text: 'Ești la zi', variant: 'success' }
    if (updateFlash === 'error') return { text: 'Verificare eșuată', variant: 'error' }
    return { text: 'Verifică actualizări', variant: null }
  }

  function handleCheckForUpdates() {
    setCheckingUpdates(true)
    window.serviceAuto.app.checkForUpdates()
  }

  function handleDownloadUpdate() {
    window.serviceAuto.app.downloadUpdate()
  }

  function handleInstallUpdate() {
    window.serviceAuto.app.installUpdate()
  }

  // Butonul din bara de sus apare DOAR cand exista ceva de facut (versiune noua / descarcare /
  // gata de instalat) si face exact actiunea potrivita; verificarea manuala e in Setari.
  const updateActionable = ['available', 'downloading', 'downloaded'].includes(updateInfo.status)

  return {
    updateInfo,
    checkingUpdates,
    updateBtn: getUpdateButtonState(),
    updateActionable,
    handleCheckForUpdates,
    handleDownloadUpdate,
    handleInstallUpdate,
    onUpdatePillClick: updateInfo.status === 'downloaded' ? handleInstallUpdate : handleDownloadUpdate
  }
}
