import React from 'react'
import './plate.css'

// Drapelul Republicii Moldova, mic, ca icon in interiorul campului (SVG inline).
function MoldovaFlag() {
  return (
    <svg className="md-plate-flag" viewBox="0 0 30 20" aria-hidden="true" focusable="false">
      <rect width="10" height="20" x="0" fill="#0046ae" />
      <rect width="10" height="20" x="10" fill="#ffd200" />
      <rect width="10" height="20" x="20" fill="#cc092f" />
      <path d="M13.6 7.6h2.8v2.7c0 .9-.6 1.5-1.4 1.9-.8-.4-1.4-1-1.4-1.9V7.6Z" fill="#8a5a1c" />
    </svg>
  )
}

// Numar de inmatriculare: camp obisnuit (aceeasi tema ca restul formularului),
// cu drapelul MD ca icon mic in stanga. Formatul cerut: "ABC 123" sau "A BC 123".
// Se integreaza cu <Field> din FisaForm (primeste id/value/maxLength ca un <input>).
export default function PlateInput({ id, value, onChange, placeholder, maxLength, invalid }) {
  return (
    <div className="md-plate">
      <MoldovaFlag />
      <input
        id={id}
        className="md-plate-input"
        type="text"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder={placeholder}
        maxLength={maxLength}
        value={value ?? ''}
        onChange={onChange}
        aria-invalid={invalid ? 'true' : undefined}
      />
    </div>
  )
}
