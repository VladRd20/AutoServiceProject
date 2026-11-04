import React, { memo } from 'react'
import { calcTotaluri, clampPercentText, parseDecimal, sanitizeDecimalText } from '../../../shared/calculations'
import DecimalInput from './DecimalInput'
import { formatLei } from '../format'

// Cat se tasteaza: peste 100 se taie direct la "100" (la blur se normalizeaza complet).
function parsePercentLive(text) {
  const n = parseDecimal(text)
  return n !== null && n > 100 ? '100' : text
}

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
              <DecimalInput
                id={`reducere-${r.key}`}
                aria-label={`Reducere ${r.label.toLowerCase()} (%)`}
                value={r.percent ?? 0}
                aria-invalid={r.error ? 'true' : undefined}
                aria-describedby={r.error ? `reducere-${r.key}-error` : undefined}
                title={r.error || undefined}
                sanitize={sanitizeDecimalText}
                normalize={clampPercentText}
                onChange={(v) => r.onChange(parsePercentLive(v))}
              />
              <span className="unit">%</span>
              {r.error && (
                <span className="field-error" id={`reducere-${r.key}-error`}>
                  {r.error}
                </span>
              )}
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
