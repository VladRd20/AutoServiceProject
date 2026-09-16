import React, { useEffect, useState } from 'react'
import ActivationScreen from './components/ActivationScreen'

// Verifica activarea in main process la pornire - blocheaza tot restul
// aplicatiei pana la o cheie valida. Verificarea reala (semnatura + legare
// de masina) se face in main process (src/main/license.js si ipc.js), nu
// aici - acest ecran e doar interfata, nu poarta de securitate in sine.
export default function LicenseGate({ children }) {
  const [status, setStatus] = useState('checking') // checking | locked | unlocked

  useEffect(() => {
    window.serviceAuto.license.getStatus().then((res) => {
      setStatus(res.ok && res.data.activated ? 'unlocked' : 'locked')
    })
  }, [])

  if (status === 'checking') return null
  if (status === 'locked') return <ActivationScreen onActivated={() => setStatus('unlocked')} />
  return children
}
