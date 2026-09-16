import React, { useEffect, useRef, useState } from 'react'
import { foldForMatch } from '../../../shared/calculations'

const MAX_RESULTS = 8

// Input cu dropdown de sugestii stilizat propriu - inlocuieste <datalist>-ul
// nativ, care nu poate fi stilizat (arata mereu ca meniul brut al browser-ului,
// indiferent de tema aplicatiei).
export default function Autocomplete({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const containerRef = useRef(null)

  const query = foldForMatch(value)
  const filtered = (query ? options.filter((o) => foldForMatch(o).includes(query)) : options).slice(
    0,
    MAX_RESULTS
  )

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function selectOption(opt) {
    onChange(opt)
    setOpen(false)
    setHighlighted(-1)
  }

  function handleKeyDown(e) {
    if (!open || filtered.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter' && highlighted >= 0) {
      e.preventDefault()
      selectOption(filtered[highlighted])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="autocomplete" ref={containerRef}>
      <input
        type="text"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setHighlighted(-1)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && (
        <ul className="autocomplete-dropdown">
          {filtered.map((opt, i) => (
            <li
              key={opt}
              className={i === highlighted ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault()
                selectOption(opt)
              }}
              onMouseEnter={() => setHighlighted(i)}
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
