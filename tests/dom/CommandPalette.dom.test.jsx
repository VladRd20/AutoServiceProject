// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import Topbar from '../../src/renderer/src/views/Topbar'
import CommandPalette, { highlightRange } from '../../src/renderer/src/components/CommandPalette'
import useShortcuts from '../../src/renderer/src/hooks/useShortcuts'

const fisa = { auto: { nrInmatriculare: 'AB123CD', marca: '', model: '', vin: 'V1' }, client: { nume: '' }, piese: [], lucrari: [] }
const mkFisa = (file, plate, client) => ({
  _file: file,
  nr: 1,
  data: '2026-01-02',
  auto: { nrInmatriculare: plate, marca: 'Dacia', model: 'Logan' },
  client: { nume: client, telefon: '' },
  piese: [],
  lucrari: []
})

let search
beforeEach(() => {
  vi.useFakeTimers()
  search = vi.fn().mockResolvedValue({ ok: true, data: [] })
  window.serviceAuto = { fisa: { search } }
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete window.serviceAuto
})

function mkProps(over = {}) {
  return {
    fisa,
    searchInputRef: { current: null },
    showToast: vi.fn(),
    updateInfo: {},
    updateBtn: {},
    onOpenReports: vi.fn(),
    onNewFisa: vi.fn(),
    onOpenSettings: vi.fn(),
    onShowVehicleHistory: vi.fn(),
    onOpenDraft: vi.fn(),
    onEditRecent: vi.fn(),
    onOpenPdf: vi.fn(),
    drafts: [{ id: 'd1', auto: { nrInmatriculare: 'XY999ZZ' }, client: { nume: 'Ștefan Popa' } }],
    recentFise: [mkFisa('r1.json', 'RC111AA', 'Ion')],
    ...over
  }
}

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(350)
  })
const type = (v) => fireEvent.change(screen.getByRole('combobox'), { target: { value: v } })

describe('CommandPalette', () => {
  it('se deschide la clic pe campul din topbar, cu ARIA corect si focus in input', () => {
    render(<Topbar {...mkProps()} />)
    fireEvent.click(screen.getByTitle('Caută (Ctrl+K)'))
    expect(screen.getByRole('dialog', { name: 'Caută' })).toBeTruthy()
    const input = screen.getByRole('combobox')
    expect(document.activeElement).toBe(input)
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(input.getAttribute('aria-activedescendant')).toBeTruthy()
    expect(screen.getByText('Fișe recente')).toBeTruthy()
    expect(screen.getByText('Acțiuni')).toBeTruthy()
    expect(search).not.toHaveBeenCalled()
  })

  it('se deschide cu Ctrl+K', () => {
    function C() {
      useShortcuts({ releasingRef: { current: false }, modalOpen: false })
      return <Topbar {...mkProps()} />
    }
    render(<C />)
    expect(screen.queryByRole('dialog', { name: 'Caută' })).toBeNull()
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    expect(screen.getByRole('dialog', { name: 'Caută' })).toBeTruthy()
  })

  it('debounce: o singura cautare IPC, cu textul final', async () => {
    render(<CommandPalette {...mkProps()} onClose={() => {}} />)
    type('d')
    type('da')
    type('dac')
    expect(screen.getByTestId('palette-loading')).toBeTruthy()
    await flush()
    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith('dac', { from: '', to: '' })
  })

  it('arunca raspunsul vechi (stale) si pastreaza pe cel mai nou', async () => {
    let resolveOld
    search.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveOld = r
        })
    )
    search.mockResolvedValueOnce({ ok: true, data: [mkFisa('new.json', 'NEW111', 'Nou')] })
    render(<CommandPalette {...mkProps({ recentFise: [] })} onClose={() => {}} />)
    type('vechi')
    await flush()
    type('nou')
    await flush()
    expect(document.body.textContent).toContain('NEW111')
    await act(async () => resolveOld({ ok: true, data: [mkFisa('old.json', 'OLD111', 'Vechi')] }))
    expect(document.body.textContent).not.toContain('OLD111')
    expect(document.body.textContent).toContain('NEW111')
  })

  it('eroare de cautare si niciun rezultat', async () => {
    search.mockResolvedValueOnce({ ok: false, error: { message: 'Eroare disc' } })
    render(<CommandPalette {...mkProps()} onClose={() => {}} />)
    type('zzz')
    await flush()
    expect(screen.getByRole('alert').textContent).toBe('Eroare disc')
    search.mockResolvedValueOnce({ ok: true, data: [] })
    type('qqq')
    await flush()
    expect(document.body.textContent).toContain('Niciun rezultat pentru „qqq”')
  })

  it('navigare cu sageti peste grupuri, Home/End, fara cautare noua; Enter pe actiune', () => {
    const props = mkProps()
    const onClose = vi.fn()
    render(<CommandPalette {...props} onClose={onClose} />)
    const input = screen.getByRole('combobox')
    const active = () => document.getElementById(input.getAttribute('aria-activedescendant'))
    expect(active().textContent).toContain('RC111AA')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(active().textContent).toContain('Fișă nouă')
    fireEvent.keyDown(input, { key: 'End' })
    expect(active().textContent).toContain('Scurtături')
    fireEvent.keyDown(input, { key: 'Home' })
    expect(active().textContent).toContain('RC111AA')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(active().textContent).toContain('Scurtături')
    expect(search).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Home' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onNewFisa).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalled()
    expect(screen.getByText('Ctrl+N')).toBeTruthy()
  })

  it('drafturi dupa placuta/client, cu diacritice pliate si <mark>', () => {
    const props = mkProps()
    render(<CommandPalette {...props} onClose={() => {}} />)
    type('stefan')
    expect(document.querySelector('.palette-row-draft mark').textContent).toBe('Ștefan')
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(props.onOpenDraft).toHaveBeenCalledWith('d1')
    expect(highlightRange('Ștefan Popa', 'STEFAN')).toEqual([0, 6])
    expect(highlightRange('abc', 'x')).toBeNull()
  })

  it('maxim 50 de randuri pe grup, cu "+N rezultate" care extinde', async () => {
    const many = Array.from({ length: 60 }, (_, i) => mkFisa(`f${i}.json`, `PL${i}`, 'X'))
    search.mockResolvedValueOnce({ ok: true, data: many })
    render(<CommandPalette {...mkProps()} onClose={() => {}} />)
    type('pl')
    await flush()
    expect(document.querySelectorAll('.palette-row-fisa').length).toBe(50)
    fireEvent.click(screen.getByText('+10 rezultate'))
    expect(document.querySelectorAll('.palette-row-fisa').length).toBe(60)
  })

  it('Escape inchide paleta si readuce focusul pe campul din topbar', () => {
    render(<Topbar {...mkProps()} />)
    const trigger = screen.getByTitle('Caută (Ctrl+K)')
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Caută' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Caută' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
