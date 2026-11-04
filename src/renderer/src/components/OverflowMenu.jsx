import React, { useEffect, useId, useRef, useState } from 'react'
import Icon from './Icon'

// Meniu compact pentru acțiuni rar folosite - fără el, topbar-ul se umple
// de butoane și titlul/acțiunile principale (căutare, actualizări) se pierd
// în aglomerație de fiecare dată când mai adăugăm o funcție nouă.
// Pattern ARIA "menu button": la deschidere focusul merge pe primul item,
// sageti/Home/End muta focusul (roving tabindex), Escape inchide si readuce
// focusul pe buton, Tab inchide meniul.
export default function OverflowMenu({ items }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef(null)
  const buttonRef = useRef(null)
  const itemRefs = useRef([])
  const menuId = useId()

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Indicii itemilor activabili (cei disabled nu primesc focus).
  const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0)

  function focusItem(i) {
    setActive(i)
    itemRefs.current[i]?.focus()
  }

  function openMenu() {
    setActive(enabled[0] ?? 0)
    setOpen(true)
  }

  // La deschidere, focusul merge pe primul item (dupa ce lista e in DOM).
  useEffect(() => {
    if (open) itemRefs.current[enabled[0] ?? 0]?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function closeAndFocusButton() {
    setOpen(false)
    buttonRef.current?.focus()
  }

  function handleMenuKeyDown(e) {
    const pos = enabled.indexOf(active)
    if (enabled.length === 0 && e.key !== 'Escape' && e.key !== 'Tab') return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusItem(enabled[(pos + 1) % enabled.length])
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusItem(enabled[(pos - 1 + enabled.length) % enabled.length])
    } else if (e.key === 'Home') {
      e.preventDefault()
      focusItem(enabled[0])
    } else if (e.key === 'End') {
      e.preventDefault()
      focusItem(enabled[enabled.length - 1])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeAndFocusButton()
    } else if (e.key === 'Tab') {
      // Focusul trece intai pe buton (itemul focusat dispare din DOM la
      // inchidere), apoi Tab-ul nativ continua de acolo, fara sa sara la inceputul paginii.
      closeAndFocusButton()
    }
  }

  return (
    <div className="menu overflow-menu" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        ref={buttonRef}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault()
            openMenu()
          } else if (open && e.key === 'Escape') {
            e.preventDefault()
            setOpen(false)
          }
        }}
        title="Mai multe acțiuni"
        aria-label="Mai multe acțiuni"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      >
        <Icon name="more" size={18} />
      </button>
      {open && (
        <ul className="menu-dropdown" id={menuId} role="menu" aria-label="Mai multe acțiuni" onKeyDown={handleMenuKeyDown}>
          {items.map((item, i) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                ref={(el) => {
                  itemRefs.current[i] = el
                }}
                tabIndex={i === active ? 0 : -1}
                disabled={item.disabled}
                onClick={() => {
                  // Focusul revine pe buton inainte de actiune: daca actiunea
                  // deschide un dialog, acesta isi va restaura focusul aici.
                  closeAndFocusButton()
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
