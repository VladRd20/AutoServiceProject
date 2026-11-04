import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { foldForMatch } from '../../../shared/calculations'

const MAX_RESULTS = 8

// Input cu dropdown de sugestii stilizat propriu - inlocuieste <datalist>-ul
// nativ, care nu poate fi stilizat (arata mereu ca meniul brut al browser-ului,
// indiferent de tema aplicatiei). Pattern ARIA "combobox cu listbox":
// focusul ramane in input, iar optiunea evidentiata e anuntata prin
// aria-activedescendant.
export default function Autocomplete({
  value,
  onChange,
  options,
  placeholder,
  id,
  inputRef,
  maxLength,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy
}) {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const containerRef = useRef(null)
  const blurTimerRef = useRef(null)
  const listId = useId()

  const query = foldForMatch(value)
  // Listele de marci/modele/piese/lucrari cresc in sute de intrari dupa luni
  // de utilizare reala - fara memo, filtrarea (cu foldForMatch pe fiecare
  // optiune) rula la fiecare randare, inclusiv la cele declansate de alte
  // campuri din formular, nu doar la tastare in acest input.
  const { filtered, extra } = useMemo(() => {
    const list = query ? options.filter((o) => foldForMatch(o).includes(query)) : options
    return { filtered: list.slice(0, MAX_RESULTS), extra: Math.max(0, list.length - MAX_RESULTS) }
  }, [options, query])

  const expanded = open && filtered.length > 0
  const optionId = (i) => `${listId}-opt-${i}`

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => () => clearTimeout(blurTimerRef.current), [])

  // Randul evidentiat cu sagetile trebuie sa ramana vizibil in lista cu scroll.
  useEffect(() => {
    if (!expanded || highlighted < 0) return
    containerRef.current?.querySelector(`[id="${optionId(highlighted)}"]`)?.scrollIntoView?.({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlighted, expanded])

  function selectOption(opt) {
    onChange(opt)
    setOpen(false)
    setHighlighted(-1)
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown' && !expanded && filtered.length > 0) {
      e.preventDefault()
      setOpen(true)
      setHighlighted(0)
      return
    }
    if (!expanded) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter' && highlighted >= 0) {
      e.preventDefault()
      // Nu lasam Enter-ul care tocmai a ales o sugestie sa mai urce mai
      // departe - un parinte care asculta Enter (ex: ListaItems, pentru
      // "adauga linie noua") l-ar mai prinde o data si ar declansa si acea
      // actiune in aceeasi apasare.
      e.stopPropagation()
      selectOption(filtered[highlighted])
    } else if (e.key === 'Tab' && highlighted >= 0) {
      // Tab accepta sugestia evidentiata si lasa focusul sa treasca normal mai departe.
      selectOption(filtered[highlighted])
    } else if (e.key === 'Escape') {
      // Inchide doar lista, fara sa goleasca inputul; preventDefault ca un
      // dialog parinte (useDialog) sa nu se inchida in aceeasi apasare.
      e.preventDefault()
      setOpen(false)
      setHighlighted(-1)
    }
  }

  function handleBlur() {
    // Timeout scurt, nu inchidere instanta la blur: pastreaza dropdown-ul pe
    // ecran suficient cat un onMouseDown de selectie (mai jos) sa apuce sa
    // ruleze, in loc sa dispara chiar inainte ca selectia sa se inregistreze.
    blurTimerRef.current = setTimeout(() => setOpen(false), 150)
  }

  return (
    <div className="autocomplete" ref={containerRef}>
      <input
        id={id}
        ref={inputRef}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded && highlighted >= 0 ? optionId(highlighted) : undefined}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        autoComplete="off"
        maxLength={maxLength}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setHighlighted(-1)
        }}
        onFocus={() => setOpen(true)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
      {expanded && (
        <ul className="autocomplete-dropdown" id={listId} role="listbox">
          {filtered.map((opt, i) => (
            <li
              key={opt}
              id={optionId(i)}
              role="option"
              aria-selected={i === highlighted}
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
          {extra > 0 && (
            <li className="autocomplete-hint" role="presentation" aria-hidden="true">
              +{extra} {extra === 1 ? 'rezultat' : 'rezultate'}
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
