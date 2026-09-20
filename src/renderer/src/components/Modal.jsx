import React, { useEffect, useRef } from 'react'

// Shell comun pentru toate modalele (Settings/Reports/VehicleHistory/Search) -
// era duplicat identic in fiecare, inclusiv un bug comun: Escape nu facea
// nimic la deschidere pana la un clic in interior, pentru ca nimic nu primea
// focus in acel subtree (modalul se deschide dintr-un buton aflat in afara
// lui, iar focusul ramane acolo). Autofocus pe overlay la montare rezolva
// asta o singura data pentru toate cele patru modale.
//
// SearchModal e cazul special: nu se deschide dintr-un buton, ci se
// suprapune peste input-ul de cautare din topbar, care ramane activ si in
// care utilizatorul tasteaza in continuare. Daca am fura focusul si acolo,
// primul caracter tastat ar deschide modalul, i-ar rade focusul din input,
// si urmatoarele caractere n-ar mai ajunge nicaieri - de-aia SearchModal
// trece autoFocus={false} (Escape ramane oricum tratat separat, direct pe
// acel input, in App.jsx).
export default function Modal({ title, onClose, className = '', children, autoFocus = true }) {
  const overlayRef = useRef(null)
  const downOnOverlay = useRef(false)

  useEffect(() => {
    if (autoFocus) overlayRef.current?.focus()
  }, [autoFocus])

  function handleKeyDown(e) {
    if (e.key === 'Escape') onClose()
  }

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        downOnOverlay.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        // Un drag de selectie de text care se termina pe fundal nu inchide modalul.
        if (e.target === e.currentTarget && downOnOverlay.current) onClose()
        downOnOverlay.current = false
      }}
      onKeyDown={handleKeyDown}
      ref={overlayRef}
      tabIndex={-1}
    >
      <div className={`modal ${className}`.trim()} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="btn-remove" onClick={onClose} title="Închide">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
