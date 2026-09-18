import React, { useEffect, useState } from 'react'
import Icon from './Icon'
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
      className="theme-toggle icon-btn" aria-label="Schimbă tema"
      onClick={toggle}
      title={effective === 'dark' ? 'Temă deschisă' : 'Temă închisă'}
    >
      <Icon name={effective === 'dark' ? 'sun' : 'moon'} size={17} />
    </button>
  )
}
