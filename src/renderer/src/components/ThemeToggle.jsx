import React, { useState } from 'react'
import Icon from './Icon'
import { getThemeMode, nextThemeMode, setThemeMode } from '../theme'

const MODES = {
  light: { label: 'luminoasă', next: 'întunecată' },
  dark: { label: 'întunecată', next: 'sistem' },
  system: { label: 'sistem', next: 'luminoasă' }
}

// Monitor = "urmeaza sistemul" (Icon.jsx nu are inca o iconita potrivita).
function MonitorIcon({ size = 17 }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM8 21h8M12 17v4" />
    </svg>
  )
}

// Ciclu: Luminoasa -> Intunecata -> Sistem (urmeaza Windows; fara atribut pe
// <html>, CSS-ul reactioneaza live la prefers-color-scheme).
export default function ThemeToggle() {
  const [mode, setMode] = useState(getThemeMode)

  function cycle() {
    const next = nextThemeMode(mode)
    setThemeMode(next)
    setMode(next)
  }

  const { label, next } = MODES[mode]
  return (
    <button
      type="button"
      className="theme-toggle icon-btn"
      aria-label={`Temă: ${label}`}
      title={`Temă: ${label} (clic: ${next})`}
      onClick={cycle}
    >
      {mode === 'system' ? <MonitorIcon /> : <Icon name={mode === 'dark' ? 'moon' : 'sun'} size={17} />}
    </button>
  )
}
