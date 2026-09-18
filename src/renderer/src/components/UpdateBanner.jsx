import React from 'react'

export default function UpdateBanner({ status, version, percent, onDownload, onInstall }) {
  if (status === 'available') {
    return (
      <div className="update-banner">
        <span>🆕 Versiune nouă disponibilă: v{version}</span>
        <button type="button" onClick={onDownload}>
          Descarcă
        </button>
      </div>
    )
  }

  if (status === 'downloading') {
    return (
      <div className="update-banner">
        <span>⬇️ Se descarcă actualizarea v{version}... {percent ?? 0}%</span>
        <div className="update-progress">
          <div className="update-progress-fill" style={{ width: `${percent ?? 0}%` }} />
        </div>
      </div>
    )
  }

  if (status === 'downloaded') {
    return (
      <div className="update-banner update-banner-ready">
        <span>✅ Actualizare v{version} pregătită</span>
        <button type="button" onClick={onInstall}>
          Repornește acum
        </button>
      </div>
    )
  }

  return null
}
