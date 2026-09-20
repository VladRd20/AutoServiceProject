import React, { useState } from 'react'

export default function ActivationScreen({ onActivated, revoked, overlay, onClose }) {
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [activating, setActivating] = useState(false)

  async function handleActivate(e) {
    e.preventDefault()
    if (!key.trim()) return
    setActivating(true)
    setError('')
    try {
      const res = await window.serviceAuto.license.activate(key.trim())
      if (res.ok) onActivated()
      else setError(res.error.message)
    } catch (err) {
      setError(err?.message || 'Activarea a eșuat. Încearcă din nou.')
    } finally {
      setActivating(false)
    }
  }

  return (
    <div className={`activation-screen${overlay ? ' activation-overlay' : ''}`}>
      <div className="activation-card">
        {onClose && (
          <button type="button" className="activation-close" onClick={onClose}>
            Închide
          </button>
        )}
        <h1>Activare Service Auto</h1>
        {revoked ? (
          <p className="activation-error">
            Licența curentă a fost revocată. Dacă ai primit o cheie nouă, introdu-o mai jos.
          </p>
        ) : (
          <p>Introdu cheia de licență primită pentru a folosi aplicația.</p>
        )}
        <form onSubmit={handleActivate}>
          <textarea
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Lipește aici cheia de licență..."
            rows={4}
          />
          {error && <p className="activation-error">{error}</p>}
          <button type="submit" className="btn-primary" disabled={activating || !key.trim()}>
            {activating ? 'Se activează...' : 'Activează'}
          </button>
        </form>
      </div>
    </div>
  )
}
