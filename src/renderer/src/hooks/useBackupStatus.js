import { useCallback, useEffect, useState } from 'react'

const BACKUP_POLL_MS = 2 * 60 * 1000

// Starea backup-ului automat: la pornire, la 2 minute si dupa finalizare.
export default function useBackupStatus() {
  const [backupStatus, setBackupStatus] = useState(null)
  const refreshBackupStatus = useCallback(async () => {
    try {
      const res = await window.serviceAuto.backup.status()
      if (res?.ok) setBackupStatus(res.data)
    } catch {
      // nu e critic
    }
  }, [])
  useEffect(() => {
    refreshBackupStatus()
    const t = setInterval(refreshBackupStatus, BACKUP_POLL_MS)
    return () => clearInterval(t)
  }, [refreshBackupStatus])
  return { backupStatus, refreshBackupStatus }
}
