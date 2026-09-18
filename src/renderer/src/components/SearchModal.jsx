import React, { useEffect, useRef, useState } from 'react'
import { calcTotaluri, reduceriDinFisa } from '../../../shared/calculations'

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
export default function SearchModal({ query, onClose, onOpenPdf, onPrintPdf, onDeleteFinalized, showToast }) {
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const timerRef = useRef(null)
  // Debounce-ul anuleaza un timeout inca neexecutat, dar nu poate anula un
  // apel IPC deja PORNIT de un timeout anterior. Daca acela raspunde mai
  // incet decat cautarea mai noua (IPC-ul citeste de pe disc, durata
  // variabila), rezultatul lui intarziat ar suprascrie pe ecran rezultate
  // deja mai proaspete. Id-ul de cerere garanteaza ca aplicam doar raspunsul
  // celei mai recente cautari pornite.
  const requestIdRef = useRef(0)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const myId = ++requestIdRef.current

    if (!query.trim()) {
      setResults(null)
      setSearching(false)
      return undefined
    }

    setSearching(true)
    timerRef.current = setTimeout(async () => {
      const res = await window.serviceAuto.fisa.search(query)
      if (requestIdRef.current !== myId) return // o cautare mai noua a pornit deja intre timp
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

  async function handleDelete(fileName) {
    const deleted = await onDeleteFinalized(fileName)
    if (deleted) setResults((rs) => rs?.filter((f) => f._file !== fileName) ?? rs)
  }

  return (
    <div className="search-panel" onClick={(e) => e.stopPropagation()}>
      <div className="search-panel-header">
        <h3>Rezultate căutare</h3>
        <button type="button" className="btn-remove" onClick={onClose} title="Închide">
          ✕
        </button>
      </div>
      <div className="search-results">
        {searching && <p className="hint">Se caută...</p>}
        {!searching && results && results.length === 0 && (
          <p className="hint">Niciun rezultat pentru "{query}".</p>
        )}
        {!searching &&
          results?.map((fisa) => {
            const reduceri = reduceriDinFisa(fisa)
            const t = calcTotaluri(fisa.piese, fisa.lucrari, reduceri.piese, reduceri.lucrari)
            return (
              <div className="search-result" key={fisa._file}>
                <div className="search-result-main">
                  <strong>{fisa.auto?.nrInmatriculare || 'Fără număr'}</strong>
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
                  <button type="button" className="btn-remove" title="Șterge definitiv" onClick={() => handleDelete(fisa._file)}>
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
