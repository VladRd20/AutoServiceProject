import React, { useEffect } from 'react'

function ToastItem({ toast, onClose }) {
  // Efectul depinde doar de id/sticky (nu de `toast` intreg si nici de o
  // functie inline creata la fiecare randare a ToastStack) - altfel orice
  // re-randare a parintelui (App.jsx se re-randeaza la fiecare tasta) rearma
  // timer-ul de 6s de la zero, si un toast nesticky nu mai dispare singur
  // cat timp utilizatorul continua sa interactioneze cu aplicatia.
  useEffect(() => {
    if (toast.sticky) return undefined
    const t = setTimeout(() => onClose(toast.id), 6000)
    return () => clearTimeout(t)
  }, [toast.id, toast.sticky, onClose])

  return (
    <div className={`toast toast-${toast.type}`}>
      <span>{toast.message}</span>
      {toast.action && (
        <button type="button" onClick={toast.action.onClick}>
          {toast.action.label}
        </button>
      )}
      <button type="button" className="toast-close" onClick={() => onClose(toast.id)}>
        ✕
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
export default function ToastStack({ toasts, onClose }) {
  if (!toasts?.length) return null
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onClose={onClose} />
      ))}
    </div>
  )
}
