import React from 'react'

function formatData(dataISO) {
  const datePart = String(dataISO || '').slice(0, 10)
  const [y, m, d] = datePart.split('-')
  return y && m && d ? `${d}.${m}.${y}` : dataISO || '-'
}

export default function DraftsSidebar({
  drafts,
  currentId,
  onOpen,
  onDelete,
  onNew,
  recentFise,
  onEditRecent,
  onOpenPdf
}) {
  return (
    <aside className="sidebar">
      <button type="button" className="btn-primary" onClick={onNew}>
        + Fisa noua
      </button>
      <h3>Fise in lucru</h3>
      {drafts.length === 0 && <p className="hint">Niciuna momentan.</p>}
      <ul className="drafts-list">
        {drafts.map((d) => {
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
              <button type="button" className="btn-remove" title="Sterge" onClick={() => onDelete(d.id)}>
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
              <button type="button" title="Editeaza (creeaza o fisa noua pe baza acesteia)" onClick={() => onEditRecent(f)}>
                Editeaza
              </button>
              <button type="button" title="Deschide PDF" onClick={() => onOpenPdf(f._file)}>
                PDF
              </button>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  )
}
