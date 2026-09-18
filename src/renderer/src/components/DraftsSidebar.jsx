import React, { memo } from 'react'
import { isFisaEmpty } from '../../../shared/calculations'

function formatData(dataISO) {
  const datePart = String(dataISO || '').slice(0, 10)
  const [y, m, d] = datePart.split('-')
  return y && m && d ? `${d}.${m}.${y}` : dataISO || '-'
}

// Randat cu React.memo: fara asta, s-ar re-randa la fiecare litera tastata
// oriunde in formularul fisei curente, desi listele proprii (drafturi/lucrari
// recente) raman neschimbate in timpul editarii. Are efect real doar daca
// handler-ele primite ca props (onOpen, onDelete etc) au referinta stabila
// intre randari - vezi useCallback-urile din App.jsx.
function DraftsSidebar({
  drafts,
  currentId,
  onOpen,
  onDelete,
  onNew,
  recentFise,
  onEditRecent,
  onOpenPdf,
  onPrintPdf,
  onDeleteFinalized,
  onOpenSettings,
  confirm
}) {
  return (
    <aside className="sidebar">
      <button type="button" className="btn-primary" onClick={onNew}>
        + Fisa noua
      </button>

      <div className="sidebar-scroll">
        <h3>Fise in lucru</h3>
        {drafts.length === 0 && <p className="hint">Niciuna momentan.</p>}
        <ul className="drafts-list">
          {drafts.map((d) => {
            // Doar pentru eticheta afisata (plita/nume lipsa) - gate-ul de
            // confirmare la stergere foloseste isFisaEmpty (mai jos), nu
            // aceasta, ca sa nu stearga fara confirmare un draft cu date
            // reale in alte campuri (telefon, marca/model, VIN, piese/lucrari).
            const goala = !d.auto?.nrInmatriculare?.trim() && !d.client?.nume?.trim()
            return (
              <li key={d.id} className={d.id === currentId ? 'active' : ''}>
                <button type="button" onClick={() => onOpen(d.id)}>
                  {goala ? (
                    <strong>Fisa noua</strong>
                  ) : (
                    <>
                      <strong>{d.auto?.nrInmatriculare || 'Fara numar'}</strong>
                      <span>{d.client?.nume || 'Fara nume client'}</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="btn-remove"
                  title="Sterge"
                  onClick={async () => {
                    // O fisa noua, goala, nu are ce pierde - confirmarea ar fi
                    // doar friction. Una cu date reale introduse (client, auto,
                    // piese/lucrari) e stearsa definitiv, fara undo - un
                    // misclick pe "✕" nu trebuie sa poata rade continut real
                    // fara nicio sansa de a te razgandi.
                    if (
                      !isFisaEmpty(d) &&
                      !(await confirm('Stergi definitiv aceasta fisa in lucru? Continutul introdus se pierde.', {
                        confirmLabel: 'Sterge'
                      }))
                    ) {
                      return
                    }
                    onDelete(d.id)
                  }}
                >
                  ✕
                </button>
              </li>
            )
          })}
        </ul>

        <h3>Lucrari recente</h3>
        {recentFise.length === 0 && <p className="hint">Nicio fisa finalizata inca.</p>}
        <ul className="recent-list">
          {recentFise.map((f) => (
            <li key={f._file}>
              <div className="recent-info">
                <strong>{f.auto?.nrInmatriculare || 'Fara numar'}</strong>
                <span>
                  {f.client?.nume || 'Fara nume'} · {formatData(f.data)}
                </span>
              </div>
              <div className="recent-actions">
                <button
                  type="button"
                  title="Editeaza (la Finalizare, inlocuieste aceasta fisa - nu creeaza una noua)"
                  onClick={() => onEditRecent(f)}
                >
                  Editeaza
                </button>
                <button type="button" title="Deschide PDF" onClick={() => onOpenPdf(f._file)}>
                  PDF
                </button>
                <button type="button" title="Printeaza" onClick={() => onPrintPdf(f._file)}>
                  Printeaza
                </button>
                <button
                  type="button"
                  className="btn-remove"
                  title="Sterge definitiv"
                  onClick={() => onDeleteFinalized(f._file)}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <button type="button" className="sidebar-settings-btn" onClick={onOpenSettings}>
        ⚙ Setari
      </button>
    </aside>
  )
}

export default memo(DraftsSidebar)
