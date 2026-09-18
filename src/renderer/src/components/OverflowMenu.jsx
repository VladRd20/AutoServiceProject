import React, { useEffect, useRef, useState } from 'react'
import Icon from './Icon'

// Meniu compact pentru acțiuni rar folosite - fără el, topbar-ul se umple
// de butoane și titlul/acțiunile principale (căutare, actualizări) se pierd
// în aglomerație de fiecare dată când mai adăugăm o funcție nouă.
export default function OverflowMenu({ items }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div
      className="autocomplete overflow-menu"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false)
      }}
    >
      <button
        type="button"
        className="icon-btn"
        onClick={() => setOpen((o) => !o)}
        title="Mai multe acțiuni"
        aria-label="Mai multe acțiuni"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name="more" size={18} />
      </button>
      {open && (
        <ul className="autocomplete-dropdown" role="menu">
          {items.map((item) => (
            <li key={item.label}>
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  item.onClick()
                }}
              >
                {item.icon && <Icon name={item.icon} />}
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
