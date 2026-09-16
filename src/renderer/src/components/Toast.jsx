import React, { useEffect } from 'react'

export default function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast || toast.sticky) return undefined
    const t = setTimeout(onClose, 6000)
    return () => clearTimeout(t)
  }, [toast, onClose])

  if (!toast) return null

  return (
    <div className={`toast toast-${toast.type}`}>
      <span>{toast.message}</span>
      {toast.action && (
        <button type="button" onClick={toast.action.onClick}>
          {toast.action.label}
        </button>
      )}
      <button type="button" className="toast-close" onClick={onClose}>
        ✕
      </button>
    </div>
  )
}
