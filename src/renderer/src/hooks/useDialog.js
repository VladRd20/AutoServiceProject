import { useEffect, useId, useRef } from 'react'

// Comportament comun pentru dialoguri (Modal, ConfirmDialog, ShortcutsOverlay):
//  - atribute ARIA (role, aria-modal, aria-labelledby) prin `dialogProps`;
//  - focus initial (implicit pe containerul dialogului, ca Escape sa functioneze
//    imediat), capcana de focus pe Tab / Shift+Tab, Escape pe document;
//  - la inchidere, focusul revine pe elementul care a deschis dialogul.
// Dialoguri suprapuse (ex: ConfirmDialog peste SettingsModal): stiva de mai jos
// face ca doar cel din varf sa reactioneze la Escape / Tab.
const stack = []

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Primul camp din formularul principal (FisaForm nu e in lista fisierelor editabile
// aici, deci nu are data-focus-home; folosim selectorul).
const FORM_FIRST_INPUT = '.form-columns input:not([disabled]):not([type="hidden"])'

function getFocusable(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE)).filter((el) => !el.hidden && !el.closest('[hidden]'))
}

/**
 * @param ref           ref catre containerul dialogului
 * @param onClose       apelat la Escape
 * @param initialFocus  'container' (implicit) | selector CSS | () => Element | false
 * @param role          'dialog' (implicit) sau 'alertdialog'
 */
export default function useDialog(ref, { onClose, initialFocus = 'container', role = 'dialog' } = {}) {
  const titleId = useId()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const initialFocusRef = useRef(initialFocus)
  initialFocusRef.current = initialFocus

  useEffect(() => {
    const container = ref.current
    const token = {}
    stack.push(token)
    const opener = document.activeElement

    if (container && initialFocusRef.current !== false) {
      const f = initialFocusRef.current
      let target = null
      if (typeof f === 'function') target = f()
      else if (typeof f === 'string' && f !== 'container') target = container.querySelector(f)
      ;(target || container).focus?.()
    }

    function onKeyDown(e) {
      if (stack[stack.length - 1] !== token) return
      if (e.key === 'Escape') {
        // Un copil (ex: lista Autocomplete) care a tratat deja Escape nu inchide dialogul.
        if (e.defaultPrevented) return
        e.preventDefault()
        onCloseRef.current?.()
        return
      }
      if (e.key !== 'Tab' || !container) return
      const items = getFocusable(container)
      if (items.length === 0) {
        e.preventDefault()
        container.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!container.contains(active) || active === container) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      } else if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      const i = stack.indexOf(token)
      if (i >= 0) stack.splice(i, 1)
      if (!opener || opener === document.body) return
      if (opener.isConnected) {
        opener.focus?.()
        return
      }
      // Openerul a disparut din DOM (ex: randul/butonul care a deschis dialogul):
      // focusul nu ramane in aer - mergem la [data-focus-home], altfel la primul
      // camp al formularului principal (Nume client, in .form-columns din FisaForm).
      const home =
        document.querySelector('[data-focus-home]') ||
        document.querySelector(FORM_FIRST_INPUT)
      home?.focus?.()
    }
  }, [ref])

  return {
    titleId,
    dialogProps: {
      role,
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      tabIndex: -1
    }
  }
}
