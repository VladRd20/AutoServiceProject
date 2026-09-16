import React from 'react'

export default function UpdateBanner({ status, version, percent, onDownload, onInstall }) {
  if (status === 'available') {
    return (
      <div className="update-banner">
        <span>🆕 Versiune noua disponibila: v{version}</span>
        <button type="button" onClick={onDownload}>
          Descarca
        </button>
      </div>
    )
  }

  if (status === 'downloading') {
    return (
      <div className="update-banner">
        <span>⬇️ Se descarca actualizarea v{version}... {percent ?? 0}%</span>
        <div className="update-progress">
          <div className="update-progress-fill" style={{ width: `${percent ?? 0}%` }} />
        </div>
      </div>
    )
  }

  if (status === 'downloaded') {
    return (
      <div className="update-banner update-banner-ready">
        <span>✅ Actualizare v{version} pregatita</span>
        <button type="button" onClick={onInstall}>
          Reporneste acum
        </button>
      </div>
    )
  }

  return null
}
