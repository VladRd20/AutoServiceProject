import React, { useEffect, useState } from 'react'
import { getStoredTheme, setStoredTheme, applyTheme, getEffectiveTheme } from '../theme'

export default function ThemeToggle() {
  const [effective, setEffective] = useState(getEffectiveTheme)

  // Daca utilizatorul nu a ales explicit o tema, urmarim schimbarea temei
  // Windows in timp real, ca butonul sa arate mereu starea corecta.
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return undefined
    function handleChange() {
      if (!getStoredTheme()) setEffective(mq.matches ? 'dark' : 'light')
    }
    mq.addEventListener('change', handleChange)
    return () => mq.removeEventListener('change', handleChange)
  }, [])

  function toggle() {
    const next = effective === 'dark' ? 'light' : 'dark'
    setStoredTheme(next)
    applyTheme(next)
    setEffective(next)
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      title={effective === 'dark' ? 'Comuta la tema deschisa' : 'Comuta la tema inchisa'}
    >
      {effective === 'dark' ? '☀️' : '🌙'}
    </button>
  )
}
