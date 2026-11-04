import React, { useEffect, useRef, useState } from 'react'
import { exceedsIntDigits, toDisplayDecimal } from '../../../shared/calculations'

// Camp numeric din formular (cantitate, pret, reducere, km): text simplu (fara
// sageti de incrementare), tastatura numerica, selectare integrala la focus si
// normalizare la blur.
//  - `sanitize(raw)` (optional): curata textul tastat; campurile de pret/cantitate NU il
//    folosesc - un "abc" sau "-5" ramane vizibil si e semnalat la validare, nu e
//    transformat in tacere in alta valoare.
//  - `normalize(value)`: valoarea finala la blur (ex: "12,5" -> "12.50").
//  - `comma` (implicit true): valoarea se AFISEAZA cu virgula ("48.50" -> "48,50"),
//    ca totalurile de langa; valoarea STOCATA (ce primeste onChange la blur) ramane
//    cu punct, exact ca inainte. Textul tastat ajunge in onChange asa cum a fost scris.
//  - Blur-ul normalizeaza DOAR daca utilizatorul a modificat campul de la focus:
//    un Tab prin camp nu schimba o valoare veche ("48.555") si nu murdareste fisa.
//  - Maxim 12 cifre la partea intreaga (peste, tasta e ignorata).
//  - `display(value)`: cum se arata cand campul NU are focus (ex: "185 000");
//    in timpul editarii se vede valoarea simpla, ca cursorul sa nu sara.
export default function DecimalInput({ value, onChange, sanitize, normalize, display, comma = true, ...rest }) {
  const [focused, setFocused] = useState(false)
  const ref = useRef(null)
  const dirtyRef = useRef(false)
  // Textul din timpul editarii (cu focus) e tinut local, ca "48." / "48," sa
  // nu fie rescrise la fiecare tasta.
  // Folosit doar cat timp valoarea din parinte e exact ce am emis (altfel parintele
  // a transformat-o - sanitize/procent - si arata valoarea lui).
  const [typed, setTyped] = useState(null)
  const emittedRef = useRef(null)

  // Selectarea se face dupa randare: cand `display` schimba textul la focus
  // ("185 000" -> "185000"), un select() facut direct in onFocus s-ar pierde.
  useEffect(() => {
    if (focused) ref.current?.select()
  }, [focused])

  const raw = value ?? ''
  const asText = comma ? toDisplayDecimal(raw) : raw
  const useTyped = typed != null && String(raw) === String(emittedRef.current)
  const shown = focused ? (useTyped ? typed : asText) : display ? display(raw) : asText

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      {...rest}
      ref={ref}
      value={shown}
      onFocus={() => {
        dirtyRef.current = false
        setTyped(null)
        setFocused(true)
      }}
      onChange={(e) => {
        const text = e.target.value
        if (exceedsIntDigits(text)) return
        dirtyRef.current = true
        const out = sanitize ? sanitize(text) : text
        setTyped(text)
        emittedRef.current = out
        onChange(out)
      }}
      onBlur={() => {
        setFocused(false)
        setTyped(null)
        if (normalize && dirtyRef.current) {
          dirtyRef.current = false
          const next = normalize(value)
          // Compararea ca text: 0 (numar) vs "0" nu e o schimbare reala.
          if (String(next) !== String(value ?? '')) onChange(next)
        }
      }}
    />
  )
}
