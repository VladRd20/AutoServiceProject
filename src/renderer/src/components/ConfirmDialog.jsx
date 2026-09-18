import React from 'react'
import Icon from './Icon'

// Randat o singura data la nivel de App (vezi confirmAction/confirmState),
// controlat prin `state`: null cand nu e nimic de confirmat, altfel
// { message, resolve, confirmLabel?, cancelLabel?, danger? }. Inlocuieste
// window.confirm() nativ (avea titlul procesului "service-auto" si stilul
// brut al SO, nimic din tema aplicatiei) pentru confirmarile de stergere.
export default function ConfirmDialog({ state, onResult }) {
  if (!state) return null

  const { message, confirmLabel = 'Confirmă', cancelLabel = 'Anulează', danger = true } = state

  function handleKeyDown(e) {
    if (e.key === 'Escape') onResult(false)
  }

  return (
    <div className="confirm-overlay" onClick={() => onResult(false)} onKeyDown={handleKeyDown}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-body">
          <span className={`confirm-icon ${danger ? 'danger' : ''}`}>
            <Icon name={danger ? 'alert' : 'info'} size={20} />
          </span>
          <p className="confirm-message">{message}</p>
        </div>
        <div className="confirm-actions">
          {/* Focus implicit pe Anuleaza, nu pe actiunea distructiva - un Enter
              reflex (obisnuinta din alte dialoguri) nu trebuie sa confirme
              din greseala o stergere. */}
          <button type="button" onClick={() => onResult(false)} autoFocus>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'btn-danger' : 'btn-primary'}
            onClick={() => onResult(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
