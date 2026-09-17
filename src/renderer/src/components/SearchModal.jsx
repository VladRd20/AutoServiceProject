import React, { useEffect, useRef, useState } from 'react'
import { calcTotaluri } from '../../../shared/calculations'

const SEARCH_DEBOUNCE_MS = 300

function formatData(dataISO) {
  const datePart = String(dataISO || '').slice(0, 10)
  const [y, m, d] = datePart.split('-')
  return y && m && d ? `${d}.${m}.${y}` : dataISO || '-'
}

export default function SearchModal({ onClose, onOpenPdf, onPrintPdf, showToast }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const timerRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)

    if (!query.trim()) {
      setResults(null)
      setSearching(false)
      return undefined
    }

    setSearching(true)
    timerRef.current = setTimeout(async () => {
      const res = await window.serviceAuto.fisa.search(query)
      setSearching(false)
      if (res.ok) {
        setResults(res.data)
      } else {
        setResults([])
        showToast('error', res.error.message)
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timerRef.current)
  }, [query, showToast])

  function handleKeyDown(e) {
    if (e.key === 'Escape') onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
      <div className="modal search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Cauta clienti</h2>
          <button type="button" className="btn-remove" onClick={onClose}>
            ✕
          </button>
        </div>

        <input
          ref={inputRef}
          type="text"
          className="search-input"
          placeholder="Nume, telefon, numar inmatriculare, marca, model, VIN..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="search-results">
          {searching && <p className="hint">Se cauta...</p>}
          {!searching && results && results.length === 0 && (
            <p className="hint">Niciun rezultat pentru "{query}".</p>
          )}
          {!searching &&
            results?.map((fisa) => {
              const t = calcTotaluri(fisa.piese, fisa.lucrari, fisa.reducerePercent)
              return (
                <div className="search-result" key={fisa._file}>
                  <div className="search-result-main">
                    <strong>{fisa.auto?.nrInmatriculare || 'Fara numar'}</strong>
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
