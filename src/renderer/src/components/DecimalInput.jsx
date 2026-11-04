import React, { useEffect, useRef, useState } from 'react'

// Camp numeric din formular (cantitate, pret, reducere, km): text simplu (fara
// sageti de incrementare), tastatura numerica, selectare integrala la focus si
// normalizare la blur.
//  - `sanitize(raw)`: curata textul tastat (ex: doar cifre si separatori).
//  - `normalize(value)`: valoarea finala la blur (ex: "12,5" -> "12.50").
//  - `display(value)`: cum se arata cand campul NU are focus (ex: "185 000");
//    in timpul editarii se vede valoarea simpla, ca cursorul sa nu sara.
export default function DecimalInput({ value, onChange, sanitize, normalize, display, ...rest }) {
  const [focused, setFocused] = useState(false)
  const ref = useRef(null)

  // Selectarea se face dupa randare: cand `display` schimba textul la focus
  // ("185 000" -> "185000"), un select() facut direct in onFocus s-ar pierde.
  useEffect(() => {
    if (focused) ref.current?.select()
  }, [focused])

  const raw = value ?? ''
  const shown = focused || !display ? raw : display(raw)

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      {...rest}
      ref={ref}
      value={shown}
      onFocus={() => setFocused(true)}
      onChange={(e) => onChange(sanitize ? sanitize(e.target.value) : e.target.value)}
      onBlur={() => {
        setFocused(false)
        if (normalize) {
          const next = normalize(value)
          // Compararea ca text: 0 (numar) vs "0" nu e o schimbare reala.
          if (String(next) !== String(value ?? '')) onChange(next)
        }
      }}
    />
  )
}
