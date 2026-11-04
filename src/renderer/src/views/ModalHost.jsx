import React, { Suspense, useEffect } from 'react'
import SettingsModal from '../components/SettingsModal'
import LazyBoundary, { lazyRetry } from '../components/LazyBoundary'

// Modalele rare se incarca la cerere (chunk separat) - nu cresc bundle-ul de
// pornire. SettingsModal e eager (~21 KB): modalul de prima rulare trebuie sa apara
// imediat, nu dupa ce formularul e deja interactiv. CommandPalette ramane eager (Ctrl+K trebuie sa fie instant). Chunk-urile
// se preincarca in idle dupa prima randare, deci prima deschidere nu asteapta.
const loadReportsModal = () => import('../components/ReportsModal')
const loadVehicleHistoryModal = () => import('../components/VehicleHistoryModal')
const loadWhatsNewModal = () => import('../components/WhatsNewModal')
const ReportsModal = lazyRetry(loadReportsModal)
const VehicleHistoryModal = lazyRetry(loadVehicleHistoryModal)
const WhatsNewModal = lazyRetry(loadWhatsNewModal)

export default function ModalHost({
  showToast,
  confirmAction,
  settingsOpen,
  firstRunOpen,
  onCloseSettings,
  onDataChanged,
  updater,
  readOnly,
  whatsNew,
  onCloseWhatsNew,
  reportsOpen,
  onCloseReports,
  vehicleHistoryQuery,
  onCloseVehicleHistory,
  onOpenPdf,
  onPrintPdf,
  onDeleteFinalized,
  onEditRecent,
  onNewForProfile
}) {
  // Preincarcam chunk-urile modalelor rare in idle, dupa prima randare.
  useEffect(() => {
    const preload = () => {
      loadReportsModal()
      loadVehicleHistoryModal()
      loadWhatsNewModal()
    }
    if (typeof window.requestIdleCallback === 'function') {
      const h = window.requestIdleCallback(preload, { timeout: 5000 })
      return () => window.cancelIdleCallback?.(h)
    }
    const t = setTimeout(preload, 2000)
    return () => clearTimeout(t)
  }, [])

  const { updateInfo, updateBtn, checkingUpdates } = updater

  return (
    /* Fallback null: chunk-urile sunt preincarcate, deci modalul apare practic instant. */
    <Suspense fallback={null}>
      {(settingsOpen || firstRunOpen) && (
        <LazyBoundary showToast={showToast} onClose={onCloseSettings}>
          <SettingsModal
            onClose={onCloseSettings}
            showToast={showToast}
            confirm={confirmAction}
            onDataChanged={onDataChanged}
            update={{
              status: updateInfo.status,
              version: updateInfo.version,
              text: updateBtn.text,
              variant: updateBtn.variant,
              checking: checkingUpdates,
              onCheck: updater.handleCheckForUpdates,
              onDownload: updater.handleDownloadUpdate,
              onInstall: updater.handleInstallUpdate
            }}
            firstRun={firstRunOpen}
            readOnly={readOnly}
          />
        </LazyBoundary>
      )}

      {whatsNew && (
        <LazyBoundary showToast={showToast} onClose={onCloseWhatsNew}>
          <WhatsNewModal entries={whatsNew.entries} onClose={onCloseWhatsNew} />
        </LazyBoundary>
      )}

      {reportsOpen && (
        <LazyBoundary showToast={showToast} onClose={onCloseReports}>
          <ReportsModal onClose={onCloseReports} showToast={showToast} />
        </LazyBoundary>
      )}

      {vehicleHistoryQuery && (
        <LazyBoundary showToast={showToast} onClose={onCloseVehicleHistory}>
          <VehicleHistoryModal
            vin={vehicleHistoryQuery.vin}
            nrInmatriculare={vehicleHistoryQuery.nrInmatriculare}
            onClose={onCloseVehicleHistory}
            onOpenPdf={onOpenPdf}
            onPrintPdf={onPrintPdf}
            onDeleteFinalized={onDeleteFinalized}
            onEditRecent={onEditRecent}
            onNewForProfile={onNewForProfile}
            showToast={showToast}
          />
        </LazyBoundary>
      )}
    </Suspense>
  )
}
