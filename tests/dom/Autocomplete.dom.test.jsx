// @vitest-environment jsdom
import React, { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Autocomplete from '../../src/renderer/src/components/Autocomplete'

afterEach(cleanup)

const OPTIONS = ['Dacia', 'Daewoo', 'Daihatsu', 'Audi', 'BMW']

function Harness({ options = OPTIONS, initial = '' }) {
  const [v, setV] = useState(initial)
  return (
    <div>
      <Autocomplete value={v} onChange={setV} options={options} aria-describedby="err" />
      <button>dupa</button>
    </div>
  )
}

describe('Autocomplete (combobox)', () => {
  it('expune atributele ARIA de combobox/listbox/option', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const cb = screen.getByRole('combobox')
    expect(cb.getAttribute('aria-autocomplete')).toBe('list')
    expect(cb.getAttribute('aria-expanded')).toBe('false')
    expect(cb.getAttribute('aria-describedby')).toBe('err')
    await user.click(cb)
    expect(cb.getAttribute('aria-expanded')).toBe('true')
    const list = screen.getByRole('listbox')
    expect(cb.getAttribute('aria-controls')).toBe(list.id)
    expect(screen.getAllByRole('option')).toHaveLength(5)
    await user.keyboard('{ArrowDown}')
    const opts = screen.getAllByRole('option')
    expect(opts[0].getAttribute('aria-selected')).toBe('true')
    expect(opts[1].getAttribute('aria-selected')).toBe('false')
    expect(cb.getAttribute('aria-activedescendant')).toBe(opts[0].id)
  })

  it('Escape inchide lista fara sa goleasca inputul; ArrowDown o redeschide', async () => {
    const user = userEvent.setup()
    render(<Harness initial="Da" />)
    const cb = screen.getByRole('combobox')
    await user.click(cb)
    expect(screen.getByRole('listbox')).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(cb.value).toBe('Da')
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(cb.getAttribute('aria-activedescendant')).toBeTruthy()
  })

  it('Enter accepta elementul evidentiat', async () => {
    const user = userEvent.setup()
    render(<Harness initial="da" />)
    const cb = screen.getByRole('combobox')
    await user.click(cb)
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(cb.value).toBe('Daewoo')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('Tab accepta elementul evidentiat si muta focusul normal', async () => {
    const user = userEvent.setup()
    render(<Harness initial="da" />)
    const cb = screen.getByRole('combobox')
    await user.click(cb)
    await user.keyboard('{ArrowDown}{Tab}')
    expect(cb.value).toBe('Dacia')
    expect(document.activeElement).toBe(screen.getByText('dupa'))
  })

  it('Tab fara selectie nu schimba valoarea', async () => {
    const user = userEvent.setup()
    render(<Harness initial="da" />)
    const cb = screen.getByRole('combobox')
    await user.click(cb)
    await user.keyboard('{Tab}')
    expect(cb.value).toBe('da')
  })

  it('afiseaza "+N rezultate" cand lista e limitata la 8', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 11 }, (_, i) => `Piesa ${i}`)
    render(<Harness options={many} />)
    await user.click(screen.getByRole('combobox'))
    expect(screen.getAllByRole('option')).toHaveLength(8)
    expect(screen.getByText('+3 rezultate')).toBeTruthy()
  })
})
