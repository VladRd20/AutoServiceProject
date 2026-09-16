import React from 'react'
import { calcLinieTotal } from '../../../shared/calculations'

let nextId = 1
export function newItemId() {
  return `item-${Date.now()}-${nextId++}`
}

export default function ListaItems({ titlu, items, onChange, priceKey, priceLabel, errorPrefix, errors }) {
  function updateItem(id, patch) {
    onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)))
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

      {items.length === 0 && <p className="hint">Nicio linie adaugata inca.</p>}

      {items.map((item, i) => {
        const err = (field) => errors?.[`${errorPrefix}.${i}.${field}`]
        return (
          <div className="linie" key={item.id}>
            <div className="field field-grow">
              <input
                type="text"
                placeholder="Denumire"
                value={item.denumire}
                onChange={(e) => updateItem(item.id, { denumire: e.target.value })}
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
