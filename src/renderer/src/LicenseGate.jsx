import React, { useCallback, useEffect, useState } from 'react'
import ActivationScreen from './components/ActivationScreen'

// Verifica activarea in main process la pornire - blocheaza tot restul
// aplicatiei pana la o cheie valida. Verificarea reala (semnatura + legare
// de masina) se face in main process (src/main/license.js si ipc.js), nu
// aici - acest ecran e doar interfata, nu poarta de securitate in sine.
//
// Licenta revocata NU blocheaza aplicatia: fisele existente raman accesibile
// in mod doar-citire (App primeste readOnly), iar cheia noua se poate introde
// dintr-un overlay.
export default function LicenseGate({ children }) {
  const [status, setStatus] = useState('checking') // checking | locked | readonly | unlocked
  const [activationOpen, setActivationOpen] = useState(false)

  useEffect(() => {
    window.serviceAuto.license.getStatus().then((res) => {
      if (res.ok && (res.data.readOnly || (res.data.revoked && !res.data.activated))) setStatus('readonly')
      else if (res.ok && res.data.activated) setStatus('unlocked')
      else if (res.ok && res.data.revoked) setStatus('readonly')
      else setStatus('locked')
    }).catch(() => setStatus('locked'))
  }, [])

  // Verificarea de revocare in main process ruleaza async dupa pornire (are
  // nevoie de internet) - daca vine un rezultat "revocata" dupa ce ecranul
  // era deja deblocat, trecem in modul doar-citire, fara sa pierdem fisa curenta.
  useEffect(() => {
    return window.serviceAuto.license.onRevoked(() => setStatus('readonly'))
  }, [])

  const onRequestActivation = useCallback(() => setActivationOpen(true), [])

  if (status === 'checking') return null
  if (status === 'locked') return <ActivationScreen onActivated={() => setStatus('unlocked')} />

  // Aceeasi structura si pentru unlocked si pentru readonly, ca App sa ramana
  // montat (si sa nu-si piarda starea) la trecerea dintre ele.
  const readOnly = status === 'readonly'
  return (
    <>
      {React.cloneElement(children, { readOnly, onRequestActivation })}
      {readOnly && activationOpen && (
        <ActivationScreen
          revoked
          overlay
          onClose={() => setActivationOpen(false)}
          onActivated={() => {
            setActivationOpen(false)
            setStatus('unlocked')
          }}
        />
      )}
    </>
  )
}
