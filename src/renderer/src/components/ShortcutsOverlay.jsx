import React, { useRef } from 'react'
import useDialog from '../hooks/useDialog'
import { SHORTCUTS, closeShortcutsHelp, useShortcutsHelpOpen } from '../hooks/useShortcuts'

// Lista scurtaturilor de tastatura. Se deschide cu "?" (cand nu se tasteaza intr-un
// camp) sau din meniul "Mai multe acțiuni"; starea e in useShortcuts, deci
// componenta se monteaza o singura data (in Topbar) si nu cere props.
export default function ShortcutsOverlay() {
  const open = useShortcutsHelpOpen()
  return open ? <ShortcutsDialog onClose={closeShortcutsHelp} /> : null
}

function ShortcutsDialog({ onClose }) {
  const dialogRef = useRef(null)
  const { titleId, dialogProps } = useDialog(dialogRef, { onClose })
  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal shortcuts-dialog" ref={dialogRef} {...dialogProps}>
        <div className="modal-header">
          <h2 id={titleId}>Scurtături de tastatură</h2>
          <button type="button" className="btn-remove" onClick={onClose} title="Închide" aria-label="Închide">
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <dl className="shortcuts-list">
          {SHORTCUTS.map((s) => (
            <div className="shortcuts-row" key={s.keys}>
              <dt>
                <kbd>{s.keys}</kbd>
              </dt>
              <dd>{s.label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
