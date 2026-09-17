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
            Licenta curenta a fost revocata. Daca ai primit o cheie noua, introdu-o mai jos.
          </p>
        ) : (
          <p>Introdu cheia de licenta primita pentru a folosi aplicatia.</p>
        )}
        <form onSubmit={handleActivate}>
          <textarea
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Lipeste aici cheia de licenta..."
            rows={4}
          />
          {error && <p className="activation-error">{error}</p>}
          <button type="submit" className="btn-primary" disabled={activating || !key.trim()}>
            {activating ? 'Se activeaza...' : 'Activeaza'}
          </button>
        </form>
      </div>
    </div>
  )
}
