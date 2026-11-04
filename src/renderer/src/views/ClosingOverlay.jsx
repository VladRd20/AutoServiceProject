import React from 'react'
import Icon from '../components/Icon'
import useClosing from '../hooks/useClosing'

// Peste toata fereastra cat dureaza salvarea finala dinaintea inchiderii
// (apare doar daca dureaza peste ~300ms), ca utilizatorul sa stie de ce
// fereastra nu s-a inchis inca si sa nu o mai inchida de mai multe ori.
export default function ClosingOverlay() {
  const show = useClosing()
  if (!show) return null
  return (
    <div
      className="closing-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-live="assertive"
      aria-label="Se salvează datele"
    >
      <div className="closing-card">
        <Icon name="loader" size={26} className="spin" />
        <strong>Se salvează datele…</strong>
        <span>Aplicația se va închide imediat ce salvarea se termină.</span>
      </div>
    </div>
  )
}
