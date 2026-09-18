import React, { useEffect, useRef, useState } from 'react'

// Meniu compact pentru actiuni rar folosite - fara el, topbar-ul se umple
// de butoane si titlul/actiunile principale (cautare, actualizari) se pierd
// in aglomeratie de fiecare data cand mai adaugam o functie noua.
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
      <button type="button" onClick={() => setOpen((o) => !o)} title="Mai multe actiuni">
        ⋯ Mai multe
      </button>
      {open && (
        <ul className="autocomplete-dropdown">
          {items.map((item) => (
            <li key={item.label}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  item.onClick()
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
