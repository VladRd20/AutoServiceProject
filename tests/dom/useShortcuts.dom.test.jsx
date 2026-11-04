// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import useShortcuts, { closeShortcutsHelp } from '../../src/renderer/src/hooks/useShortcuts'
import ShortcutsOverlay from '../../src/renderer/src/components/ShortcutsOverlay'

afterEach(() => {
  act(() => closeShortcutsHelp())
  cleanup()
})

function mk(over = {}) {
  const h = {
    autosaver: { flush: vi.fn().mockResolvedValue(true) },
    showToast: vi.fn(),
    onRelease: vi.fn(),
    onPreview: vi.fn(),
    onNewFisa: vi.fn(),
    searchInputRef: { current: null },
    releasingRef: { current: false },
    modalOpen: false,
    readOnly: false,
    ...over
  }
  function C() {
    useShortcuts(h)
    return (
      <div>
        <input aria-label="camp" ref={h.searchInputRef} />
        <ShortcutsOverlay />
      </div>
    )
  }
  return { h, C }
}

const key = (k, extra = {}) => {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra })
  act(() => {
    document.body.dispatchEvent(ev)
  })
  return ev
}

describe('useShortcuts', () => {
  it('Ctrl+S: flush + toast "Salvat"', async () => {
    const { h, C } = mk()
    render(<C />)
    const ev = key('s', { ctrlKey: true })
    expect(ev.defaultPrevented).toBe(true)
    await act(async () => {})
    expect(h.autosaver.flush).toHaveBeenCalledTimes(1)
    expect(h.showToast).toHaveBeenCalledWith('success', 'Salvat', null, expect.any(Object))
  })

  it('Ctrl+Enter finalizeaza, Ctrl+P previzualizeaza, Ctrl+N fisa noua, Ctrl+K cauta', () => {
    const { h, C } = mk()
    render(<C />)
    key('Enter', { ctrlKey: true })
    expect(h.onRelease).toHaveBeenCalledTimes(1)
    key('p', { ctrlKey: true })
    expect(h.onPreview).toHaveBeenCalledTimes(1)
    key('n', { ctrlKey: true })
    expect(h.onNewFisa).toHaveBeenCalledTimes(1)
    key('k', { ctrlKey: true })
    expect(document.activeElement).toBe(screen.getByLabelText('camp'))
  })

  it('Ctrl+P face preventDefault (nu se deschide print-ul Chromium), chiar si blocat', () => {
    const { h, C } = mk({ modalOpen: true })
    render(<C />)
    const ev = key('p', { ctrlKey: true })
    expect(ev.defaultPrevented).toBe(true)
    expect(h.onPreview).not.toHaveBeenCalled()
  })

  it('dezactivate cat timp un modal e deschis', async () => {
    const { h, C } = mk({ modalOpen: true })
    render(<C />)
    key('s', { ctrlKey: true })
    key('Enter', { ctrlKey: true })
    key('n', { ctrlKey: true })
    key('?', { shiftKey: true })
    await act(async () => {})
    expect(h.autosaver.flush).not.toHaveBeenCalled()
    expect(h.onRelease).not.toHaveBeenCalled()
    expect(h.onNewFisa).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('dezactivate cat se finalizeaza; read-only blocheaza S/Enter/P', async () => {
    const a = mk()
    a.h.releasingRef.current = true
    render(<a.C />)
    key('Enter', { ctrlKey: true })
    expect(a.h.onRelease).not.toHaveBeenCalled()
    cleanup()
    const b = mk({ readOnly: true })
    render(<b.C />)
    key('Enter', { ctrlKey: true })
    key('p', { ctrlKey: true })
    key('s', { ctrlKey: true })
    await act(async () => {})
    expect(b.h.onRelease).not.toHaveBeenCalled()
    expect(b.h.onPreview).not.toHaveBeenCalled()
    expect(b.h.autosaver.flush).not.toHaveBeenCalled()
  })

  it('"?" deschide overlay-ul cu toate scurtaturile; nu cand se tasteaza intr-un camp', () => {
    const { h, C } = mk()
    render(<C />)
    const input = screen.getByLabelText('camp')
    fireEvent.keyDown(input, { key: '?', shiftKey: true })
    expect(screen.queryByRole('dialog')).toBeNull()
    key('?', { shiftKey: true })
    const dlg = screen.getByRole('dialog', { name: 'Scurtături de tastatură' })
    for (const k of ['Ctrl+K', 'Ctrl+N', 'Ctrl+S', 'Ctrl+Enter', 'Ctrl+P', '?']) {
      expect(dlg.textContent).toContain(k)
    }
    // cat timp overlay-ul e deschis, scurtaturile sunt dezactivate; Escape il inchide
    key('Enter', { ctrlKey: true })
    expect(h.onRelease).not.toHaveBeenCalled()
    key('Escape')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('tasta tinuta (repeat): Ctrl+Enter / Ctrl+S / Ctrl+P actioneaza o singura data', async () => {
    const { h, C } = mk()
    render(<C />)
    key('Enter', { ctrlKey: true })
    for (let i = 0; i < 5; i++) key('Enter', { ctrlKey: true, repeat: true })
    key('p', { ctrlKey: true })
    for (let i = 0; i < 5; i++) key('p', { ctrlKey: true, repeat: true })
    for (let i = 0; i < 5; i++) key('s', { ctrlKey: true, repeat: true })
    await act(async () => {})
    expect(h.onRelease).toHaveBeenCalledTimes(1)
    expect(h.onPreview).toHaveBeenCalledTimes(1)
    expect(h.autosaver.flush).not.toHaveBeenCalled()
  })

  it('compunere IME ignorata', () => {
    const { h, C } = mk()
    render(<C />)
    key('Enter', { ctrlKey: true, isComposing: true })
    key('Enter', { ctrlKey: true, keyCode: 229 })
    expect(h.onRelease).not.toHaveBeenCalled()
  })

  it('Ctrl+Enter ignorat cand tinta are aria-expanded="true" (Autocomplete deschis)', () => {
    const { h, C } = mk()
    render(<C />)
    const input = screen.getByLabelText('camp')
    const fire = () =>
      act(() => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }))
      })
    input.setAttribute('aria-expanded', 'true')
    fire()
    expect(h.onRelease).not.toHaveBeenCalled()
    input.setAttribute('aria-expanded', 'false')
    fire()
    expect(h.onRelease).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+P nu porneste a doua previzualizare cat timp prima e in curs', async () => {
    let done
    const onPreview = vi.fn(() => new Promise((r) => (done = r)))
    const { h, C } = mk({ onPreview })
    render(<C />)
    key('p', { ctrlKey: true })
    key('p', { ctrlKey: true })
    expect(h.onPreview).toHaveBeenCalledTimes(1)
    await act(async () => done())
    key('p', { ctrlKey: true })
    expect(h.onPreview).toHaveBeenCalledTimes(2)
  })
})
