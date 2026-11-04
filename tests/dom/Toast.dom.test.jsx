// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import ToastStack, { toastDuration } from '../../src/renderer/src/components/Toast'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Toast', () => {
  it('stiva e regiune aria-live si exista si goala', () => {
    const { container } = render(<ToastStack toasts={[]} onClose={() => {}} />)
    expect(container.querySelector('.toast-stack').getAttribute('aria-live')).toBe('polite')
  })

  it('erorile au role=alert si raman (nu se inchid singure)', () => {
    const onClose = vi.fn()
    render(<ToastStack toasts={[{ id: 1, type: 'error', message: 'Gresit' }]} onClose={onClose} />)
    expect(screen.getByRole('alert').textContent).toContain('Gresit')
    act(() => vi.advanceTimersByTime(120000))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('toast obisnuit dispare la 6s; cu actiune la 10s', () => {
    const onClose = vi.fn()
    const { rerender } = render(<ToastStack toasts={[{ id: 1, type: 'success', message: 'ok' }]} onClose={onClose} />)
    act(() => vi.advanceTimersByTime(5900))
    expect(onClose).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(200))
    expect(onClose).toHaveBeenCalledWith(1)

    onClose.mockClear()
    rerender(
      <ToastStack
        toasts={[{ id: 2, type: 'success', message: 'sters', action: { label: 'Anulează', onClick: () => {} } }]}
        onClose={onClose}
      />
    )
    act(() => vi.advanceTimersByTime(9900))
    expect(onClose).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(200))
    expect(onClose).toHaveBeenCalledWith(2)
  })

  it('pauza la hover, reluare cu timpul ramas', () => {
    const onClose = vi.fn()
    render(<ToastStack toasts={[{ id: 1, type: 'info', message: 'salut' }]} onClose={onClose} />)
    const toast = screen.getByText('salut').closest('.toast')
    act(() => vi.advanceTimersByTime(4000))
    fireEvent.mouseEnter(toast)
    act(() => vi.advanceTimersByTime(60000))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseLeave(toast)
    act(() => vi.advanceTimersByTime(1900))
    expect(onClose).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(200))
    expect(onClose).toHaveBeenCalledWith(1)
  })

  it('pauza la focus-within', () => {
    const onClose = vi.fn()
    render(<ToastStack toasts={[{ id: 1, type: 'info', message: 'salut' }]} onClose={onClose} />)
    const btn = screen.getByRole('button', { name: 'Închide notificarea' })
    act(() => btn.focus())
    act(() => vi.advanceTimersByTime(60000))
    expect(onClose).not.toHaveBeenCalled()
    act(() => btn.blur())
    act(() => vi.advanceTimersByTime(6100))
    expect(onClose).toHaveBeenCalledWith(1)
  })

  it('toastDuration: opts.duration si sticky', () => {
    expect(toastDuration({ type: 'info', duration: 2000 })).toBe(2000)
    expect(toastDuration({ type: 'warning', sticky: true })).toBeNull()
    expect(toastDuration({ type: 'error', duration: 3000 })).toBe(3000)
  })
})
