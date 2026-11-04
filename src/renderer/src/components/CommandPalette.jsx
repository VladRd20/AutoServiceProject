import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { calcTotaluri, foldForMatch, reduceriDinFisa } from '../../../shared/calculations'
import { PRESETS, hasRange, presetRange } from '../../../shared/dateRange'
import useDialog from '../hooks/useDialog'
import { openShortcutsHelp } from '../hooks/useShortcuts'
import { getThemeMode, nextThemeMode, setThemeMode } from '../theme'
import Icon from './Icon'

const SEARCH_DEBOUNCE_MS = 300
const GROUP_CAP = 50

function formatData(dataISO) {
  const datePart = String(dataISO || '').slice(0, 10)
  const [y, m, d] = datePart.split('-')
  return y && m && d ? `${d}.${m}.${y}` : dataISO || '-'
}

// Intervalul potrivit din `text`, ignorand diacriticele si majusculele
// ("stefan" gaseste "Ștefan"). Pliem caracter cu caracter si pastram harta
// pozitiilor, ca indicii sa ramana valizi si cand un caracter se descompune.
export function highlightRange(text, query) {
  const needle = foldForMatch(String(query || '').trim())
  if (!needle) return null
  const s = String(text ?? '')
  let folded = ''
  const starts = []
  const ends = []
  let pos = 0
  for (const ch of Array.from(s)) {
    const f = foldForMatch(ch)
    for (let i = 0; i < f.length; i++) {
      starts.push(pos)
      ends.push(pos + ch.length)
    }
    folded += f
    pos += ch.length
  }
  const at = folded.indexOf(needle)
  if (at < 0) return null
  return [starts[at], ends[at + needle.length - 1]]
}

export function Highlight({ text, query }) {
  const s = String(text ?? '')
  const r = highlightRange(s, query)
  if (!r) return <>{s}</>
  return (
    <>
      {s.slice(0, r[0])}
      <mark>{s.slice(r[0], r[1])}</mark>
      {s.slice(r[1])}
    </>
  )
}

const plateOf = (f) => f?.auto?.nrInmatriculare?.trim() || ''

// Paleta de comenzi (Ctrl+K / clic pe campul din topbar). Isi are propriul
// input si propriul focus-trap (useDialog), deci nu mai suprapunem un panou
// peste inputul din topbar. Cautarea in fisele finalizate: aceeasi
// debounce + eliminare a raspunsurilor vechi ca in vechiul SearchModal.
export default function CommandPalette({
  fisa,
  drafts = [],
  recentFise = [],
  onClose,
  onOpenPdf,
  onPrintPdf,
  onDeleteFinalized,
  onEditRecent,
  onNewForProfile,
  onOpenDraft,
  onNewFisa,
  onOpenReports,
  onOpenSettings,
  onShowVehicleHistory
}) {
  const dialogRef = useRef(null)
  const inputRef = useRef(null)
  const listId = useId()
  const { dialogProps } = useDialog(dialogRef, { onClose, initialFocus: () => inputRef.current })

  const [query, setQuery] = useState('')
  const [range, setRange] = useState({ from: '', to: '' })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [activeKey, setActiveKey] = useState(null)
  const [expanded, setExpanded] = useState({})
  const [deleted, setDeleted] = useState(() => new Set())
  const busyRef = useRef(new Set())
  const [, setBusyTick] = useState(0)
  // Un raspuns IPC intarziat al unei cautari vechi nu are voie sa suprascrie
  // rezultatele celei mai recente: aplicam doar raspunsul ultimei cereri pornite.
  const requestIdRef = useRef(0)

  const trimmed = query.trim()
  const { from: rangeFrom, to: rangeTo } = range
  const searchActive = Boolean(trimmed) || hasRange(range)

  useEffect(() => {
    const myId = ++requestIdRef.current
    if (!trimmed && !hasRange({ from: rangeFrom, to: rangeTo })) {
      setResults(null)
      setSearching(false)
      setError('')
      return undefined
    }
    setSearching(true)
    setError('')
    const timer = setTimeout(async () => {
      let res
      try {
        res = await window.serviceAuto.fisa.search(query, { from: rangeFrom, to: rangeTo })
      } catch (err) {
        res = { ok: false, error: { message: err?.message } }
      }
      if (requestIdRef.current !== myId) return
      setSearching(false)
      if (res?.ok) {
        setResults(Array.isArray(res.data) ? res.data : [])
      } else {
        setResults([])
        setError(res?.error?.message || 'Căutarea a eșuat.')
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // `trimmed` deriva din `query`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, rangeFrom, rangeTo])

  const run = useCallback(
    (fn) => {
      onClose?.()
      fn?.()
    },
    [onClose]
  )

  const plate = plateOf(fisa)
  const vin = fisa?.auto?.vin || ''
  const actions = useMemo(() => {
    const list = []
    if (onNewFisa) list.push({ id: 'new', label: 'Fișă nouă', hint: 'Ctrl+N', icon: 'plus', run: () => run(onNewFisa) })
    if (onOpenReports) list.push({ id: 'reports', label: 'Rapoarte', icon: 'chart', run: () => run(onOpenReports) })
    if (onOpenSettings) list.push({ id: 'settings', label: 'Setări', icon: 'settings', run: () => run(onOpenSettings) })
    if (onShowVehicleHistory && plate) {
      list.push({
        id: 'history',
        label: `Istoric mașină ${plate}`,
        icon: 'history',
        run: () => run(() => onShowVehicleHistory(vin, plate))
      })
    }
    list.push({
      id: 'theme',
      label: 'Comută tema',
      icon: 'moon',
      run: () =>
        run(() => {
          // Butonul din topbar isi tine starea local: il apasam ca iconita sa ramana sincronizata.
          const btn = document.querySelector('.theme-toggle')
          if (btn) btn.click()
          else setThemeMode(nextThemeMode(getThemeMode()))
        })
    })
    list.push({ id: 'shortcuts', label: 'Scurtături', hint: '?', icon: 'info', run: () => run(openShortcutsHelp) })
    if (!trimmed) return list
    const q = foldForMatch(trimmed)
    return list.filter((a) => foldForMatch(a.label).includes(q))
  }, [onNewFisa, onOpenReports, onOpenSettings, onShowVehicleHistory, plate, vin, trimmed, run])

  const matchedDrafts = useMemo(() => {
    if (!trimmed) return []
    const q = foldForMatch(trimmed)
    return drafts.filter((d) => foldForMatch(`${plateOf(d)} ${d.client?.nume || ''}`).includes(q))
  }, [drafts, trimmed])

  const fiseList = useMemo(() => {
    const base = searchActive ? results || [] : recentFise
    return base.filter((f) => !deleted.has(f._file))
  }, [searchActive, results, recentFise, deleted])

  // Lista plata de randuri (ordinea = ordinea de navigare cu sagetile). Se
  // recalculeaza doar din date/expandari, niciodata din navigarea cu sagetile.
  const { groups, rows } = useMemo(() => {
    const gs = []
    const add = (key, label, items, toRow) => {
      if (items.length === 0) return
      const shown = expanded[key] ? items : items.slice(0, GROUP_CAP)
      const grows = shown.map(toRow)
      if (!expanded[key] && items.length > GROUP_CAP) {
        grows.push({ key: `${key}:more`, kind: 'more', group: key, count: items.length - GROUP_CAP })
      }
      gs.push({ key, label, rows: grows })
    }
    add('fise', searchActive ? 'Fișe finalizate' : 'Fișe recente', fiseList, (f) => ({
      key: `fisa:${f._file}`,
      kind: 'fisa',
      fisa: f
    }))
    add('drafts', 'Drafturi în lucru', matchedDrafts, (d) => ({ key: `draft:${d.id}`, kind: 'draft', draft: d }))
    add('actions', 'Acțiuni', actions, (a) => ({ key: `action:${a.id}`, kind: 'action', action: a }))
    return { groups: gs, rows: gs.flatMap((g) => g.rows) }
  }, [fiseList, matchedDrafts, actions, expanded, searchActive])

  const foundIdx = rows.findIndex((r) => r.key === activeKey)
  const activeIdx = foundIdx >= 0 ? foundIdx : 0
  const activeRow = rows[activeIdx]
  const optId = (key) => `${listId}-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`
  const activeDomId = activeRow ? optId(activeRow.key) : undefined

  useEffect(() => {
    if (activeDomId) document.getElementById(activeDomId)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeDomId])

  function activate(row) {
    if (!row) return
    if (row.kind === 'more') {
      setExpanded((e) => ({ ...e, [row.group]: true }))
    } else if (row.kind === 'action') {
      row.action.run()
    } else if (row.kind === 'draft') {
      run(() => onOpenDraft?.(row.draft.id))
    } else if (onEditRecent) {
      run(() => onEditRecent(row.fisa))
    } else {
      onOpenPdf?.(row.fisa._file)
    }
  }

  function move(i) {
    if (rows.length === 0) return
    setActiveKey(rows[(i + rows.length) % rows.length].key)
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(activeIdx + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(activeIdx - 1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      move(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      move(rows.length - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      activate(activeRow)
    }
  }

  async function handleDelete(fileName) {
    if (busyRef.current.has(fileName)) return
    busyRef.current.add(fileName)
    setBusyTick((n) => n + 1)
    try {
      const ok = await onDeleteFinalized?.(fileName)
      if (ok) setDeleted((s) => new Set(s).add(fileName))
    } catch {
      // lista ramane intacta
    } finally {
      busyRef.current.delete(fileName)
      setBusyTick((n) => n + 1)
    }
  }

  const stop = (fn) => (e) => {
    e.stopPropagation()
    fn()
  }

  function renderRow(row) {
    const active = row.key === activeRow?.key
    const common = {
      id: optId(row.key),
      role: 'option',
      'aria-selected': active,
      className: `palette-row palette-row-${row.kind}${active ? ' active' : ''}`,
      onMouseMove: () => {
        if (!active) setActiveKey(row.key)
      },
      onClick: () => activate(row)
    }
    if (row.kind === 'more') {
      return (
        <li key={row.key} {...common}>
          <span className="palette-more">+{row.count} rezultate</span>
        </li>
      )
    }
    if (row.kind === 'action') {
      const a = row.action
      return (
        <li key={row.key} {...common}>
          <Icon name={a.icon} size={15} className="palette-row-icon" />
          <span className="palette-row-title">
            <Highlight text={a.label} query={query} />
          </span>
          {a.hint && <kbd className="palette-hint">{a.hint}</kbd>}
        </li>
      )
    }
    if (row.kind === 'draft') {
      const d = row.draft
      return (
        <li key={row.key} {...common}>
          <span className="palette-row-title">
            <strong className="plate-sm">
              <Highlight text={plateOf(d) || 'Fără număr'} query={query} />
            </strong>{' '}
            <Highlight text={d.client?.nume || 'Fără nume client'} query={query} />
          </span>
          <span className="palette-row-meta">Draft</span>
        </li>
      )
    }
    const f = row.fisa
    const reduceri = reduceriDinFisa(f)
    const t = calcTotaluri(f.piese, f.lucrari, reduceri.piese, reduceri.lucrari)
    // Butoanele din rand sunt tabbable doar pe randul activ.
    const ti = active ? 0 : -1
    return (
      <li key={row.key} {...common}>
        <div className="palette-fisa-main">
          <strong>
            <Highlight text={f.auto?.nrInmatriculare || 'Fără număr'} query={query} />
          </strong>
          {f.nr && <span className="fisa-nr">#{f.nr}</span>}
          <span>
            <Highlight text={`${f.auto?.marca || ''} ${f.auto?.model || ''}`.trim()} query={query} />
          </span>
          <span>
            <Highlight text={f.client?.nume || ''} query={query} />
          </span>
          <span>
            <Highlight text={f.client?.telefon || ''} query={query} />
          </span>
        </div>
        <div className="palette-row-meta">
          <span>{formatData(f.data)}</span>
          <span>{t.totalFinal.toFixed(2)} lei</span>
        </div>
        <div className="palette-fisa-actions">
          <button type="button" tabIndex={ti} onClick={stop(() => onOpenPdf?.(f._file))}>
            Deschide PDF
          </button>
          <button type="button" tabIndex={ti} onClick={stop(() => onPrintPdf?.(f._file))}>
            Printează
          </button>
          {onEditRecent && (
            <button
              type="button"
              tabIndex={ti}
              title="Deschide fișa în program (coduri piese, notițe interne)"
              onClick={stop(() => run(() => onEditRecent(f)))}
            >
              Editează
            </button>
          )}
          {onNewForProfile && (
            <button
              type="button"
              tabIndex={ti}
              title="Pornește o fișă nouă, goală, cu datele clientului și ale mașinii precompletate"
              onClick={stop(() => run(() => onNewForProfile(f)))}
            >
              Fișă nouă (același profil)
            </button>
          )}
          <button
            type="button"
            tabIndex={ti}
            className="btn-remove"
            title="Șterge (mută în coș)"
            aria-label="Șterge fișa"
            disabled={busyRef.current.has(f._file)}
            onClick={stop(() => handleDelete(f._file))}
          >
            ✕
          </button>
        </div>
      </li>
    )
  }

  const noMatches =
    searchActive && !searching && !error && !rows.some((r) => r.kind === 'fisa' || r.kind === 'draft')

  return (
    <div
      className="palette-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div className="palette" ref={dialogRef} {...dialogProps} aria-labelledby={undefined} aria-label="Caută">
        <div className="palette-input-row">
          <Icon name="search" size={16} className="palette-input-icon" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            className="palette-input"
            placeholder="Caută fișe, drafturi sau acțiuni"
            aria-label="Caută"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeDomId}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button
            type="button"
            className={`btn-sm palette-filter-btn${filtersOpen || hasRange(range) ? ' active' : ''}`}
            title="Filtrează după dată"
            aria-label="Filtrează după dată"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((v) => !v)}
          >
            <Icon name="calendar" size={14} />
          </button>
        </div>
        {filtersOpen && (
          <div className="search-filters">
            <div className="search-presets">
              {PRESETS.map((p) => {
                const r = presetRange(p.key)
                const active = r.from === range.from && r.to === range.to
                return (
                  <button
                    key={p.key}
                    type="button"
                    className={`btn-sm${active ? ' active' : ''}`}
                    onClick={() => setRange(active ? { from: '', to: '' } : r)}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
            <div className="search-dates">
              <label>
                De la
                <input
                  type="date"
                  value={range.from}
                  max={range.to || undefined}
                  onChange={(e) => setRange({ ...range, from: e.target.value })}
                />
              </label>
              <label>
                Până la
                <input
                  type="date"
                  value={range.to}
                  min={range.from || undefined}
                  onChange={(e) => setRange({ ...range, to: e.target.value })}
                />
              </label>
              {hasRange(range) && (
                <button type="button" className="btn-sm" onClick={() => setRange({ from: '', to: '' })}>
                  Șterge filtrul
                </button>
              )}
            </div>
          </div>
        )}
        <div className="palette-body">
          {searching && <div className="skeleton shimmer palette-shimmer" aria-hidden="true" data-testid="palette-loading" />}
          {!searching && error && (
            <p className="field-error palette-msg" role="alert">
              {error}
            </p>
          )}
          {noMatches && (
            <p className="hint palette-msg">
              {trimmed ? `Niciun rezultat pentru „${trimmed}”` : 'Nicio fișă în acest interval'}
              {trimmed && hasRange(range) ? ' în intervalul ales' : ''}.
            </p>
          )}
          <ul id={listId} role="listbox" aria-label="Rezultate" className="palette-list">
            {groups.map((g) => (
              <li key={g.key} role="presentation" className="palette-group">
                <div className="palette-group-label" id={`${listId}-g-${g.key}`} role="presentation">
                  {g.label}
                </div>
                <ul role="group" aria-labelledby={`${listId}-g-${g.key}`}>
                  {g.rows.map(renderRow)}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
