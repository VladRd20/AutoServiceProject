import React, { useId, useRef } from 'react'
import Icon from './Icon'
import useDialog from '../hooks/useDialog'

// Randat o singura data la nivel de App (vezi confirmAction/confirmState),
// controlat prin `state`: null cand nu e nimic de confirmat, altfel
// { message, resolve, confirmLabel?, cancelLabel?, danger? }. Inlocuieste
// window.confirm() nativ (avea titlul procesului "service-auto" si stilul
// brut al SO, nimic din tema aplicatiei) pentru confirmarile de stergere.
export default function ConfirmDialog({ state, onResult }) {
  if (!state) return null
  return <ConfirmDialogBody state={state} onResult={onResult} />
}

function ConfirmDialogBody({ state, onResult }) {
  const { message, confirmLabel = 'Confirmă', cancelLabel = 'Anulează', danger = true } = state
  const dialogRef = useRef(null)
  const messageId = useId()
  // Focus implicit pe Anuleaza cand actiunea e distructiva - un Enter reflex
  // (obisnuinta din alte dialoguri) nu trebuie sa confirme din greseala o
  // stergere. La confirmarile nedistructive, focusul merge pe actiunea principala.
  const { dialogProps } = useDialog(dialogRef, {
    onClose: () => onResult(false),
    initialFocus: danger ? '[data-cancel]' : '[data-confirm]',
    role: 'alertdialog'
  })

  return (
    <div className="confirm-overlay" onClick={() => onResult(false)}>
      <div
        className="confirm-dialog"
        ref={dialogRef}
        {...dialogProps}
        aria-labelledby={messageId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-body">
          <span className={`confirm-icon ${danger ? 'danger' : ''}`}>
            <Icon name={danger ? 'alert' : 'info'} size={20} />
          </span>
          <p className="confirm-message" id={messageId}>
            {message}
          </p>
        </div>
        <div className="confirm-actions">
          <button type="button" onClick={() => onResult(false)} data-cancel>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'btn-danger' : 'btn-primary'}
            onClick={() => onResult(true)}
            data-confirm
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
