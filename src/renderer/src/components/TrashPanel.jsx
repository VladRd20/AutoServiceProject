import React, { useCallback, useEffect, useRef, useState } from 'react'
import './settings-extra.css'

const MAX_ROWS = 50
const pad = (n) => String(n).padStart(2, '0')

function formatDate(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function TrashPanel({ showToast, readOnly, onDataChanged }) {
  const [items, setItems] = useState(null)
  const [restoring, setRestoring] = useState(null) // trashId
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
      const res = await window.serviceAuto.trash.list()
      if (!mounted.current) return
      if (res.ok) setItems(Array.isArray(res.data) ? res.data : [])
      else {
        setItems((prev) => prev ?? [])
        showToast('error', res.error.message)
      }
    } catch (err) {
      if (!mounted.current) return
      setItems((prev) => prev ?? [])
      showToast('error', String(err?.message || err))
    }
  }, [showToast])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function handleRestore(item) {
    if (busyRef.current) return
    busyRef.current = true
    setRestoring(item.trashId)
    try {
      const res = await window.serviceAuto.trash.restore(item.trashId)
      if (res.ok) {
        onDataChanged?.()
        showToast('success', `Fișa ${item.nr || res.data?.baseName || ''} a fost restaurată.`.replace('  ', ' '))
      } else {
        showToast('error', res.error.message)
      }
      await refresh() // și pe NOT_FOUND lista trebuie reîmprospătată
    } catch (err) {
      if (mounted.current) showToast('error', String(err?.message || err))
    } finally {
      busyRef.current = false
      if (mounted.current) setRestoring(null)
    }
  }

  const shown = items ? items.slice(0, MAX_ROWS) : []

  return (
    <div>
      <p className="hint" style={{ marginBottom: 6 }}>
        Fișele șterse se păstrează 30 de zile.
      </p>
      {items === null && <p className="hint">Se încarcă...</p>}
      {items && items.length === 0 && <p className="hint">Coșul este gol.</p>}
      {shown.map((it) => (
        <div className="trash-row" key={it.trashId}>
          <div className="trash-row-info">
            <strong>{it.nr || '—'}</strong> · {it.plate || '—'} · {it.client || '—'}
            <div className="trash-row-date">Șters: {formatDate(it.deletedAt)}</div>
          </div>
          <button
            type="button"
            className="btn-sm"
            disabled={readOnly || restoring !== null}
            onClick={() => handleRestore(it)}
          >
            {restoring === it.trashId ? 'Se restaurează...' : 'Restaurează'}
          </button>
        </div>
      ))}
      {items && items.length > MAX_ROWS && (
        <p className="hint" style={{ marginTop: 6 }}>
          Se afișează primele {MAX_ROWS} din {items.length} fișe șterse.
        </p>
      )}
    </div>
  )
}
