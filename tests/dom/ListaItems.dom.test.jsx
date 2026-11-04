// @vitest-environment jsdom
import React, { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import ListaItems from '../../src/renderer/src/components/ListaItems'
import ThemeToggle from '../../src/renderer/src/components/ThemeToggle'
import { getDensity, setDensity } from '../../src/renderer/src/theme'

const mk = (id, denumire, pret = 0) => ({ id, denumire, cod: '', cantitate: 1, pretUnitar: pret })

let latest
function Harness({ initial, showToast, errors }) {
  const [items, setItems] = useState(initial)
  latest = items
  return (
    <ListaItems
      titlu="Piese"
      singular="piesă"
      items={items}
      onChange={setItems}
      priceKey="pretUnitar"
      codKey="cod"
      priceLabel="Preț unitar"
      errorPrefix="piese"
      errors={errors || {}}
      suggestions={[]}
      showToast={showToast}
      resetKey="f1"
    />
  )
}

const rows = (c) => c.querySelectorAll('.linie:not(.linie-head)')
const nameInputs = () => screen.getAllByPlaceholderText('Denumire')

beforeEach(() => {
  let n = 0
  vi.stubGlobal('crypto', { randomUUID: () => `new-${++n}` })
  // jsdom din acest setup nu expune localStorage: o implementare minima in memorie.
  const store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  })
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-density')
})

describe('ListaItems: tastatura', () => {
  it('Enter trece pe primul camp al randului urmator; pe ultimul adauga un rand', () => {
    const { container } = render(<Harness initial={[mk('a', 'Filtru'), mk('b', 'Ulei')]} />)
    fireEvent.keyDown(nameInputs()[0], { key: 'Enter' })
    expect(document.activeElement).toBe(nameInputs()[1])
    fireEvent.keyDown(nameInputs()[1], { key: 'Enter' })
    expect(rows(container).length).toBe(3)
    expect(document.activeElement).toBe(nameInputs()[2])
  })

  it('Ctrl+D dubleaza randul curent (cu id nou) imediat dupa el', () => {
    render(<Harness initial={[mk('a', 'Filtru', 10), mk('b', 'Ulei')]} />)
    fireEvent.keyDown(nameInputs()[0], { key: 'd', ctrlKey: true })
    expect(latest.map((i) => i.denumire)).toEqual(['Filtru', 'Filtru', 'Ulei'])
    expect(latest[1].id).not.toBe('a')
    expect(latest[1].pretUnitar).toBe(10)
  })

  it('Alt+sageti muta randul si pastreaza focusul pe el', () => {
    render(<Harness initial={[mk('a', 'A'), mk('b', 'B'), mk('c', 'C')]} />)
    fireEvent.keyDown(nameInputs()[0], { key: 'ArrowDown', altKey: true })
    expect(latest.map((i) => i.denumire)).toEqual(['B', 'A', 'C'])
    expect(document.activeElement).toBe(nameInputs()[1])
    fireEvent.keyDown(nameInputs()[1], { key: 'ArrowUp', altKey: true })
    expect(latest.map((i) => i.denumire)).toEqual(['A', 'B', 'C'])
  })

  it('Ctrl+Backspace sterge doar un rand gol', () => {
    render(<Harness initial={[mk('a', 'A'), mk('b', '')]} />)
    fireEvent.keyDown(nameInputs()[0], { key: 'Backspace', ctrlKey: true })
    expect(latest.length).toBe(2)
    fireEvent.keyDown(nameInputs()[1], { key: 'Backspace', ctrlKey: true })
    expect(latest.map((i) => i.id)).toEqual(['a'])
    expect(document.activeElement).toBe(nameInputs()[0])
  })
})

describe('ListaItems: stergere cu anulare', () => {
  it('un rand cu continut se sterge instant si "Anulează" il readuce la locul lui', () => {
    const showToast = vi.fn()
    render(<Harness initial={[mk('a', 'A'), mk('b', 'B'), mk('c', 'C')]} showToast={showToast} />)
    fireEvent.click(screen.getAllByLabelText('Șterge linia')[1])
    expect(latest.map((i) => i.id)).toEqual(['a', 'c'])
    const [type, message, action, opts] = showToast.mock.calls[0]
    expect(type).toBe('success')
    expect(message).toContain('B')
    expect(action.label).toBe('Anulează')
    expect(opts.duration).toBe(8000)
    act(() => action.onClick())
    expect(latest.map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('un rand gol se sterge fara toast', () => {
    const showToast = vi.fn()
    render(<Harness initial={[mk('a', '')]} showToast={showToast} />)
    fireEvent.click(screen.getByLabelText('Șterge linia'))
    expect(latest).toEqual([])
    expect(showToast).not.toHaveBeenCalled()
  })
})

describe('ListaItems: campuri numerice', () => {
  it('la blur pretul devine cu 2 zecimale, iar cantitatea fara zerouri finale', () => {
    render(<Harness initial={[mk('a', 'A')]} />)
    const qty = screen.getByLabelText('Cantitate')
    const price = screen.getByLabelText('Preț unitar')
    fireEvent.change(price, { target: { value: '12,5' } })
    expect(latest[0].pretUnitar).toBe('12,5')
    fireEvent.blur(price)
    expect(latest[0].pretUnitar).toBe('12.50')
    fireEvent.change(qty, { target: { value: '2,500' } })
    fireEvent.blur(qty)
    expect(latest[0].cantitate).toBe('2.5')
  })

  it('campurile cu eroare primesc aria-invalid si aria-describedby', () => {
    render(<Harness initial={[mk('a', 'A')]} errors={{ 'piese.0.cantitate': 'Cantitate invalidă' }} />)
    const qty = screen.getByLabelText('Cantitate')
    expect(qty.getAttribute('aria-invalid')).toBe('true')
    const id = qty.getAttribute('aria-describedby')
    expect(document.getElementById(id).textContent).toBe('Cantitate invalidă')
  })
})

describe('ThemeToggle / densitate', () => {
  it('cicleaza luminoasa -> intunecata -> sistem', () => {
    render(<ThemeToggle />)
    const btn = screen.getByRole('button')
    expect(btn.getAttribute('aria-label')).toBe('Temă: sistem')
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-label')).toBe('Temă: luminoasă')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-label')).toBe('Temă: întunecată')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-label')).toBe('Temă: sistem')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(localStorage.getItem('service-auto-theme')).toBeNull()
  })

  it('densitatea se salveaza si se aplica pe <html>', () => {
    expect(getDensity()).toBe('compact')
    setDensity('comfortable')
    expect(getDensity()).toBe('comfortable')
    expect(document.documentElement.getAttribute('data-density')).toBe('comfortable')
    setDensity('compact')
    expect(document.documentElement.hasAttribute('data-density')).toBe(false)
  })
})
