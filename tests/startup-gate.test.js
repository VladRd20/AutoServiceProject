import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runStartup } from '../src/renderer/src/startup'

// Poarta de vizibilitate trebuie sa se deschida oricum ar merge IPC-urile de pornire.
const never = () => new Promise(() => {})

function setup(overrides = {}) {
  const flags = { initial: false, checked: false }
  const warn = vi.fn()
  const opts = {
    loadInitialDrafts: () => Promise.resolve(),
    refreshRecentFise: () => Promise.resolve(),
    refreshAutocomplete: () => Promise.resolve(),
    checkLocation: () => Promise.resolve(),
    checkFirstRun: () => Promise.resolve(),
    markInitialDone: () => {
      flags.initial = true
    },
    markFirstRunChecked: () => {
      flags.checked = true
    },
    timeoutMs: 1000,
    warn,
    ...overrides
  }
  runStartup(opts)
  return { flags, warn }
}

describe('runStartup (poarta de vizibilitate)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('drum normal: ambele steaguri se deschid fara avertisment', async () => {
    const { flags, warn } = setup()
    await vi.advanceTimersByTimeAsync(0)
    expect(flags).toEqual({ initial: true, checked: true })
    await vi.advanceTimersByTimeAsync(2000)
    expect(warn).not.toHaveBeenCalled()
  })

  it('settings.get() nu raspunde niciodata: timeout-ul deschide poarta', async () => {
    const { flags, warn } = setup({ checkFirstRun: never })
    await vi.advanceTimersByTimeAsync(0)
    expect(flags.checked).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(flags).toEqual({ initial: true, checked: true })
    expect(warn).toHaveBeenCalledOnce()
  })

  it('listDrafts() agatat: timeout-ul deschide poarta', async () => {
    const { flags, warn } = setup({ loadInitialDrafts: never })
    await vi.advanceTimersByTimeAsync(1000)
    expect(flags).toEqual({ initial: true, checked: true })
    expect(warn).toHaveBeenCalledOnce()
  })

  it('exceptie sincrona in refreshRecentFise/refreshAutocomplete/checkLocation nu sare peste checkFirstRun', async () => {
    const boom = () => {
      throw new Error('boom')
    }
    const checkFirstRun = vi.fn(() => Promise.resolve())
    const { flags, warn } = setup({
      refreshRecentFise: boom,
      refreshAutocomplete: boom,
      checkLocation: boom,
      checkFirstRun
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(checkFirstRun).toHaveBeenCalledOnce()
    expect(flags).toEqual({ initial: true, checked: true })
    expect(warn).toHaveBeenCalledTimes(3)
  })

  it('checkFirstRun care arunca sincron: steagul se deschide totusi', async () => {
    const { flags } = setup({
      checkFirstRun: () => {
        throw new Error('ipc lipsa')
      }
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(flags).toEqual({ initial: true, checked: true })
  })

  it('loadInitialDrafts respins: initialCheckDone se seteaza, fara rejectie nemanuita', async () => {
    const { flags } = setup({ loadInitialDrafts: () => Promise.reject(new Error('normalizeFisa')) })
    await vi.advanceTimersByTimeAsync(0)
    expect(flags.initial).toBe(true)
  })

  it('anularea efectului opreste timeout-ul', async () => {
    const flags = { initial: false, checked: false }
    const cancel = runStartup({
      loadInitialDrafts: never,
      refreshRecentFise: never,
      refreshAutocomplete: never,
      checkLocation: never,
      checkFirstRun: never,
      markInitialDone: () => {
        flags.initial = true
      },
      markFirstRunChecked: () => {
        flags.checked = true
      },
      timeoutMs: 500,
      warn: () => {}
    })
    cancel()
    await vi.advanceTimersByTimeAsync(2000)
    expect(flags).toEqual({ initial: false, checked: false })
  })
})
