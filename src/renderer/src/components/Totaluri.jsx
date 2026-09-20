import React, { memo } from 'react'
import { calcTotaluri } from '../../../shared/calculations'
import { formatLei } from '../format'

function Totaluri({
  piese,
  lucrari,
  reducerePiesePercent,
  reducereLucrariPercent,
  onChangeReducerePiese,
  onChangeReducereLucrari,
  errors = {}
}) {
  const t = calcTotaluri(piese, lucrari, reducerePiesePercent, reducereLucrariPercent)

  const randuri = [
    {
      key: 'piese',
      label: 'Piese',
      subtotal: t.totalPiese,
      reducere: t.valoareReducerePiese,
      percent: reducerePiesePercent,
      error: errors.reducerePiesePercent,
      onChange: onChangeReducerePiese
    },
    {
      key: 'lucrari',
      label: 'Lucrări',
      subtotal: t.totalLucrari,
      reducere: t.valoareReducereLucrari,
      percent: reducereLucrariPercent,
      error: errors.reducereLucrariPercent,
      onChange: onChangeReducereLucrari
    }
  ]

  return (
    <section className="card totaluri">
      <h2>Sumar</h2>
      <div className="totaluri-grid">
        <span className="th">Categorie</span>
        <span className="th">Subtotal</span>
        <span className="th">Reducere</span>
        <span className="th">Valoare reducere</span>
        <span className="th">Total</span>
        {randuri.map((r) => (
          <React.Fragment key={r.key}>
            <span className="td-label">{r.label}</span>
            <span className="td-num">{formatLei(r.subtotal)}</span>
            <span className="td-input">
              <input
                id={`reducere-${r.key}`}
                type="number"
                min="0"
                max="100"
                step="1"
                aria-label={`Reducere ${r.label.toLowerCase()} (%)`}
                value={r.percent ?? 0}
                aria-invalid={r.error ? 'true' : undefined}
                title={r.error || undefined}
                onChange={(e) => r.onChange(e.target.value)}
              />
              <span className="unit">%</span>
              {r.error && <span className="field-error">{r.error}</span>}
            </span>
            <span className={`td-num ${r.reducere > 0 ? 'reducere-valoare' : 'muted'}`}>
              {r.reducere > 0 ? `−${formatLei(r.reducere)}` : '—'}
            </span>
            <span className="td-num strong">{formatLei(r.subtotal - r.reducere)}</span>
          </React.Fragment>
        ))}
      </div>

      <div className="totaluri-final">
        {t.valoareReducere > 0 && (
          <>
            <div className="rand">
              <span>Total general</span>
              <span>{formatLei(t.totalGeneral)}</span>
            </div>
            <div className="rand reducere-valoare">
              <span>Reducere totală</span>
              <span>−{formatLei(t.valoareReducere)}</span>
            </div>
          </>
        )}
        <div className="rand rand-final">
          <span>Total final</span>
          <span>{formatLei(t.totalFinal)}</span>
        </div>
      </div>
    </section>
  )
}

export default memo(Totaluri)
