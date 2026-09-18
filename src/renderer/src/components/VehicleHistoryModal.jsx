import React, { useEffect, useState } from 'react'
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
  showToast
}) {
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

  async function handleDelete(fileName) {
    const deleted = await onDeleteFinalized(fileName)
    if (deleted) setResults((rs) => rs.filter((f) => f._file !== fileName))
  }

  return (
    <Modal title={`Istoric ${titlu}`} onClose={onClose} className="search-modal">
      <div className="search-results">
        {loading && <p className="hint">Se incarca...</p>}
        {!loading && results.length === 0 && (
          <p className="hint">Nicio fisa finalizata anterior pentru acest VIN sau numar de inmatriculare.</p>
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
                  <button type="button" className="btn-remove" title="Sterge definitiv" onClick={() => handleDelete(fisa._file)}>
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
