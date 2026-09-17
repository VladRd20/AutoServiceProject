import React, { useEffect, useState } from 'react'
import { calcTotaluri } from '../../../shared/calculations'

function formatData(dataISO) {
  const datePart = String(dataISO || '').slice(0, 10)
  const [y, m, d] = datePart.split('-')
  return y && m && d ? `${d}.${m}.${y}` : dataISO || '-'
}

export default function VehicleHistoryModal({ vin, nrInmatriculare, onClose, onOpenPdf, onPrintPdf, showToast }) {
  const [loading, setLoading] = useState(true)
  const [results, setResults] = useState([])
  const titlu = nrInmatriculare?.trim() || vin?.trim() || ''

  useEffect(() => {
    let cancelled = false
    window.serviceAuto.fisa.getVehicleHistory(vin, nrInmatriculare).then((res) => {
      if (cancelled) return
      setLoading(false)
      if (res.ok) {
        setResults(res.data)
      } else {
        showToast('error', res.error.message)
      }
    })
    return () => {
      cancelled = true
    }
  }, [vin, nrInmatriculare, showToast])

  function handleKeyDown(e) {
    if (e.key === 'Escape') onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
      <div className="modal search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Istoric {titlu}</h2>
          <button type="button" className="btn-remove" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="search-results">
          {loading && <p className="hint">Se incarca...</p>}
          {!loading && results.length === 0 && (
            <p className="hint">Nicio fisa finalizata anterior pentru acest VIN sau numar de inmatriculare.</p>
          )}
          {!loading &&
            results.map((fisa) => {
              const t = calcTotaluri(fisa.piese, fisa.lucrari, fisa.reducerePercent)
              const denumiri = [...(fisa.piese || []), ...(fisa.lucrari || [])]
                .map((it) => it.denumire)
                .filter(Boolean)
              return (
                <div className="search-result" key={fisa._file}>
                  <div className="search-result-main">
                    <strong>{formatData(fisa.data)}</strong>
                    <span>{fisa.client?.nume}</span>
                    <span>{denumiri.length > 0 ? denumiri.join(', ') : 'Fara piese/lucrari'}</span>
                  </div>
                  <div className="search-result-meta">
                    <span>{t.totalFinal.toFixed(2)} lei</span>
                  </div>
                  <div className="search-result-actions">
                    <button type="button" onClick={() => onOpenPdf(fisa._file)}>
                      Deschide PDF
                    </button>
                    <button type="button" onClick={() => onPrintPdf(fisa._file)}>
                      Printeaza
                    </button>
                  </div>
                </div>
              )
            })}
        </div>
      </div>
    </div>
  )
}
