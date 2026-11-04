import React, { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  calcLinieTotal,
  foldForMatch,
  formatPrice,
  formatQuantity,
  parseDecimal,
  sanitizeDecimalText
} from '../../../shared/calculations'
import { LengthCounter } from './FisaForm'
import Autocomplete from './Autocomplete'
import DecimalInput from './DecimalInput'
import Icon from './Icon'
import { formatLei } from '../format'

const MAX_LINII = 300
const UNDO_MS = 8000

// crypto.randomUUID() e disponibil in runtime-ul Chromium al Electron - mult
// mai sigur decat un contor de modul care se reseteaza la fiecare pornire a
// aplicatiei si depindea de Date.now() ca sa nu se suprapuna peste id-uri
// deja incarcate dintr-un draft salvat anterior.
export function newItemId() {
  return crypto.randomUUID()
}

// Maner de tras (drag) pentru reordonare. Calea accesibila e Alt+↑/↓, deci
// manerul e doar o comoditate pentru mouse.
function GripIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      {[7, 12, 17].map((y) => (
        <React.Fragment key={y}>
          <circle cx="9" cy={y} r="1.6" />
          <circle cx="15" cy={y} r="1.6" />
        </React.Fragment>
      ))}
    </svg>
  )
}

// Un rand e "gol" cand nu are nimic introdus (cantitatea nu conteaza: porneste de la 1).
function isRowEmpty(item, priceKey, codKey) {
  const pret = parseDecimal(item[priceKey])
  return !item.denumire?.trim() && !(codKey && item[codKey]?.trim()) && (pret === null || pret === 0)
}

// memo: onChange-ul primit din App.jsx e un useCallback stabil (vezi
// handlePieseChange/handleLucrariChange) - fara alte props instabile,
// comparatia shallow a memo() evita re-randarea listei de piese la fiecare
// litera tastata in campurile de client/auto, sau in lista de lucrari.
// `showToast` (stabil) afiseaza "Rând șters · Anulează"; `resetKey` (id-ul
// fisei) invalideaza anularea daca intre timp s-a deschis alta fisa.
function ListaItems({
  titlu,
  singular,
  items,
  onChange,
  priceKey,
  codKey,
  priceLabel,
  errorPrefix,
  errors,
  suggestions,
  showToast,
  resetKey
}) {
  // Referinta stabila intre randari (cat timp `suggestions` nu s-a schimbat
  // efectiv) - altfel Autocomplete.jsx primeste un array nou la fiecare
  // randare si memo-ul lui pe `options` nu prinde niciodata cache.
  const denumiri = useMemo(() => (suggestions || []).map((s) => s.denumire), [suggestions])
  const rowRefs = useRef(new Map())
  const focusRef = useRef(null) // { id, field }: de focusat dupa urmatoarea randare
  const itemsRef = useRef(items)
  itemsRef.current = items
  const resetKeyRef = useRef(resetKey)
  resetKeyRef.current = resetKey
  const [announce, setAnnounce] = useState('')
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)

  // Ruleaza dupa ce randul exista in DOM (adaugat, duplicat sau mutat - un nod
  // DOM mutat pierde focusul), ca sa-i putem da focus pe campul dorit.
  useEffect(() => {
    const target = focusRef.current
    if (!target) return
    focusRef.current = null
    const inputs = rowRefs.current.get(target.id)?.querySelectorAll('input')
    if (inputs?.length) inputs[Math.min(target.field, inputs.length - 1)].focus()
  }, [items])

  function updateItem(id, patch) {
    onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }

  // Cand denumirea introdusa se potriveste exact cu una folosita anterior si
  // pretul e inca la valoarea implicita (0, adica linie noua neatinsa),
  // completam automat ultimul pret folosit pentru acel denumire - util pentru
  // piese/lucrari recurente (schimb ulei, filtru etc), fara sa suprascriem
  // vreodata un pret pe care utilizatorul l-a introdus deja intentionat.
  function handleDenumireChange(item, value) {
    const match = suggestions?.find((s) => foldForMatch(s.denumire) === foldForMatch(value))
    if (match && match[priceKey] != null && Number(item[priceKey]) === 0) {
      updateItem(item.id, { denumire: value, [priceKey]: match[priceKey] })
    } else {
      updateItem(item.id, { denumire: value })
    }
  }

  const subtotal = items.reduce((sum, it) => sum + calcLinieTotal(it.cantitate, it[priceKey]), 0)

  const atLimit = items.length >= MAX_LINII

  function addItem() {
    if (items.length >= MAX_LINII) return
    const id = newItemId()
    focusRef.current = { id, field: 0 }
    onChange([...items, { id, denumire: '', ...(codKey ? { [codKey]: '' } : {}), cantitate: 1, [priceKey]: 0 }])
  }

  function duplicateItem(index, field) {
    if (items.length >= MAX_LINII) return
    const id = newItemId()
    focusRef.current = { id, field }
    const next = [...items]
    next.splice(index + 1, 0, { ...items[index], id })
    onChange(next)
  }

  function moveItem(index, delta, field) {
    const to = index + delta
    if (to < 0 || to >= items.length) return
    const next = [...items]
    ;[next[index], next[to]] = [next[to], next[index]]
    focusRef.current = { id: items[index].id, field }
    onChange(next)
    setAnnounce(`Rând mutat pe poziția ${to + 1} din ${items.length}`)
  }

  function restoreItem(removed, index, keyAtDelete) {
    const current = itemsRef.current
    if (resetKeyRef.current !== keyAtDelete || current.some((it) => it.id === removed.id)) return false
    if (current.length >= MAX_LINII) return false
    const next = [...current]
    next.splice(Math.min(index, next.length), 0, removed)
    focusRef.current = { id: removed.id, field: 0 }
    onChange(next)
    return true
  }

  // Stergerea e instanta (fara dialog blocant); un rand cu continut poate fi
  // adus inapoi din "Anulează" cateva secunde. Cu tastatura, focusul trece pe
  // randul vecin, ca sa nu "cada" in pagina.
  function removeItem(id, { focusNeighbour = false } = {}) {
    const index = items.findIndex((it) => it.id === id)
    if (index < 0) return
    const removed = items[index]
    const next = items.filter((it) => it.id !== id)
    if (focusNeighbour && next.length > 0) {
      focusRef.current = { id: next[Math.min(index, next.length - 1)].id, field: 0 }
    }
    onChange(next)
    if (isRowEmpty(removed, priceKey, codKey) || !showToast) return
    const keyAtDelete = resetKeyRef.current
    let done = false
    showToast(
      'success',
      removed.denumire?.trim() ? `Rând șters: «${removed.denumire.trim()}»` : 'Rând șters',
      {
        label: 'Anulează',
        onClick: () => {
          if (done) return
          done = true
          if (!restoreItem(removed, index, keyAtDelete)) showToast('error', 'Rândul nu mai poate fi restaurat.')
        }
      },
      { duration: UNDO_MS }
    )
  }

  // Scurtaturile de rand. Alt+↑/↓, Ctrl+D si Ctrl+Backspace se trateaza in faza
  // de captura: Autocomplete (copil) ar intercepta sagetile pentru lista lui.
  function handleRowKeyDownCapture(e, index) {
    const item = items[index]
    const field = Math.max(0, [...e.currentTarget.querySelectorAll('input')].indexOf(e.target))
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      e.stopPropagation()
      moveItem(index, e.key === 'ArrowUp' ? -1 : 1, field)
    } else if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      e.stopPropagation()
      duplicateItem(index, field)
    } else if (e.ctrlKey && !e.altKey && e.key === 'Backspace' && isRowEmpty(item, priceKey, codKey)) {
      e.preventDefault()
      e.stopPropagation()
      removeItem(item.id, { focusNeighbour: true })
    }
  }

  // Enter (daca Autocomplete nu l-a folosit deja pentru o sugestie) trece pe
  // primul camp al randului urmator; pe ultimul rand adauga o linie noua.
  function handleRowKeyDown(e, index) {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey)
      return
    e.preventDefault()
    if (index < items.length - 1) {
      rowRefs.current
        .get(items[index + 1].id)
        ?.querySelector('input')
        ?.focus()
    } else {
      addItem()
    }
  }

  function handleDrop(targetId) {
    const from = items.findIndex((it) => it.id === dragId)
    const to = items.findIndex((it) => it.id === targetId)
    setDragId(null)
    setOverId(null)
    if (from < 0 || to < 0 || from === to) return
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange(next)
    setAnnounce(`Rând mutat pe poziția ${to + 1} din ${items.length}`)
  }

  return (
    <section className="card">
      <div className="card-header">
        <h2>
          {titlu}
          {items.length > 0 && <span className="count-badge">{items.length}</span>}
        </h2>
        <div className="card-header-right">
          {items.length > 0 && <span className="subtotal">{formatLei(subtotal)}</span>}
          <button
            type="button"
            className="btn-sm"
            onClick={addItem}
            disabled={atLimit}
            title={atLimit ? 'Maxim 300 de linii' : undefined}
          >
            <Icon name="plus" /> Adaugă
          </button>
          {atLimit && <span className="hint">Maxim 300 de linii</span>}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="empty-state">
          <p>Nicio linie adăugată încă.</p>
          <button type="button" className="btn-sm" onClick={addItem}>
            <Icon name="plus" /> Adaugă {singular}
          </button>
        </div>
      ) : (
        <div className="linie linie-head" aria-hidden="true">
          <span className="linie-grip-spacer" />
          <span className="field-grow">Denumire</span>
          {codKey && (
            <span className="field-cod" title="Doar intern, nu se printează">
              Cod (intern)
            </span>
          )}
          <span className="field-small">Cant.</span>
          <span className="field-small">{priceLabel}</span>
          <span className="linie-total">Total</span>
          <span className="btn-remove-spacer" />
        </div>
      )}

      {items.map((item, i) => {
        const err = (field) => errors?.[`${errorPrefix}.${i}.${field}`]
        const errId = (field) => `${errorPrefix}-${i}-${field}-error`
        // aria-invalid + aria-describedby pe campul cu eroare (ca in Field din
        // FisaForm): focusFirstInvalid() din useRelease ajunge astfel si aici.
        const a11y = (field) => (err(field) ? { 'aria-invalid': 'true', 'aria-describedby': errId(field) } : {})
        const errorText = (field) =>
          err(field) && (
            <span className="field-error" id={errId(field)}>
              {err(field)}
            </span>
          )
        const cls = `linie${dragId === item.id ? ' is-dragging' : ''}${overId === item.id && dragId && dragId !== item.id ? ' is-drop-target' : ''}`
        return (
          <div
            className={cls}
            key={item.id}
            ref={(el) => {
              if (el) rowRefs.current.set(item.id, el)
              else rowRefs.current.delete(item.id)
            }}
            onKeyDownCapture={(e) => handleRowKeyDownCapture(e, i)}
            onKeyDown={(e) => handleRowKeyDown(e, i)}
            onDragOver={(e) => {
              if (!dragId) return
              e.preventDefault()
              if (overId !== item.id) setOverId(item.id)
            }}
            onDrop={(e) => {
              if (!dragId) return
              e.preventDefault()
              handleDrop(item.id)
            }}
          >
            <span
              className="linie-grip"
              draggable
              title="Trage pentru a reordona (sau Alt+↑/↓)"
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', item.id)
                const row = rowRefs.current.get(item.id)
                if (row) e.dataTransfer.setDragImage(row, 16, 16)
                setDragId(item.id)
              }}
              onDragEnd={() => {
                setDragId(null)
                setOverId(null)
              }}
            >
              <GripIcon />
            </span>
            <div className="field field-grow">
              <Autocomplete
                value={item.denumire}
                onChange={(v) => handleDenumireChange(item, v)}
                options={denumiri}
                placeholder="Denumire"
                maxLength={200}
                {...a11y('denumire')}
              />
              <LengthCounter value={item.denumire} max={200} />
              {errorText('denumire')}
            </div>
            {codKey && (
              <div className="field field-cod">
                <input
                  type="text"
                  placeholder="Cod piesă"
                  aria-label="Cod piesă (intern, nu se printează)"
                  title="Doar intern, nu se printează"
                  maxLength={64}
                  value={item[codKey] ?? ''}
                  onChange={(e) => updateItem(item.id, { [codKey]: e.target.value })}
                  {...a11y('cod')}
                />
                {errorText('cod')}
              </div>
            )}
            <div className="field field-small">
              <DecimalInput
                placeholder="Cant."
                aria-label="Cantitate"
                value={item.cantitate}
                sanitize={sanitizeDecimalText}
                normalize={formatQuantity}
                onChange={(v) => updateItem(item.id, { cantitate: v })}
                {...a11y('cantitate')}
              />
              {errorText('cantitate')}
            </div>
            <div className="field field-small">
              <DecimalInput
                placeholder={priceLabel}
                aria-label={priceLabel}
                value={item[priceKey]}
                sanitize={sanitizeDecimalText}
                normalize={formatPrice}
                onChange={(v) => updateItem(item.id, { [priceKey]: v })}
                {...a11y(priceKey)}
              />
              {errorText(priceKey)}
            </div>
            <div className="linie-total">{formatLei(calcLinieTotal(item.cantitate, item[priceKey]))}</div>
            <button
              type="button"
              className="btn-remove"
              onClick={() => removeItem(item.id)}
              title="Șterge linia (Ctrl+Backspace pe un rând gol)"
              aria-label="Șterge linia"
            >
              <Icon name="x" />
            </button>
          </div>
        )
      })}
      <span className="sr-only" role="status" aria-live="polite">
        {announce}
      </span>
    </section>
  )
}

export default memo(ListaItems)
