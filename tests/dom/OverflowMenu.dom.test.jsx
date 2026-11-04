// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OverflowMenu from '../../src/renderer/src/components/OverflowMenu'

afterEach(cleanup)

function setup() {
  const a = vi.fn()
  const items = [
    { label: 'Unu', onClick: a },
    { label: 'Doi', onClick: () => {} },
    { label: 'Dezactivat', disabled: true, onClick: () => {} },
    { label: 'Trei', onClick: () => {} }
  ]
  render(
    <div>
      <OverflowMenu items={items} />
      <button>urmator</button>
    </div>
  )
  return { a, btn: screen.getByRole('button', { name: 'Mai multe acțiuni' }) }
}

describe('OverflowMenu', () => {
  it('atribute ARIA si focus pe primul item la deschidere', async () => {
    const user = userEvent.setup()
    const { btn } = setup()
    expect(btn.getAttribute('aria-haspopup')).toBe('menu')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    await user.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(4)
    expect(document.activeElement).toBe(items[0])
    expect(screen.getAllByRole('none').length).toBe(4)
  })

  it('roving tabindex: sageti, Home, End, sare peste itemii dezactivati', async () => {
    const user = userEvent.setup()
    const { btn } = setup()
    await user.click(btn)
    const [unu, doi, , trei] = screen.getAllByRole('menuitem')
    expect(unu.tabIndex).toBe(0)
    expect(doi.tabIndex).toBe(-1)
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(doi)
    expect(doi.tabIndex).toBe(0)
    expect(unu.tabIndex).toBe(-1)
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(trei)
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(unu)
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(trei)
    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(unu)
    await user.keyboard('{End}')
    expect(document.activeElement).toBe(trei)
  })

  it('Escape inchide si readuce focusul pe buton', async () => {
    const user = userEvent.setup()
    const { btn } = setup()
    await user.click(btn)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(btn)
  })

  it('Tab inchide meniul; focusul e deja pe buton, deci Tab-ul nativ continua de acolo', async () => {
    const user = userEvent.setup()
    const { btn } = setup()
    await user.click(btn)
    // fireEvent nu simuleaza actiunea implicita a lui Tab (user-event o calculeaza
    // fata de itemul detasat); aici verificam doar ce lasa handlerul in urma.
    fireEvent.keyDown(document.activeElement, { key: 'Tab' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('false')
  })

  it('Enter activeaza itemul si inchide meniul', async () => {
    const user = userEvent.setup()
    const { btn, a } = setup()
    await user.click(btn)
    await user.keyboard('{Enter}')
    expect(a).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('ArrowDown pe buton deschide meniul', async () => {
    const user = userEvent.setup()
    const { btn } = setup()
    btn.focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menu')).toBeTruthy()
  })
})
