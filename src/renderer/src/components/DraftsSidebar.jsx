import React, { memo, useEffect, useRef, useState } from 'react'
import { isFisaEmpty, calcTotaluri, reduceriDinFisa } from '../../../shared/calculations'
import { formatLei } from '../format'
import Icon from './Icon'

function formatData(dataISO) {
  const datePart = String(dataISO || '').slice(0, 10)
  const [y, m, d] = datePart.split('-')
  return y && m && d ? `${d}.${m}.${y}` : dataISO || '-'
}

function totalFisa(f) {
  try {
    const r = reduceriDinFisa(f)
    return calcTotaluri(f.piese, f.lucrari, r.piese, r.lucrari).totalFinal
  } catch {
    return 0
  }
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
  confirm,
  isCurrentEmpty
}) {
  const [version, setVersion] = useState('')
  // Garda per rand: un dublu-clic rapid pe stergere nu trebuie sa porneasca
  // doua stergeri (si doua dialoguri de confirmare) pentru aceeasi fisa.
  const busyRef = useRef(new Set())
  const [, setBusyTick] = useState(0)
  async function handleDeleteFinalized(file) {
    if (busyRef.current.has(file)) return
    busyRef.current.add(file)
    setBusyTick((n) => n + 1)
    try {
      await onDeleteFinalized(file)
    } catch {
      // lista ramane neschimbata; App afiseaza eroarea
    } finally {
      busyRef.current.delete(file)
      setBusyTick((n) => n + 1)
    }
  }
  useEffect(() => {
    Promise.resolve(window.serviceAuto.app.getVersion?.())
      .then((res) => res?.ok && setVersion(res.data))
      .catch(() => {})
  }, [])

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          <Icon name="wrench" size={18} />
        </span>
        <span className="brand-name">Service Auto</span>
      </div>

      <button type="button" className="btn-primary btn-new" onClick={onNew} title="Fișă nouă (Ctrl+N)">
        <Icon name="plus" /> Fișă nouă
        <kbd>Ctrl+N</kbd>
      </button>

      <div className="sidebar-scroll">
        <h3>
          În lucru <span className="count-badge">{drafts.length}</span>
        </h3>
        {drafts.length === 0 && <p className="hint">Niciuna momentan.</p>}
        <ul className="drafts-list">
          {drafts.map((d) => {
            // Doar pentru eticheta afisata (plita/nume lipsa) - gate-ul de
            // confirmare la stergere foloseste isFisaEmpty (mai jos), nu
            // aceasta, ca sa nu stearga fara confirmare un draft cu date
            // reale in alte campuri (telefon, marca/model, VIN, piese/lucrari).
            const goala = !d.auto?.nrInmatriculare?.trim() && !d.client?.nume?.trim()
            const total = totalFisa(d)
            return (
              <li key={d.id} className={d.id === currentId ? 'active' : ''}>
                <button type="button" onClick={() => onOpen(d.id)}>
                  {goala ? (
                    <strong>Fișă nouă</strong>
                  ) : (
                    <>
                      <span className="draft-row">
                        <strong className="plate-sm">{d.auto?.nrInmatriculare || 'Fără număr'}</strong>
                        {total > 0 && <em>{formatLei(total)}</em>}
                      </span>
                      <span>{d.client?.nume || 'Fără nume client'}</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="btn-remove"
                  title="Șterge"
                  aria-label="Șterge fișa în lucru"
                  onClick={async () => {
                    // O fisa noua, goala, nu are ce pierde - confirmarea ar fi
                    // doar friction. Una cu date reale introduse (client, auto,
                    // piese/lucrari) e stearsa definitiv, fara undo - un
                    // misclick nu trebuie sa poata rade continut real
                    // fara nicio sansa de a te razgandi.
                    if (
                      !(d.id === currentId && isCurrentEmpty ? isCurrentEmpty() : isFisaEmpty(d)) &&
                      !(await confirm('Ștergi definitiv această fișă în lucru? Conținutul introdus se pierde.', {
                        confirmLabel: 'Șterge'
                      }))
                    ) {
                      return
                    }
                    onDelete(d.id)
                  }}
                >
                  <Icon name="x" />
                </button>
              </li>
            )
          })}
        </ul>

        <h3>
          Recente <span className="count-badge">{recentFise.length}</span>
        </h3>
        {recentFise.length === 0 && <p className="hint">Nicio fișă finalizată încă.</p>}
        <ul className="recent-list">
          {recentFise.map((f) => (
            <li key={f._file}>
              <div className="recent-info">
                <span className="draft-row">
                  <strong className="plate-sm">{f.auto?.nrInmatriculare || 'Fără număr'}</strong>
                  <em>{formatLei(totalFisa(f))}</em>
                </span>
                <span>
                  {f.client?.nume || 'Fără nume'} · {formatData(f.data)}
                  {f.nr && <span className="fisa-nr">#{f.nr}</span>}
                </span>
              </div>
              <div className="recent-actions">
                <button
                  type="button"
                  title="Editează (la finalizare, înlocuiește această fișă - nu creează una nouă)"
                  aria-label="Editează"
                  onClick={() => onEditRecent(f)}
                >
                  <Icon name="edit" size={14} />
                </button>
                <button type="button" title="Deschide PDF" aria-label="Deschide PDF" onClick={() => onOpenPdf(f._file)}>
                  <Icon name="file" size={14} />
                </button>
                <button type="button" title="Printează" aria-label="Printează" onClick={() => onPrintPdf(f._file)}>
                  <Icon name="printer" size={14} />
                </button>
                <button
                  type="button"
                  className="danger-hover"
                  title="Șterge (mută în coș)"
                  aria-label="Șterge fișa finalizată"
                  disabled={busyRef.current.has(f._file)}
                  onClick={() => handleDeleteFinalized(f._file)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <button type="button" className="sidebar-settings-btn" onClick={onOpenSettings}>
        <Icon name="settings" /> Setări
        {version && <span className="version">v{version}</span>}
      </button>
    </aside>
  )
}

export default memo(DraftsSidebar)
