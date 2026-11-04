import React, { useRef } from 'react'
import useDialog from '../hooks/useDialog'

// Shell comun pentru toate modalele (Settings/Reports/VehicleHistory/Search) -
// era duplicat identic in fiecare, inclusiv un bug comun: Escape nu facea
// nimic la deschidere pana la un clic in interior, pentru ca nimic nu primea
// focus in acel subtree (modalul se deschide dintr-un buton aflat in afara
// lui, iar focusul ramane acolo). Focusul pe dialog la montare rezolva
// asta o singura data pentru toate modalele; Escape e acum ascultat pe document
// (useDialog), deci nu mai depinde de unde se afla focusul.
//
// SearchModal e cazul special: nu se deschide dintr-un buton, ci se
// suprapune peste input-ul de cautare din topbar, care ramane activ si in
// care utilizatorul tasteaza in continuare. Daca am fura focusul si acolo,
// primul caracter tastat ar deschide modalul, i-ar rade focusul din input,
// si urmatoarele caractere n-ar mai ajunge nicaieri - de-aia SearchModal
// trece autoFocus={false}: useDialog nu muta focusul, nu il captureaza si nu
// il "restaureaza" (Escape ramane tratat si direct pe acel input, in Topbar).
export default function Modal({ title, onClose, className = '', children, autoFocus = true }) {
  const dialogRef = useRef(null)
  const downOnOverlay = useRef(false)
  const { titleId, dialogProps } = useDialog(dialogRef, { onClose, trap: autoFocus })

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
    >
      <div
        className={`modal ${className}`.trim()}
        ref={dialogRef}
        {...dialogProps}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn-remove" onClick={onClose} title="Închide" aria-label="Închide">
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
