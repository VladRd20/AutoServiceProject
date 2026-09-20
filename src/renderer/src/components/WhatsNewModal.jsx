import React from 'react'
import Modal from './Modal'
import './whatsnew.css'

const TIP = {
  nou: { label: 'Nou', cls: 'wn-nou' },
  imbunatatit: { label: 'Îmbunătățit', cls: 'wn-imb' },
  rezolvat: { label: 'Rezolvat', cls: 'wn-rez' }
}

function formatDate(iso) {
  const [y, m, d] = String(iso || '').split('-')
  return y && m && d ? `${d}.${m}.${y}` : ''
}

// Fereastra "Ce e nou": afisata o singura data dupa o actualizare (App.jsx) si
// oricand din meniu. `entries` = intrarile de afisat, cele mai noi primele.
export default function WhatsNewModal({ entries, onClose }) {
  if (!entries?.length) return null
  return (
    <Modal title="Ce e nou în Service Auto" onClose={onClose}>
      <div className="wn-body">
        {entries.map((entry) => (
          <section className="wn-entry" key={entry.version}>
            <header className="wn-head">
              <h3>
                Versiunea {entry.version}
                {entry.titlu ? ` — ${entry.titlu}` : ''}
              </h3>
              {entry.date && <span className="hint">{formatDate(entry.date)}</span>}
            </header>
            <ul className="wn-list">
              {entry.items.map((item, i) => {
                const t = TIP[item.tip] || TIP.nou
                return (
                  <li key={i}>
                    <span className={`wn-tag ${t.cls}`}>{t.label}</span>
                    <span>{item.text}</span>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
        <div className="wn-actions">
          <button type="button" className="btn-primary" onClick={onClose} autoFocus>
            Am înțeles
          </button>
        </div>
      </div>
    </Modal>
  )
}
