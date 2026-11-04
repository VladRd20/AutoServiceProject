// @vitest-environment jsdom
import React, { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Modal from '../../src/renderer/src/components/Modal'
import ConfirmDialog from '../../src/renderer/src/components/ConfirmDialog'

afterEach(cleanup)

function Harness({ onClose = () => {} }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(true)}>Deschide</button>
      {open && (
        <Modal
          title="Titlu"
          onClose={() => {
            onClose()
            setOpen(false)
          }}
        >
          <input aria-label="primul" />
          <button>ultimul</button>
        </Modal>
      )}
    </div>
  )
}

describe('useDialog / Modal', () => {
  it('seteaza role, aria-modal si aria-labelledby', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('Deschide'))
    const dlg = screen.getByRole('dialog', { name: 'Titlu' })
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByRole('button', { name: 'Închide' })).toBeTruthy()
  })

  it('capcana de focus: Tab si Shift+Tab fac ocolul', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('Deschide'))
    const close = screen.getByRole('button', { name: 'Închide' })
    const last = screen.getByText('ultimul')
    last.focus()
    await user.tab()
    expect(document.activeElement).toBe(close)
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(last)
  })

  it('Escape inchide si focusul revine pe buton', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    const opener = screen.getByText('Deschide')
    await user.click(opener)
    expect(document.activeElement).not.toBe(opener)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('dialoguri suprapuse: Escape inchide doar cel din varf', async () => {
    const user = userEvent.setup()
    const onResult = vi.fn()
    const onClose = vi.fn()
    render(
      <div>
        <Modal title="Baza" onClose={onClose}>
          <button>din modal</button>
        </Modal>
        <ConfirmDialog state={{ message: 'Sigur?', danger: true }} onResult={onResult} />
      </div>
    )
    // ConfirmDialog e montat al doilea => e in varf; focus pe Anuleaza (actiune sigura)
    expect(document.activeElement).toBe(screen.getByText('Anulează'))
    await user.keyboard('{Escape}')
    expect(onResult).toHaveBeenCalledWith(false)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('ConfirmDialog nedistructiv: focus pe actiunea principala', () => {
    render(<ConfirmDialog state={{ message: 'Continui?', danger: false, confirmLabel: 'Da' }} onResult={() => {}} />)
    expect(document.activeElement).toBe(screen.getByText('Da'))
    expect(screen.getByRole('alertdialog')).toBeTruthy()
  })
})

describe('useDialog - focus cand openerul a disparut', () => {
  function Gone({ withHome }) {
    const [open, setOpen] = useState(false)
    const [btn, setBtn] = useState(true)
    return (
      <div>
        <div className="form-columns">
          <input aria-label="primul" />
        </div>
        {withHome && <button data-focus-home>acasa</button>}
        {btn && <button onClick={() => setOpen(true)}>Deschide</button>}
        {open && (
          <Modal
            title="T"
            onClose={() => {
              setBtn(false)
              setOpen(false)
            }}
          >
            <p>x</p>
          </Modal>
        )}
      </div>
    )
  }
  it('cade pe [data-focus-home]', async () => {
    const user = userEvent.setup()
    render(<Gone withHome />)
    await user.click(screen.getByText('Deschide'))
    await user.keyboard('{Escape}')
    expect(document.activeElement).toBe(screen.getByText('acasa'))
  })
  it('fara data-focus-home cade pe primul camp al formularului', async () => {
    const user = userEvent.setup()
    render(<Gone />)
    await user.click(screen.getByText('Deschide'))
    await user.keyboard('{Escape}')
    expect(document.activeElement).toBe(screen.getByLabelText('primul'))
  })
})
