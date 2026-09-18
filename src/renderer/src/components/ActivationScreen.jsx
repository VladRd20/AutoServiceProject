import React, { useState } from 'react'

export default function ActivationScreen({ onActivated, revoked }) {
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [activating, setActivating] = useState(false)

  async function handleActivate(e) {
    e.preventDefault()
    if (!key.trim()) return
    setActivating(true)
    setError('')
    const res = await window.serviceAuto.license.activate(key.trim())
    setActivating(false)
    if (res.ok) {
      onActivated()
    } else {
      setError(res.error.message)
    }
  }

  return (
    <div className="activation-screen">
      <div className="activation-card">
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
