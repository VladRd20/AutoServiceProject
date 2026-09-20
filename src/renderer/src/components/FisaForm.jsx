import React, { useId } from 'react'
import { foldForMatch } from '../../../shared/calculations'
import Autocomplete from './Autocomplete'
import PlateInput from './PlateInput'
import Icon from './Icon'
import './form-extra.css'

// Label-ul era un simplu text alaturi de input, fara asociere htmlFor/id -
// clic pe text nu focusa inputul, iar un cititor de ecran nu putea anunta
// eticheta corecta pentru camp. React.cloneElement injecteaza id-ul generat
// pe copilul unic (un <input> sau <Autocomplete>, ambele accepta prop `id`),
// ca fiecare camp din formular sa fie corect asociat, dintr-un singur loc.
// Contor de caractere: apare doar cand campul se apropie de limita (>= 85%), ca
// sa se vada DE CE se opreste tastarea, fara zgomot vizual altfel.
export function LengthCounter({ value, max }) {
  const len = String(value ?? '').length
  if (!max || max < 32 || len < Math.floor(max * 0.85)) return null
  return (
    <span className={`field-counter${len >= max ? ' warn' : ''}`} aria-live="polite">
      {len} / {max}
      {len >= max ? ' — limita atinsă' : ''}
    </span>
  )
}

function Field({ label, error, children, className = '' }) {
  const id = useId()
  return (
    <div className={`field ${className}`.trim()}>
      <label htmlFor={id}>{label}</label>
      {React.cloneElement(children, { id })}
      <LengthCounter value={children.props.value} max={children.props.maxLength} />
      {error && <span className="field-error">{error}</span>}
    </div>
  )
}

// memo: `onChange` primit din App.jsx e chiar setFisa (referinta stabila din
// useState), deci fara alte modificari nefolositoare de props, comparatia
// shallow a memo() are efect real - evita re-randarea acestui formular
// intreg cand se schimba doar piese/lucrari/reducere, nu campurile lui.
function FisaForm({ fisa, onChange, errors, autocomplete, onShowVehicleHistory }) {
  const setClient = (patch) => onChange({ ...fisa, client: { ...fisa.client, ...patch } })
  const setAuto = (patch) => onChange({ ...fisa, auto: { ...fisa.auto, ...patch } })

  const marci = autocomplete?.marci || []
  const modeleCurente = autocomplete?.modelePerMarca?.[foldForMatch(fisa.auto.marca)] || []

  return (
    <div className="form-columns">
      <div className="form-col">
      <section className="card">
        <h2>Client</h2>
        <div className="grid-2">
          <Field className="field-full" label="Nume client" error={errors['client.nume']}>
            <input
              type="text"
              placeholder="Ion Popescu"
              maxLength={200}
              value={fisa.client.nume}
              onChange={(e) => setClient({ nume: e.target.value })}
            />
          </Field>
          <Field label="Număr de telefon" error={errors['client.telefon']}>
            <input
              type="text"
              placeholder="+373 69 123 456"
              maxLength={40}
              value={fisa.client.telefon}
              onChange={(e) => setClient({ telefon: e.target.value })}
            />
          </Field>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Intervenție</h2>
          <label className="switch" title="La finalizare se folosește data și ora curentă">
            <input
              type="checkbox"
              checked={fisa.dataCurenta}
              onChange={(e) => onChange({ ...fisa, dataCurenta: e.target.checked })}
            />
            <span className="switch-track" aria-hidden="true" />
            Data curentă
          </label>
        </div>
        {fisa.dataCurenta && <p className="hint">La finalizare se va folosi data și ora curentă.</p>}
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
      </div>
      <div className="form-col">
      <section className="card">
        <div className="card-header">
          <h2>Automobil</h2>
          {(fisa.auto.vin?.trim() || fisa.auto.nrInmatriculare?.trim()) && (
            <button
              type="button"
              className="btn-sm"
              onClick={() => onShowVehicleHistory?.(fisa.auto.vin, fisa.auto.nrInmatriculare)}
              title="Vezi fișele anterioare pentru acest VIN sau număr de înmatriculare"
            >
              <Icon name="history" /> Istoric mașină
            </button>
          )}
        </div>
        <Field label="Număr de înmatriculare" error={errors['auto.nrInmatriculare']}>
          <PlateInput
            placeholder="ABC 123"
            maxLength={32}
            invalid={Boolean(errors['auto.nrInmatriculare'])}
            value={fisa.auto.nrInmatriculare}
            onChange={(e) => setAuto({ nrInmatriculare: e.target.value.toUpperCase() })}
          />
        </Field>
        <div className="grid-2">
          <Field label="An fabricație" error={errors['auto.an']}>
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              placeholder="2018"
              value={fisa.auto.an ?? ''}
              onChange={(e) => setAuto({ an: e.target.value.replace(/\D/g, '') })}
            />
          </Field>
          <Field label="Marcă" error={errors['auto.marca']}>
            <Autocomplete
              value={fisa.auto.marca}
              onChange={(v) => setAuto({ marca: v })}
              options={marci}
              placeholder="Dacia"
              maxLength={64}
            />
          </Field>
          <Field label="Model" error={errors['auto.model']}>
            <Autocomplete
              value={fisa.auto.model}
              onChange={(v) => setAuto({ model: v })}
              options={modeleCurente}
              placeholder="Logan"
              maxLength={64}
            />
          </Field>
          <Field label="Kilometraj (opțional)" error={errors['km']}>
            <input
              type="text"
              inputMode="numeric"
              placeholder="ex: 185000"
              maxLength={12}
              value={fisa.km ?? ''}
              onChange={(e) => onChange({ ...fisa, km: e.target.value })}
            />
          </Field>
          <Field className="field-full" label="VIN" error={errors['auto.vin']}>
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

      </div>
    </div>
  )
}

export default React.memo(FisaForm)
