import React, { useCallback, useEffect, useRef } from 'react'

const DEFAULT_MS = 6000
// Un toast cu buton de actiune ("Anulează", "Printează") trebuie sa ramana
// destul cat sa poata fi citit si apasat, inclusiv cu tastatura.
const ACTION_MS = 10000

// Durata de auto-inchidere in ms, sau null = ramane pana e inchis manual.
// Erorile raman pana sunt inchise (se pierd usor, iar uneori inseamna ca ceva
// NU s-a salvat); `duration` explicit are prioritate fata de regulile implicite.
export function toastDuration(toast) {
  if (typeof toast.duration === 'number') return toast.duration
  if (toast.sticky || toast.type === 'error') return null
  return toast.action ? ACTION_MS : DEFAULT_MS
}

function ToastItem({ toast, onClose }) {
  const duration = toastDuration(toast)
  const timerRef = useRef(null)
  // Timpul ramas se pastreaza intre pauze (hover / focus-within) - la reluare
  // continuam de unde ramasesem, nu de la zero.
  const remainingRef = useRef(duration)
  const startedRef = useRef(0)

  const stop = useCallback(() => {
    if (timerRef.current == null) return
    clearTimeout(timerRef.current)
    timerRef.current = null
    remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedRef.current))
  }, [])

  const start = useCallback(() => {
    if (remainingRef.current == null || timerRef.current != null) return
    startedRef.current = Date.now()
    timerRef.current = setTimeout(() => onClose(toast.id), remainingRef.current)
  }, [onClose, toast.id])

  // Efectul depinde doar de id/durata (nu de `toast` intreg si nici de o
  // functie inline creata la fiecare randare a ToastStack) - altfel orice
  // re-randare a parintelui (App.jsx se re-randeaza la fiecare tasta) rearma
  // timer-ul de la zero, si un toast nu mai dispare singur cat timp
  // utilizatorul continua sa interactioneze cu aplicatia.
  useEffect(() => {
    remainingRef.current = duration
    start()
    return () => {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [duration, start])

  return (
    <div
      className={`toast toast-${toast.type}`}
      role={toast.type === 'error' ? 'alert' : undefined}
      onMouseEnter={stop}
      onMouseLeave={start}
      onFocus={stop}
      onBlur={(e) => {
        // focus-within: reluam doar cand focusul iese complet din toast.
        if (!e.currentTarget.contains(e.relatedTarget)) start()
      }}
    >
      <span>{toast.message}</span>
      {toast.action && (
        <button type="button" onClick={toast.action.onClick}>
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        className="toast-close"
        onClick={() => onClose(toast.id)}
        title="Închide notificarea"
        aria-label="Închide notificarea"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  )
}

// Cateva toasturi pot fi declansate la cateva secunde distanta (ex: autosave
// esuat, urmat de finalizarea fisei) - le stivuim in loc sa le inlocuim
// intr-un singur slot. Cu un slot unic, un mesaj important (autosave esuat
// inseamna ca editarile NU s-au salvat) putea disparea neobservat, inlocuit
// de urmatorul toast aparut in fereastra de 6s, inainte ca utilizatorul sa
// apuce sa-l citeasca.
// Containerul exista mereu in DOM: o regiune aria-live trebuie sa fie deja
// prezenta cand i se adauga continut, altfel anuntul nu se citeste.
export default function ToastStack({ toasts, onClose }) {
  return (
    <div className="toast-stack" aria-live="polite" aria-relevant="additions">
      {(toasts || []).map((t) => (
        <ToastItem key={t.id} toast={t} onClose={onClose} />
      ))}
    </div>
  )
}
