import React from 'react'
import UpdateBanner from '../components/UpdateBanner'

// Bannerele de deasupra formularului: licenta revocata, folder de date
// indisponibil, actualizare disponibila.
export default function Banners({ readOnly, onRequestActivation, locationBanner, updateInfo, onDownload, onInstall }) {
  return (
    <>
      {readOnly && (
        <div className="app-banner" role="alert">
          <span>
            Licență revocată — mod doar-citire. Poți deschide, căuta, tipări și exporta fișele existente.
          </span>
          <button type="button" onClick={onRequestActivation}>
            Introdu cheie nouă
          </button>
        </div>
      )}
      {locationBanner && (
        <div className="app-banner warn" role="alert">
          <span>
            Folderul de date «{locationBanner.override}» nu este disponibil (unitate scoasă/rețea căzută?). Lucrezi
            temporar în «{locationBanner.dir}». Reconectează folderul și repornește aplicația — datele de acum vor
            fi aduse înapoi automat.
          </span>
        </div>
      )}
      <UpdateBanner
        status={updateInfo.status}
        version={updateInfo.version}
        notes={updateInfo.notes}
        percent={updateInfo.percent}
        onDownload={onDownload}
        onInstall={onInstall}
      />
    </>
  )
}
