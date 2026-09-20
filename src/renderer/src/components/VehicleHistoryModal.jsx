import React, { useEffect, useRef, useState } from 'react'
import { calcTotaluri, reduceriDinFisa } from '../../../shared/calculations'
import Modal from './Modal'

function formatData(dataISO) {
  const datePart = String(dataISO || '').slice(0, 10)
  const [y, m, d] = datePart.split('-')
  return y && m && d ? `${d}.${m}.${y}` : dataISO || '-'
}

export default function VehicleHistoryModal({
  vin,
  nrInmatriculare,
  onClose,
  onOpenPdf,
  onPrintPdf,
  onDeleteFinalized,
}) {
  const [loading, setLoading] = useState(true)
  const [results, setResults] = useState([])
  const [error, setError] = useState('')
  const busyRef = useRef(new Set())
  const [, setBusyTick] = useState(0)
  const titlu = nrInmatriculare?.trim() || vin?.trim() || ''

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    Promise.resolve()
      .then(() => window.serviceAuto.fisa.getVehicleHistory(vin, nrInmatriculare))
      .catch((err) => ({ ok: false, error: { message: err?.message } }))
      .then((res) => {
        if (cancelled) return
        setLoading(false)
        if (res?.ok) {
          setResults(Array.isArray(res.data) ? res.data : [])
        } else {
          setResults([])
          setError(res?.error?.message || 'Nu s-a putut încărca istoricul.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [vin, nrInmatriculare])

  async function handleDelete(fileName) {
    if (busyRef.current.has(fileName)) return
    busyRef.current.add(fileName)
    setBusyTick((n) => n + 1)
    try {
      const deleted = await onDeleteFinalized(fileName)
      if (deleted) setResults((rs) => rs.filter((f) => f._file !== fileName))
    } catch {
      // lista ramane intacta
    } finally {
      busyRef.current.delete(fileName)
      setBusyTick((n) => n + 1)
    }
  }

  return (
    <Modal title={`Istoric ${titlu}`} onClose={onClose} className="search-modal">
      <div className="search-results">
        {loading && <p className="hint">Se încarcă...</p>}
        {!loading && error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {!loading && !error && results.length === 0 && (
          <p className="hint">Nicio fișă finalizată anterior pentru acest VIN sau număr de înmatriculare.</p>
        )}
        {!loading &&
          results.map((fisa) => {
            const reduceri = reduceriDinFisa(fisa)
            const t = calcTotaluri(fisa.piese, fisa.lucrari, reduceri.piese, reduceri.lucrari)
            const denumiri = [...(fisa.piese || []), ...(fisa.lucrari || [])]
              .map((it) => it.denumire)
              .filter(Boolean)
            return (
              <div className="search-result" key={fisa._file}>
                <div className="search-result-main">
                  <strong>{formatData(fisa.data)}</strong>
                  {fisa.nr && <span className="fisa-nr">#{fisa.nr}</span>}
                  <span>{fisa.client?.nume}</span>
                  <span>{denumiri.length > 0 ? denumiri.join(', ') : 'Fără piese/lucrări'}</span>
                </div>
                <div className="search-result-meta">
                  <span>{t.totalFinal.toFixed(2)} lei</span>
                </div>
                <div className="search-result-actions">
                  <button type="button" onClick={() => onOpenPdf(fisa._file)}>
                    Deschide PDF
                  </button>
                  <button type="button" onClick={() => onPrintPdf(fisa._file)}>
                    Printează
                  </button>
                  <button
                    type="button"
                    className="btn-remove"
                    title="Șterge (mută în coș)"
                    aria-label="Șterge fișa"
                    disabled={busyRef.current.has(fisa._file)}
                    onClick={() => handleDelete(fisa._file)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          })}
      </div>
    </Modal>
  )
}
