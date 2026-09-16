import React from 'react'

export default function DraftsSidebar({ drafts, currentId, onOpen, onDelete, onNew }) {
  return (
    <aside className="sidebar">
      <button type="button" className="btn-primary" onClick={onNew}>
        + Fisa noua
      </button>
      <h3>Fise in lucru</h3>
      {drafts.length === 0 && <p className="hint">Niciuna momentan.</p>}
      <ul className="drafts-list">
        {drafts.map((d) => (
          <li key={d.id} className={d.id === currentId ? 'active' : ''}>
            <button type="button" onClick={() => onOpen(d.id)}>
              <strong>{d.auto?.nrInmatriculare || 'Fara numar'}</strong>
              <span>{d.client?.nume || 'Fara nume client'}</span>
            </button>
            <button type="button" className="btn-remove" title="Sterge" onClick={() => onDelete(d.id)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
