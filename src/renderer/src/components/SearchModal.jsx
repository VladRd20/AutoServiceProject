import React, { useEffect, useRef, useState } from 'react'
import { calcTotaluri, reduceriDinFisa } from '../../../shared/calculations'
import './search-extra.css'
import { PRESETS, hasRange, presetRange } from '../../../shared/dateRange'

const SEARCH_DEBOUNCE_MS = 300

function formatData(dataISO) {
  const datePart = String(dataISO || '').slice(0, 10)
  const [y, m, d] = datePart.split('-')
  return y && m && d ? `${d}.${m}.${y}` : dataISO || '-'
}

// Panoul de rezultate pentru cautarea din bara de sus - textbox-ul propriu-zis
// traieste in App.jsx (topbar), nu aici; panoul asta doar afiseaza rezultatele
// pentru query-ul primit ca prop, si se deschide/inchide automat cand query-ul
// devine ne-gol/gol (vezi App.jsx). Randat ca dropdown ancorat sub input
// (parintele ".search-box" din App.jsx e position:relative), nu ca modal
// generic - Escape si click-in-afara sunt tratate tot in App.jsx, pe acelasi
// wrapper care contine si input-ul.
export default function SearchModal({ query, range = { from: '', to: '' }, onRangeChange, onClose, onOpenPdf, onPrintPdf, onDeleteFinalized }) {
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(new Set())
  const [, setBusyTick] = useState(0)
  const timerRef = useRef(null)
  // Debounce-ul anuleaza un timeout inca neexecutat, dar nu poate anula un
  // apel IPC deja PORNIT de un timeout anterior. Daca acela raspunde mai
  // incet decat cautarea mai noua (IPC-ul citeste de pe disc, durata
  // variabila), rezultatul lui intarziat ar suprascrie pe ecran rezultate
  // deja mai proaspete. Id-ul de cerere garanteaza ca aplicam doar raspunsul
  // celei mai recente cautari pornite.
  const requestIdRef = useRef(0)

  const { from: rangeFrom, to: rangeTo } = range
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const myId = ++requestIdRef.current

    if (!query.trim() && !hasRange({ from: rangeFrom, to: rangeTo })) {
      setResults(null)
      setSearching(false)
      return undefined
    }

    setSearching(true)
    setError('')
    timerRef.current = setTimeout(async () => {
      let res
      try {
        res = await window.serviceAuto.fisa.search(query, { from: rangeFrom, to: rangeTo })
      } catch (err) {
        res = { ok: false, error: { message: err?.message } }
      }
      if (requestIdRef.current !== myId) return // o cautare mai noua a pornit deja intre timp
      setSearching(false)
      if (res?.ok) {
        setResults(Array.isArray(res.data) ? res.data : [])
      } else {
        setResults([])
        setError(res?.error?.message || 'Căutarea a eșuat.')
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timerRef.current)
  }, [query, rangeFrom, rangeTo])

  async function handleDelete(fileName) {
    if (busyRef.current.has(fileName)) return
    busyRef.current.add(fileName)
    setBusyTick((n) => n + 1)
    try {
      const deleted = await onDeleteFinalized(fileName)
      if (deleted) setResults((rs) => rs?.filter((f) => f._file !== fileName) ?? rs)
    } catch {
      // lista ramane intacta
    } finally {
      busyRef.current.delete(fileName)
      setBusyTick((n) => n + 1)
    }
  }

  return (
    <div className="search-panel" onClick={(e) => e.stopPropagation()}>
      <div className="search-panel-header">
        <h3>Rezultate căutare</h3>
        <button type="button" className="btn-remove" onClick={onClose} title="Închide">
          ✕
        </button>
      </div>
      {onRangeChange && (
        <div className="search-filters">
          <div className="search-presets">
            {PRESETS.map((p) => {
              const r = presetRange(p.key)
              const active = r.from === range.from && r.to === range.to
              return (
                <button
                  key={p.key}
                  type="button"
                  className={`btn-sm${active ? ' active' : ''}`}
                  onClick={() => onRangeChange(active ? { from: '', to: '' } : r)}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
          <div className="search-dates">
            <label>
              De la
              <input
                type="date"
                value={range.from}
                max={range.to || undefined}
                onChange={(e) => onRangeChange({ ...range, from: e.target.value })}
              />
            </label>
            <label>
              Până la
              <input
                type="date"
                value={range.to}
                min={range.from || undefined}
                onChange={(e) => onRangeChange({ ...range, to: e.target.value })}
              />
            </label>
            {hasRange(range) && (
              <button type="button" className="btn-sm" onClick={() => onRangeChange({ from: '', to: '' })}>
                Șterge filtrul
              </button>
            )}
          </div>
        </div>
      )}
      <div className="search-results">
        {!searching && !error && results === null && (
          <p className="hint">Scrie ceva sau alege un interval de date.</p>
        )}
        {searching && <p className="hint">Se caută...</p>}
        {!searching && error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {!searching && !error && results && results.length === 0 && (
          <p className="hint">
            {query.trim() ? `Niciun rezultat pentru "${query}"` : 'Nicio fișă în acest interval'}
            {query.trim() && hasRange(range) ? ' în intervalul ales' : ''}.
          </p>
        )}
        {!searching &&
          results?.map((fisa) => {
            const reduceri = reduceriDinFisa(fisa)
            const t = calcTotaluri(fisa.piese, fisa.lucrari, reduceri.piese, reduceri.lucrari)
            return (
              <div className="search-result" key={fisa._file}>
                <div className="search-result-main">
                  <strong>{fisa.auto?.nrInmatriculare || 'Fără număr'}</strong>
                  {fisa.nr && <span className="fisa-nr">#{fisa.nr}</span>}
                  <span>
                    {fisa.auto?.marca} {fisa.auto?.model}
                  </span>
                  <span>{fisa.client?.nume}</span>
                  <span>{fisa.client?.telefon}</span>
                </div>
                <div className="search-result-meta">
                  <span>{formatData(fisa.data)}</span>
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
    </div>
  )
}
