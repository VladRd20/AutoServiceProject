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

function getFocusable(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE)).filter((el) => !el.hidden && !el.closest('[hidden]'))
}

/**
 * @param ref           ref catre containerul dialogului
 * @param onClose       apelat la Escape
 * @param initialFocus  'container' (implicit) | selector CSS | () => Element | false
 * @param trap          false = fara capcana de focus si fara mutarea/restaurarea focusului
 *                      (cazul Modal autoFocus=false: SearchModal pastreaza focusul in input)
 * @param role          'dialog' (implicit) sau 'alertdialog'
 */
export default function useDialog(ref, { onClose, initialFocus = 'container', trap = true, role = 'dialog' } = {}) {
  const titleId = useId()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const initialFocusRef = useRef(initialFocus)
  initialFocusRef.current = initialFocus

  useEffect(() => {
    const container = ref.current
    const token = {}
    stack.push(token)
    const opener = trap ? document.activeElement : null

    if (container && trap && initialFocusRef.current !== false) {
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
      if (e.key !== 'Tab' || !trap || !container) return
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
      if (opener && opener !== document.body && opener.isConnected) opener.focus?.()
    }
  }, [ref, trap])

  return {
    titleId,
    dialogProps: {
      role,
      'aria-modal': trap ? 'true' : undefined,
      'aria-labelledby': titleId,
      tabIndex: -1
    }
  }
}
