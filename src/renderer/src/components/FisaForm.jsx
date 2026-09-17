import React from 'react'
import { foldForMatch } from '../../../shared/calculations'
import Autocomplete from './Autocomplete'

function Field({ label, error, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {error && <span className="field-error">{error}</span>}
    </div>
  )
}

export default function FisaForm({ fisa, onChange, errors, autocomplete, onShowVehicleHistory }) {
  const setClient = (patch) => onChange({ ...fisa, client: { ...fisa.client, ...patch } })
  const setAuto = (patch) => onChange({ ...fisa, auto: { ...fisa.auto, ...patch } })

  const marci = autocomplete?.marci || []
  const modeleCurente = autocomplete?.modelePerMarca?.[foldForMatch(fisa.auto.marca)] || []

  return (
    <>
      <section className="card">
        <h2>Client</h2>
        <div className="grid-2">
          <Field label="Nume client" error={errors['client.nume']}>
            <input
              type="text"
              placeholder="Ion Popescu"
              value={fisa.client.nume}
              onChange={(e) => setClient({ nume: e.target.value })}
            />
          </Field>
          <Field label="Numar de telefon" error={errors['client.telefon']}>
            <input
              type="text"
              placeholder="+373 69 123 456"
              value={fisa.client.telefon}
              onChange={(e) => setClient({ telefon: e.target.value })}
            />
          </Field>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Automobil</h2>
          {fisa.auto.nrInmatriculare?.trim() && (
            <button
              type="button"
              onClick={() => onShowVehicleHistory?.(fisa.auto.nrInmatriculare)}
              title="Vezi fisele anterioare pentru acest numar de inmatriculare"
            >
              Istoric masina
            </button>
          )}
        </div>
        <div className="grid-2">
          <Field label="Numar de inmatriculare" error={errors['auto.nrInmatriculare']}>
            <input
              type="text"
              placeholder="C AB 123"
              value={fisa.auto.nrInmatriculare}
              onChange={(e) => setAuto({ nrInmatriculare: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="An fabricatie" error={errors['auto.an']}>
            <input
              type="number"
              placeholder="2018"
              value={fisa.auto.an}
              onChange={(e) => setAuto({ an: e.target.value })}
            />
          </Field>
          <Field label="Marca" error={errors['auto.marca']}>
            <Autocomplete
              value={fisa.auto.marca}
              onChange={(v) => setAuto({ marca: v })}
              options={marci}
              placeholder="Dacia"
            />
          </Field>
          <Field label="Model" error={errors['auto.model']}>
            <Autocomplete
              value={fisa.auto.model}
              onChange={(v) => setAuto({ model: v })}
              options={modeleCurente}
              placeholder="Logan"
            />
          </Field>
          <Field label="VIN" error={errors['auto.vin']}>
            <input
              type="text"
              maxLength={17}
              placeholder="UU1XXXXXXXXXXXXXX"
              value={fisa.auto.vin}
              onChange={(e) => setAuto({ vin: e.target.value.toUpperCase() })}
            />
          </Field>
        </div>
      </section>

      <section className="card">
        <h2>Interventie</h2>
        <div className="checkbox-field">
          <label>
            <input
              type="checkbox"
              checked={fisa.dataCurenta}
              onChange={(e) => onChange({ ...fisa, dataCurenta: e.target.checked })}
            />
            Data curenta
          </label>
          {fisa.dataCurenta && (
            <span className="hint">La finalizare (Release) se va folosi data si ora curenta.</span>
          )}
        </div>
        {!fisa.dataCurenta && (
          <div className="grid-2">
            <Field label="Data" error={errors['data']}>
              <input
                type="date"
                value={fisa.data}
                onChange={(e) => onChange({ ...fisa, data: e.target.value })}
              />
            </Field>
          </div>
        )}
      </section>
    </>
  )
}
