import React from 'react'
import { calcTotaluri } from '../../../shared/calculations'

export default function Totaluri({ piese, lucrari, reducerePercent, onChangeReducere }) {
  const t = calcTotaluri(piese, lucrari, reducerePercent)

  return (
    <section className="card totaluri">
      <div className="rand">
        <span>Total piese</span>
        <span>{t.totalPiese.toFixed(2)} lei</span>
      </div>
      <div className="rand">
        <span>Total lucrari</span>
        <span>{t.totalLucrari.toFixed(2)} lei</span>
      </div>
      <div className="rand rand-general">
        <span>Total general</span>
        <span>{t.totalGeneral.toFixed(2)} lei</span>
      </div>

      <div className="rand reducere-rand">
        <label htmlFor="reducere">Reducere (%)</label>
        <input
          id="reducere"
          type="number"
          min="0"
          max="100"
          step="1"
          value={reducerePercent}
          onChange={(e) => onChangeReducere(e.target.value)}
        />
      </div>
      {t.procentReducere > 0 && (
        <div className="rand reducere-valoare">
          <span>Valoare reducere</span>
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
