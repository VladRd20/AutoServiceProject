import React, { memo, useEffect, useMemo, useRef } from 'react'
import { calcLinieTotal, foldForMatch } from '../../../shared/calculations'
import Autocomplete from './Autocomplete'

// crypto.randomUUID() e disponibil in runtime-ul Chromium al Electron - mult
// mai sigur decat un contor de modul care se reseteaza la fiecare pornire a
// aplicatiei si depindea de Date.now() ca sa nu se suprapuna peste id-uri
// deja incarcate dintr-un draft salvat anterior.
export function newItemId() {
  return crypto.randomUUID()
}

// memo: onChange-ul primit din App.jsx e un useCallback stabil (vezi
// handlePieseChange/handleLucrariChange) - fara alte props instabile,
// comparatia shallow a memo() evita re-randarea listei de piese la fiecare
// litera tastata in campurile de client/auto, sau in lista de lucrari.
function ListaItems({ titlu, items, onChange, priceKey, priceLabel, errorPrefix, errors, suggestions, confirm }) {
  // Referinta stabila intre randari (cat timp `suggestions` nu s-a schimbat
  // efectiv) - altfel Autocomplete.jsx primeste un array nou la fiecare
  // randare si memo-ul lui pe `options` nu prinde niciodata cache.
  const denumiri = useMemo(() => (suggestions || []).map((s) => s.denumire), [suggestions])
  const inputRefs = useRef(new Map())
  const focusIdRef = useRef(null)

  // Ruleaza dupa ce randul nou adaugat exista deja in DOM, ca sa-i putem da
  // focus - o linie noua (din "+ Adauga" sau din Enter pe ultimul rand)
  // trece direct la treaba, fara o cursa suplimentara cu mouse-ul.
  useEffect(() => {
    if (!focusIdRef.current) return
    const el = inputRefs.current.get(focusIdRef.current)
    if (el) el.focus()
    focusIdRef.current = null
  }, [items])

  function updateItem(id, patch) {
    onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }

  // Cand denumirea introdusa se potriveste exact cu una folosita anterior si
  // pretul e inca la valoarea implicita (0, adica linie noua neatinsa),
  // completam automat ultimul pret folosit pentru acel denumire - util pentru
  // piese/lucrari recurente (schimb ulei, filtru etc), fara sa suprascriem
  // vreodata un pret pe care utilizatorul l-a introdus deja intentionat.
  function handleDenumireChange(item, value) {
    const match = suggestions?.find((s) => foldForMatch(s.denumire) === foldForMatch(value))
    if (match && match[priceKey] != null && Number(item[priceKey]) === 0) {
      updateItem(item.id, { denumire: value, [priceKey]: match[priceKey] })
    } else {
      updateItem(item.id, { denumire: value })
    }
  }

  function addItem() {
    const id = newItemId()
    focusIdRef.current = id
    onChange([...items, { id, denumire: '', cantitate: 1, [priceKey]: 0 }])
  }

  async function removeItem(id) {
    const item = items.find((it) => it.id === id)
    // O linie neatinsa (fara denumire introdusa) nu are ce pierde - cere
    // confirmare doar cand exista deja continut real, ca un clic gresit pe
    // "✕" sa nu poata rade instant o linie completata, fara nicio sansa de
    // a te razgandi.
    if (item?.denumire?.trim() && !(await confirm(`Stergi linia "${item.denumire}"?`, { confirmLabel: 'Sterge' }))) {
      return
    }
    onChange(items.filter((it) => it.id !== id))
  }

  function handleRowKeyDown(e, index) {
    if (e.key !== 'Enter') return
    if (index !== items.length - 1) return
    e.preventDefault()
    addItem()
  }

  return (
    <section className="card">
      <div className="card-header">
        <h2>{titlu}</h2>
        <button type="button" onClick={addItem}>
          + Adauga
        </button>
      </div>

      {items.length === 0 && <p className="hint">Nicio linie adaugata inca.</p>}

      {items.map((item, i) => {
        const err = (field) => errors?.[`${errorPrefix}.${i}.${field}`]
        return (
          <div className="linie" key={item.id} onKeyDown={(e) => handleRowKeyDown(e, i)}>
            <div className="field field-grow">
              <Autocomplete
                inputRef={(el) => {
                  if (el) inputRefs.current.set(item.id, el)
                  else inputRefs.current.delete(item.id)
                }}
                value={item.denumire}
                onChange={(v) => handleDenumireChange(item, v)}
                options={denumiri}
                placeholder="Denumire"
              />
              {err('denumire') && <span className="field-error">{err('denumire')}</span>}
            </div>
            <div className="field field-small">
              <input
                type="number"
                min="0"
                step="1"
                placeholder="Cant."
                value={item.cantitate}
                onChange={(e) => updateItem(item.id, { cantitate: e.target.value })}
              />
              {err('cantitate') && <span className="field-error">{err('cantitate')}</span>}
            </div>
            <div className="field field-small">
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder={priceLabel}
                value={item[priceKey]}
                onChange={(e) => updateItem(item.id, { [priceKey]: e.target.value })}
              />
              {err(priceKey) && <span className="field-error">{err(priceKey)}</span>}
            </div>
            <div className="linie-total">{calcLinieTotal(item.cantitate, item[priceKey]).toFixed(2)} lei</div>
            <button type="button" className="btn-remove" onClick={() => removeItem(item.id)} title="Sterge">
              ✕
            </button>
          </div>
        )
      })}
    </section>
  )
}

export default memo(ListaItems)
