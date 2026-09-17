import React from 'react'
import { calcTotaluri } from '../../../shared/calculations'

export default function Totaluri({
  piese,
  lucrari,
  reducerePiesePercent,
  reducereLucrariPercent,
  onChangeReducerePiese,
  onChangeReducereLucrari
}) {
  const t = calcTotaluri(piese, lucrari, reducerePiesePercent, reducereLucrariPercent)

  return (
    <section className="card totaluri">
      <div className="rand">
        <span>Total piese</span>
        <span>{t.totalPiese.toFixed(2)} lei</span>
      </div>
      <div className="rand reducere-rand">
        <label htmlFor="reducere-piese">Reducere piese (%)</label>
        <input
          id="reducere-piese"
          type="number"
          min="0"
          max="100"
          step="1"
          value={reducerePiesePercent}
          onChange={(e) => onChangeReducerePiese(e.target.value)}
        />
      </div>
      {t.procentReducerePiese > 0 && (
        <div className="rand reducere-valoare">
          <span>Valoare reducere piese</span>
          <span>-{t.valoareReducerePiese.toFixed(2)} lei</span>
        </div>
      )}

      <div className="rand">
        <span>Total lucrari</span>
        <span>{t.totalLucrari.toFixed(2)} lei</span>
      </div>
      <div className="rand reducere-rand">
        <label htmlFor="reducere-lucrari">Reducere lucrari (%)</label>
        <input
          id="reducere-lucrari"
          type="number"
          min="0"
          max="100"
          step="1"
          value={reducereLucrariPercent}
          onChange={(e) => onChangeReducereLucrari(e.target.value)}
        />
      </div>
      {t.procentReducereLucrari > 0 && (
        <div className="rand reducere-valoare">
          <span>Valoare reducere lucrari</span>
          <span>-{t.valoareReducereLucrari.toFixed(2)} lei</span>
        </div>
      )}

      <div className="rand rand-general">
        <span>Total general</span>
        <span>{t.totalGeneral.toFixed(2)} lei</span>
      </div>
      {t.valoareReducere > 0 && (
        <div className="rand reducere-valoare">
          <span>Valoare reducere totala</span>
          <span>-{t.valoareReducere.toFixed(2)} lei</span>
        </div>
      )}

      <div className="rand rand-final">
        <span>Total final</span>
        <span>{t.totalFinal.toFixed(2)} lei</span>
      </div>
    </section>
  )
}
