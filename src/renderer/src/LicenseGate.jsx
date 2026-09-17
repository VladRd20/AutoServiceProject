import React, { useEffect, useState } from 'react'
import ActivationScreen from './components/ActivationScreen'

// Verifica activarea in main process la pornire - blocheaza tot restul
// aplicatiei pana la o cheie valida. Verificarea reala (semnatura + legare
// de masina) se face in main process (src/main/license.js si ipc.js), nu
// aici - acest ecran e doar interfata, nu poarta de securitate in sine.
export default function LicenseGate({ children }) {
  const [status, setStatus] = useState('checking') // checking | locked | revoked | unlocked

  useEffect(() => {
    window.serviceAuto.license.getStatus().then((res) => {
      if (res.ok && res.data.activated) setStatus('unlocked')
      else if (res.ok && res.data.revoked) setStatus('revoked')
      else setStatus('locked')
    })
  }, [])

  // Verificarea de revocare in main process ruleaza async dupa pornire (are
  // nevoie de internet) - daca vine un rezultat "revocata" dupa ce ecranul
  // era deja deblocat, comutam imediat, nu asteptam urmatoarea actiune.
  useEffect(() => {
    return window.serviceAuto.license.onRevoked(() => setStatus('revoked'))
  }, [])

  if (status === 'checking') return null
  if (status === 'locked') return <ActivationScreen onActivated={() => setStatus('unlocked')} />
  if (status === 'revoked') {
    return <ActivationScreen revoked onActivated={() => setStatus('unlocked')} />
  }
  return children
}
