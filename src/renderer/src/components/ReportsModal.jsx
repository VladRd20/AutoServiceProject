import React, { useEffect, useState } from 'react'
import Modal from './Modal'

const PERIOADE = [
  { key: 'azi', label: 'Azi' },
  { key: 'saptamana', label: 'Saptamana asta' },
  { key: 'luna', label: 'Luna asta' },
  { key: 'tot', label: 'Tot' }
]

export default function ReportsModal({ onClose, showToast }) {
  const [period, setPeriod] = useState('luna')
  const [loading, setLoading] = useState(true)
  const [raport, setRaport] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.serviceAuto.fisa.getRapoarte(period).then((res) => {
      if (cancelled) return
      setLoading(false)
      if (res.ok) setRaport(res.data)
      else showToast('error', res.error.message)
    })
    return () => {
      cancelled = true
    }
  }, [period, showToast])

  return (
    <Modal title="Rapoarte" onClose={onClose}>
      <div className="topbar-actions" style={{ marginBottom: 16 }}>
        {PERIOADE.map((p) => (
          <button
            key={p.key}
            type="button"
            className={p.key === period ? 'btn-primary' : ''}
            onClick={() => setPeriod(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading || !raport ? (
        <p className="hint">Se calculeaza...</p>
      ) : (
        <>
          <div className="totaluri" style={{ marginBottom: 16 }}>
            <div className="rand">
              <span>Fise finalizate</span>
              <span>{raport.numarFise}</span>
            </div>
            <div className="rand rand-final">
              <span>Total incasat</span>
              <span>{raport.totalIncasat.toFixed(2)} lei</span>
            </div>
          </div>

          <div className="search-results">
            <h3 style={{ margin: '4px 0' }}>Cele mai cerute piese</h3>
            {raport.topPiese.length === 0 && <p className="hint">Fara date pentru aceasta perioada.</p>}
            {raport.topPiese.map((p) => (
              <div className="search-result" key={p.denumire}>
                <div className="search-result-main">
                  <strong>{p.denumire}</strong>
                </div>
                <div className="search-result-meta">
                  <span>{p.count}x</span>
                  <span>{p.valoare.toFixed(2)} lei</span>
                </div>
              </div>
            ))}

            <h3 style={{ margin: '12px 0 4px' }}>Cele mai cerute lucrari</h3>
            {raport.topLucrari.length === 0 && <p className="hint">Fara date pentru aceasta perioada.</p>}
            {raport.topLucrari.map((l) => (
              <div className="search-result" key={l.denumire}>
                <div className="search-result-main">
                  <strong>{l.denumire}</strong>
                </div>
                <div className="search-result-meta">
                  <span>{l.count}x</span>
                  <span>{l.valoare.toFixed(2)} lei</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}
