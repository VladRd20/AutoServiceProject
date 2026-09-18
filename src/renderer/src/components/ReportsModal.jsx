import React, { useEffect, useState } from 'react'
import Modal from './Modal'
import { formatLei, formatMoney } from '../format'

const PERIOADE = [
  { key: 'azi', label: 'Azi' },
  { key: 'saptamana', label: 'Săptămâna asta' },
  { key: 'luna', label: 'Luna asta' },
  { key: 'tot', label: 'Tot' }
]

const LUNI = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function Kpi({ label, value, sub }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  )
}

// Bare orizontale proportionale cu cel mai mare element din lista.
function TopList({ titlu, items }) {
  const max = Math.max(1, ...items.map((i) => i.count))
  return (
    <div className="report-block">
      <h3>{titlu}</h3>
      {items.length === 0 && <p className="hint">Fără date pentru această perioadă.</p>}
      {items.map((p) => (
        <div className="bar-row" key={p.denumire}>
          <div className="bar-head">
            <strong>{p.denumire}</strong>
            <span>
              {p.count}× · {formatLei(p.valoare)}
            </span>
          </div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(p.count / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function MonthlyChart({ lunar }) {
  const max = Math.max(1, ...lunar.map((m) => m.total))
  return (
    <div className="report-block">
      <h3>Venit lunar (ultimele 6 luni)</h3>
      <div className="month-chart" role="img" aria-label="Venit lunar">
        {lunar.map((m) => (
          <div className="month-col" key={`${m.year}-${m.month}`} title={`${formatLei(m.total)} · ${m.count} fișe`}>
            <span className="month-val">{m.total > 0 ? formatMoney(m.total) : ''}</span>
            <div className="month-bar-wrap">
              <div className="month-bar" style={{ height: `${Math.max(m.total > 0 ? 4 : 0, (m.total / max) * 100)}%` }} />
            </div>
            <span className="month-label">{LUNI[m.month]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Se calculează...">
      <div className="kpi-row">
        {[0, 1, 2].map((i) => (
          <div className="kpi skeleton" key={i} style={{ height: 76 }} />
        ))}
      </div>
      <div className="skeleton" style={{ height: 140, marginBottom: 14 }} />
      <div className="skeleton" style={{ height: 14, width: '60%', marginBottom: 10 }} />
      <div className="skeleton" style={{ height: 14, width: '80%', marginBottom: 10 }} />
      <div className="skeleton" style={{ height: 14, width: '45%' }} />
    </div>
  )
}

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

  const medie = raport && raport.numarFise > 0 ? raport.totalIncasat / raport.numarFise : 0
  const sumaPL = raport ? (raport.totalPiese || 0) + (raport.totalLucrari || 0) : 0
  const procPiese = sumaPL > 0 ? Math.round((raport.totalPiese / sumaPL) * 100) : 0

  return (
    <Modal title="Rapoarte" onClose={onClose}>
      <div className="segmented" role="tablist" aria-label="Perioadă">
        {PERIOADE.map((p) => (
          <button
            key={p.key}
            type="button"
            role="tab"
            aria-selected={p.key === period}
            className={p.key === period ? 'active' : ''}
            onClick={() => setPeriod(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading || !raport ? (
        <Skeleton />
      ) : (
        <div className="search-results">
          <div className="kpi-row">
            <Kpi label="Fișe finalizate" value={raport.numarFise} />
            <Kpi label="Total încasat" value={formatLei(raport.totalIncasat)} />
            <Kpi label="Medie / fișă" value={formatLei(medie)} />
          </div>

          {sumaPL > 0 && (
            <div className="report-block">
              <h3>Piese vs. manoperă</h3>
              <div className="split-bar" role="img" aria-label={`Piese ${procPiese}%, lucrări ${100 - procPiese}%`}>
                <div className="split-a" style={{ width: `${procPiese}%` }} />
              </div>
              <div className="split-legend">
                <span>
                  <i className="dot dot-a" /> Piese {procPiese}% · {formatLei(raport.totalPiese)}
                </span>
                <span>
                  <i className="dot dot-b" /> Lucrări {100 - procPiese}% · {formatLei(raport.totalLucrari)}
                </span>
              </div>
            </div>
          )}

          {raport.lunar && <MonthlyChart lunar={raport.lunar} />}

          <TopList titlu="Cele mai cerute piese" items={raport.topPiese} />
          <TopList titlu="Cele mai cerute lucrări" items={raport.topLucrari} />
        </div>
      )}
    </Modal>
  )
}
