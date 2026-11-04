import React from 'react'
import Icon from '../components/Icon'
import { formatLei } from '../format'
import { getBackupChip } from '../fisaModel'

// Bara de jos: total final, starea salvarii automate / backup-ului si
// butoanele de previzualizare / finalizare.
export default function ReleaseBar({
  totalFinal,
  saveState,
  saveError,
  savedAt,
  backupStatus,
  pdfRetry,
  onRetryPdf,
  previewingPdf,
  fisaGoala,
  onPreview,
  releasing,
  readOnly,
  onRelease
}) {
  const savedTime = savedAt ? savedAt.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }) : ''
  const backupChip = getBackupChip(backupStatus)
  return (
    <div className="release-bar">
      <div className="release-total">
        <span className="release-total-label">Total final</span>
        <span className="release-total-value">{formatLei(totalFinal)}</span>
      </div>
      {saveState === 'error' ? (
        <span className="chip chip-error" role="alert" title={saveError || ''}>
          <Icon name="refresh" size={13} /> Nesalvat! Se reîncearcă…
        </span>
      ) : (
        <span className={`chip autosave-status ${saveState === 'saved' ? 'saved' : ''}`}>
          {saveState === 'saving' && (
            <>
              <Icon name="loader" size={13} className="spin" /> Se salvează...
            </>
          )}
          {saveState === 'saved' && (
            <>
              <Icon name="check" size={13} /> Salvat{savedTime && ` ${savedTime}`}
            </>
          )}
        </span>
      )}
      {backupChip && (
        <span className={`chip chip-backup ${backupChip.warn ? 'chip-warn' : 'saved'}`} title={backupChip.title}>
          {backupChip.text}
        </span>
      )}
      <div className="release-bar-actions">
        {pdfRetry && (
          <button type="button" onClick={() => onRetryPdf(pdfRetry.baseName)}>
            <Icon name="refresh" /> Reîncearcă generarea PDF
          </button>
        )}
        <button
          type="button"
          disabled={previewingPdf || fisaGoala}
          title="Generează și deschide un PDF cu fișa curentă, fără să o finalizezi (util pentru o ofertă)"
          onClick={onPreview}
        >
          {previewingPdf ? (
            <>
              <Icon name="loader" className="spin" /> Se generează...
            </>
          ) : (
            <>
              <Icon name="file" /> Previzualizează PDF
            </>
          )}
        </button>
        <button
          type="button"
          className="btn-primary btn-release"
          disabled={releasing || readOnly}
          title={readOnly ? 'Licență revocată — mod doar-citire' : undefined}
          onClick={onRelease}
        >
          {releasing ? (
            <>
              <Icon name="loader" className="spin" /> Se finalizează...
            </>
          ) : (
            <>
              <Icon name="check" /> Finalizează fișa
            </>
          )}
        </button>
      </div>
    </div>
  )
}
