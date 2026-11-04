import React, { useState } from 'react'
import UpdateBanner from '../components/UpdateBanner'

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// Textul bannerului de avertismente despre folderul de date.
export function storeWarningText(w) {
  const copies = w.conflictCopies?.length ?? 0
  const dups = w.duplicateNr?.length ?? 0
  const parts = []
  if (copies) parts.push(`${plural(copies, 'copie', 'copii')} de sincronizare (OneDrive)`)
  if (dups) parts.push(`${plural(dups, 'număr de fișă duplicat', 'numere de fișă duplicate')}`)
  return `Am găsit ${parts.join(' și ')} în folderul de date.`
}

function StoreWarningBanner({ warnings, onDismiss }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="app-banner warn store-warning" role="status">
      <div className="store-warning-main">
        <span>{storeWarningText(warnings)}</span>
        <button
          type="button"
          className="btn-sm"
          aria-expanded={open}
          aria-controls="store-warning-details"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Ascunde detaliile' : 'Arată detalii'}
        </button>
        <button type="button" className="btn-sm" onClick={onDismiss} aria-label="Închide avertismentul" title="Închide">
          Închide
        </button>
      </div>
      {open && (
        <div className="store-warning-details" id="store-warning-details">
          {warnings.conflictCopies?.length > 0 && (
            <>
              <strong>Copii de sincronizare</strong>
              <ul>
                {warnings.conflictCopies.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </>
          )}
          {warnings.duplicateNr?.length > 0 && (
            <>
              <strong>Numere de fișă duplicate</strong>
              <ul>
                {warnings.duplicateNr.map((d) => (
                  <li key={d.nr}>
                    {d.nr}: {d.files.join(', ')}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p>Fișierele nu au fost șterse sau modificate; verifică-le și păstrează-le pe cele corecte.</p>
        </div>
      )}
    </div>
  )
}

// Bannerele de deasupra formularului: licenta revocata, folder de date
// indisponibil, avertismente despre folderul de date, actualizare disponibila.
export default function Banners({
  readOnly,
  onRequestActivation,
  locationBanner,
  storeWarnings,
  onDismissStoreWarnings,
  updateInfo,
  onDownload,
  onInstall
}) {
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
      {storeWarnings && <StoreWarningBanner warnings={storeWarnings} onDismiss={onDismissStoreWarnings} />}
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
