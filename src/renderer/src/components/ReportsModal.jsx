import React, { useEffect, useRef, useState } from 'react'
import './search-extra.css'
import Modal from './Modal'
import { formatLei, formatMoney } from '../format'

const PERIOADE = [
  { key: 'azi', label: 'Azi' },
  { key: 'saptamana', label: 'Săptămâna asta' },
  { key: 'luna', label: 'Luna asta' },
  { key: 'tot', label: 'Tot' },
  { key: 'interval', label: 'Interval' }
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
  const [range, setRange] = useState({ from: '', to: '' })
  const [loading, setLoading] = useState(true)
  const [raport, setRaport] = useState(null)
  const [exporting, setExporting] = useState(false)
  const mounted = useRef(true)
  const exportingRef = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const { from: rangeFrom, to: rangeTo } = range
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.serviceAuto.fisa
      .getRapoarte(period, period === 'interval' ? { from: rangeFrom, to: rangeTo } : undefined)
      .then((res) => {
        if (cancelled) return
        if (res.ok) setRaport(res.data)
        else showToast('error', res.error.message)
      })
      .catch((err) => {
        if (!cancelled) showToast('error', String(err?.message || err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [period, rangeFrom, rangeTo, showToast])

  async function handleExportCsv() {
    if (exportingRef.current) return
    exportingRef.current = true
    setExporting(true)
    try {
      const res = await window.serviceAuto.fisa.exportCsv(period, period === 'interval' ? range : undefined)
      if (!mounted.current) return
      if (!res.ok) showToast('error', res.error.message)
      else if (res.data) showToast('success', `CSV salvat în ${res.data.path} (${res.data.count} fișe).`)
    } catch (err) {
      if (mounted.current) showToast('error', String(err?.message || err))
    } finally {
      exportingRef.current = false
      if (mounted.current) setExporting(false)
    }
  }

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
      {period === 'interval' && (
        <div className="search-dates" style={{ margin: '8px 0 0' }}>
          <label>
            De la
            <input
              type="date"
              value={range.from}
              max={range.to || undefined}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
            />
          </label>
          <label>
            Până la
            <input
              type="date"
              value={range.to}
              min={range.from || undefined}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
            />
          </label>
          {!range.from && !range.to && <span className="hint">Alege capetele intervalului (se folosesc toate fișele până atunci).</span>}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '8px 0' }}>
        <button type="button" className="btn-sm" disabled={exporting} onClick={handleExportCsv}>
          {exporting ? 'Se exportă...' : 'Exportă CSV'}
        </button>
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
