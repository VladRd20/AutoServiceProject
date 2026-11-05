// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import useFirstRun from '../../src/renderer/src/hooks/useFirstRun'

const ENTRIES = [{ version: '0.9.3', items: ['ceva nou'] }]

function deferred() {
  let resolve
  const promise = new Promise((r) => (resolve = r))
  return { promise, resolve }
}

function mockApi({ numeService = 'Service X', whatsNew } = {}) {
  window.serviceAuto = {
    settings: { get: vi.fn().mockResolvedValue({ ok: true, data: { numeService } }) },
    app: {
      getWhatsNew: vi.fn(() => whatsNew ?? Promise.resolve({ ok: true, data: { entries: ENTRIES } })),
      markWhatsNewSeen: vi.fn().mockResolvedValue({ ok: true })
    }
  }
}

beforeEach(() => {
  try {
    window.localStorage.clear()
  } catch {
    // localStorage indisponibil in mediul de test - lsGet intoarce oricum null
  }
})
afterEach(() => {
  cleanup()
  delete window.serviceAuto
})

describe('useFirstRun - "Ce e nou" decis inainte de afisare', () => {
  it('aduce intrarile in timpul pornirii si le arata odata cu interfata', async () => {
    mockApi()
    const { result, rerender } = renderHook((p) => useFirstRun(p), { initialProps: { initialCheckDone: false } })
    await act(() => result.current.checkFirstRun())
    expect(window.serviceAuto.app.getWhatsNew).toHaveBeenCalledWith('unseen')
    expect(result.current.whatsNew).toBeNull() // drafturile inca nu sunt gata -> interfata ascunsa

    rerender({ initialCheckDone: true })
    // Apare in acelasi commit in care se deschide poarta, fara un IPC nou dupa afisare.
    expect(result.current.whatsNew).toEqual({ entries: ENTRIES, markSeen: true })
    expect(window.serviceAuto.app.getWhatsNew).toHaveBeenCalledTimes(1)
  })

  it('daca poarta s-a deschis pe timeout, un raspuns tarziu NU mai deschide modalul', async () => {
    const late = deferred()
    mockApi({ whatsNew: late.promise })
    const { result } = renderHook((p) => useFirstRun(p), { initialProps: { initialCheckDone: true } })
    let checked
    act(() => {
      checked = result.current.checkFirstRun()
    })
    act(() => result.current.markFirstRunChecked()) // timeout-ul din startup.js
    expect(result.current.firstRunChecked).toBe(true)

    await act(async () => {
      late.resolve({ ok: true, data: { entries: ENTRIES } })
      await checked
    })
    expect(result.current.whatsNew).toBeNull()
    expect(window.serviceAuto.app.markWhatsNewSeen).not.toHaveBeenCalled() // ramane nevazut pt. data viitoare
  })

  it('dupa prima configurare nu arata "Ce e nou", doar il marcheaza vazut', async () => {
    mockApi({ numeService: '' })
    const { result } = renderHook((p) => useFirstRun(p), { initialProps: { initialCheckDone: true } })
    await act(() => result.current.checkFirstRun())
    expect(result.current.firstRunOpen).toBe(true)
    expect(result.current.whatsNew).toBeNull()

    act(() => result.current.closeFirstRun())
    expect(result.current.whatsNew).toBeNull()
    expect(window.serviceAuto.app.markWhatsNewSeen).toHaveBeenCalledTimes(1)
  })

  it('fara intrari nevazute nu deschide nimic; un IPC esuat nu blocheaza poarta', async () => {
    mockApi({ whatsNew: Promise.reject(new Error('ipc')) })
    const { result } = renderHook((p) => useFirstRun(p), { initialProps: { initialCheckDone: true } })
    await act(() => result.current.checkFirstRun())
    expect(result.current.firstRunChecked).toBe(true)
    expect(result.current.whatsNew).toBeNull()
  })
})
