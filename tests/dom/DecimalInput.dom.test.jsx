// @vitest-environment jsdom
import React, { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DecimalInput from '../../src/renderer/src/components/DecimalInput'
import { formatPrice, formatQuantity } from '../../src/shared/calculations'

afterEach(cleanup)

function H({ initial, normalize = formatPrice, spy }) {
  const [v, setV] = useState(initial)
  return (
    <DecimalInput
      aria-label="pret"
      value={v}
      normalize={normalize}
      onChange={(x) => {
        spy?.(x)
        setV(x)
      }}
    />
  )
}

describe('DecimalInput', () => {
  it('focus + blur fara tastare nu schimba valoarea veche si nu apeleaza onChange (pret)', async () => {
    const spy = vi.fn()
    const user = userEvent.setup()
    render(<H initial="48.555" spy={spy} />)
    const el = screen.getByLabelText('pret')
    await user.click(el)
    await user.tab()
    expect(spy).not.toHaveBeenCalled()
    expect(el.value).toBe('48,555')
  })

  it('la fel pentru cantitate', async () => {
    const spy = vi.fn()
    const user = userEvent.setup()
    render(<H initial="2.5000" normalize={formatQuantity} spy={spy} />)
    await user.click(screen.getByLabelText('pret'))
    await user.tab()
    expect(spy).not.toHaveBeenCalled()
  })

  it('dupa tastare, blur normalizeaza; valoarea stocata ramane cu punct', async () => {
    const spy = vi.fn()
    const user = userEvent.setup()
    render(<H initial="0" spy={spy} />)
    const el = screen.getByLabelText('pret')
    await user.click(el)
    await user.keyboard('48,5')
    expect(spy).toHaveBeenLastCalledWith('48,5')
    expect(el.value).toBe('48,5')
    await user.tab()
    expect(spy).toHaveBeenLastCalledWith('48.50')
    expect(el.value).toBe('48,50')
  })

  it('afiseaza virgula pentru numar si string cu punct', () => {
    render(<H initial={2.5} />)
    expect(screen.getByLabelText('pret').value).toBe('2,5')
  })

  it('ignora tastarea peste 12 cifre intregi', () => {
    const spy = vi.fn()
    render(<H initial="" spy={spy} />)
    const el = screen.getByLabelText('pret')
    fireEvent.change(el, { target: { value: '1000000000000' } })
    expect(spy).not.toHaveBeenCalled()
    fireEvent.change(el, { target: { value: '999999999999' } })
    expect(spy).toHaveBeenCalledWith('999999999999')
  })
})
