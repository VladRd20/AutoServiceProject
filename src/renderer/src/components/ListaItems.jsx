import React from 'react'
import { calcLinieTotal, foldForMatch } from '../../../shared/calculations'

let nextId = 1
export function newItemId() {
  return `item-${Date.now()}-${nextId++}`
}

export default function ListaItems({
  titlu,
  items,
  onChange,
  priceKey,
  priceLabel,
  errorPrefix,
  errors,
  suggestions
}) {
  const datalistId = `denumire-list-${errorPrefix}`

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
    if (match && Number(item[priceKey]) === 0) {
      updateItem(item.id, { denumire: value, [priceKey]: match[priceKey] })
    } else {
      updateItem(item.id, { denumire: value })
    }
  }

  function addItem() {
    onChange([...items, { id: newItemId(), denumire: '', cantitate: 1, [priceKey]: 0 }])
  }

  function removeItem(id) {
    onChange(items.filter((it) => it.id !== id))
  }

  return (
    <section className="card">
      <div className="card-header">
        <h2>{titlu}</h2>
        <button type="button" onClick={addItem}>
          + Adauga
        </button>
      </div>

      <datalist id={datalistId}>
        {(suggestions || []).map((s) => (
          <option key={s.denumire} value={s.denumire} />
        ))}
      </datalist>

      {items.length === 0 && <p className="hint">Nicio linie adaugata inca.</p>}

      {items.map((item, i) => {
        const err = (field) => errors?.[`${errorPrefix}.${i}.${field}`]
        return (
          <div className="linie" key={item.id}>
            <div className="field field-grow">
              <input
                type="text"
                list={datalistId}
                placeholder="Denumire"
                value={item.denumire}
                onChange={(e) => handleDenumireChange(item, e.target.value)}
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
