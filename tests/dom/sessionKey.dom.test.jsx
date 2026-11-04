// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

// createAutosaver inlocuit: captam optiunile (onId) si expunem un reset simplu.
let opts
vi.mock('../../src/renderer/src/autosave', () => ({
  createAutosaver: (o) => {
    opts = o
    return { reset: vi.fn(), update: vi.fn(), flush: vi.fn().mockResolvedValue(true), isDirty: () => false, getId: () => null }
  }
}))

import useFisaEditor from '../../src/renderer/src/hooks/useFisaEditor'

afterEach(cleanup)

function setup() {
  window.serviceAuto = { app: { onFlushRequest: () => () => {}, flushDone: () => {} } }
  const out = {}
  function C() {
    Object.assign(out, useFisaEditor({ readOnly: false, showToast: () => {}, initialCheckDone: false }))
    return null
  }
  render(<C />)
  return out
}

describe('sessionKey (useFisaEditor)', () => {
  it('ramane la fel cand aceeasi fisa primeste id de la autosave', () => {
    const ed = setup()
    const before = ed.sessionKey
    act(() => opts.onId('draft-1'))
    expect(ed.fisa.id).toBe('draft-1')
    expect(ed.sessionKey).toBe(before)
  })

  it('se schimba la fisa noua / deschiderea alteia, chiar daca ambele au id null', () => {
    const ed = setup()
    const k0 = ed.sessionKey
    act(() => ed.resetToNewFisa())
    const k1 = ed.sessionKey
    expect(ed.fisa.id).toBeNull()
    expect(k1).not.toBe(k0)
    act(() => ed.resetToNewFisa())
    expect(ed.sessionKey).not.toBe(k1)
    // orice autosaver.reset (deschidere draft, finalizare) schimba sesiunea
    const k2 = ed.sessionKey
    act(() => ed.autosaver.reset({ id: 'x' }))
    expect(ed.sessionKey).not.toBe(k2)
  })
})
