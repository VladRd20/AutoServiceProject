import React, { useCallback, useEffect, useRef, useState } from 'react'
import './settings-extra.css'

const pad = (n) => String(n).padStart(2, '0')

function formatDateTime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}, ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
}

const CONFIRM_MSG =
  'Restaurarea ADAUGĂ doar fișele care lipsesc și NU suprascrie niciodată fișele existente. ' +
  'Fișele cu același nume dar conținut diferit rămân neatinse (sunt raportate ca și conflicte). Continui?'

export default function BackupPanel({ showToast, confirm, readOnly, onDataChanged }) {
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(null) // 'now' | 'export' | 'file' | 'latest'
  const mounted = useRef(true)
  const busyRef = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const res = await window.serviceAuto.backup.status()
      if (!mounted.current) return
      if (res.ok) setStatus(res.data)
      else showToast('error', res.error.message)
    } catch (err) {
      if (mounted.current) showToast('error', String(err?.message || err))
    }
  }, [showToast])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Rulează o acțiune cu protecție la dublu-click și stare busy garantat resetată.
  async function run(kind, fn) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(kind)
    try {
      await fn()
    } catch (err) {
      if (mounted.current) showToast('error', String(err?.message || err))
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(null)
    }
  }

  function handleNow() {
    return run('now', async () => {
      const res = await window.serviceAuto.backup.now()
      if (!res.ok) return showToast('error', res.error.message)
      showToast('success', 'Backup-ul a fost creat.')
      await refresh()
    })
  }

  function handleExport() {
    return run('export', async () => {
      const res = await window.serviceAuto.backup.export()
      if (!res.ok) return showToast('error', res.error.message)
      if (!res.data) return // anulat
      const { path, fise, drafturi } = res.data
      showToast('success', `Backup exportat în ${path} (${fise} fișe, ${drafturi} drafturi).`)
    })
  }

  function handleRestore(source) {
    return run(source === 'latest' ? 'latest' : 'file', async () => {
      const ok = await confirm(CONFIRM_MSG, { confirmLabel: 'Restaurează' })
      if (!ok) return
      const res = await window.serviceAuto.backup.import(source)
      if (!res.ok) return showToast('error', res.error.message)
      if (!res.data) return // anulat
      const r = res.data
      let msg =
        `Restaurate: ${r.fiseRestaurate}, neschimbate: ${r.fiseIdentice}, ` +
        `conflicte: ${r.conflicte}, invalide: ${r.invalide}.`
      if (r.drafturiRestaurate) msg += ` Drafturi restaurate: ${r.drafturiRestaurate}.`
      if (r.setariRestaurate) msg += ' Setările au fost restaurate.'
      showToast(r.fiseRestaurate > 0 || r.drafturiRestaurate > 0 ? 'success' : 'info', msg)
      onDataChanged?.()
      await refresh()
    })
  }

  const disabled = busy !== null
  const noSnapshot = !status?.latestSnapshotPath

  return (
    <div>
      {!status ? (
        <p className="hint">Se încarcă...</p>
      ) : (
        <>
          <div className="hint">
            Ultimul backup automat: {status.lastBackupAt ? formatDateTime(status.lastBackupAt) : 'încă niciunul'}
          </div>
          <div className="hint">Snapshot-uri zilnice păstrate: {status.snapshots?.length ?? 0}</div>
          {status.lastError && (
            <div className="settings-warn" role="alert">
              Ultimul backup a eșuat: {status.lastError}
            </div>
          )}
        </>
      )}
      <div className="settings-actions">
        <button type="button" className="btn-sm" disabled={disabled || readOnly} onClick={handleNow}>
          {busy === 'now' ? 'Se creează...' : 'Fă backup acum'}
        </button>
        <button type="button" className="btn-sm" disabled={disabled} onClick={handleExport}>
          {busy === 'export' ? 'Se exportă...' : 'Exportă backup…'}
        </button>
        <button type="button" className="btn-sm" disabled={disabled || readOnly} onClick={() => handleRestore('dialog')}>
          {busy === 'file' ? 'Se restaurează...' : 'Restaurează din fișier…'}
        </button>
        <button
          type="button"
          className="btn-sm"
          disabled={disabled || readOnly || noSnapshot}
          onClick={() => handleRestore('latest')}
        >
          {busy === 'latest' ? 'Se restaurează...' : 'Restaurează din ultimul snapshot'}
        </button>
      </div>
    </div>
  )
}
