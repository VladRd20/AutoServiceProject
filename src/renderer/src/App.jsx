import React, { useCallback, useEffect, useRef, useState } from 'react'
import FisaForm from './components/FisaForm'
import ListaItems from './components/ListaItems'
import Totaluri from './components/Totaluri'
import Toast from './components/Toast'
import ConfirmDialog from './components/ConfirmDialog'
import DraftsSidebar from './components/DraftsSidebar'
import { isFisaEmpty } from '../../shared/calculations'
import useToasts from './hooks/useToasts'
import useConfirm from './hooks/useConfirm'
import useUpdater from './hooks/useUpdater'
import useBackupStatus from './hooks/useBackupStatus'
import useFisaEditor from './hooks/useFisaEditor'
import useDrafts from './hooks/useDrafts'
import useFiseLists from './hooks/useFiseLists'
import useLocationInfo from './hooks/useLocationInfo'
import useFirstRun from './hooks/useFirstRun'
import useRelease from './hooks/useRelease'
import useShortcuts from './hooks/useShortcuts'
import Banners from './views/Banners'
import Topbar from './views/Topbar'
import ReleaseBar from './views/ReleaseBar'
import ModalHost from './views/ModalHost'

// Radacina de compozitie: leaga hook-urile (starea si fluxurile) de view-uri.
// Ordinea hook-urilor conteaza (fiecare primeste ce a returnat unul anterior).
export default function App({ readOnly = false, onRequestActivation } = {}) {
  const { toasts, showToast, closeToast } = useToasts()
  const { confirmState, confirmAction, handleConfirmResult } = useConfirm()
  const updater = useUpdater({ showToast })
  const { backupStatus, refreshBackupStatus } = useBackupStatus()

  // Blocheaza autosave-ul "instant" de la pornire pana stim daca exista deja
  // un draft gol de refolosit - altfel castiga cursa cu IPC-ul de listDrafts
  // si salveaza un draft nou inainte sa apucam sa-l refolosim pe cel vechi.
  const [initialCheckDone, setInitialCheckDone] = useState(false)

  const editor = useFisaEditor({ readOnly, showToast, initialCheckDone })
  const { fisa, setFisa, errors, setErrors, setPdfRetry } = editor
  const lists = useFiseLists({ showToast, confirmAction })
  const draftsApi = useDrafts({
    autosaver: editor.autosaver,
    fisaRef: editor.fisaRef,
    readOnlyRef: editor.readOnlyRef,
    patchDraftRef: editor.patchDraftRef,
    releasingRef: editor.releasingRef,
    showToast,
    setFisa,
    setErrors,
    setPdfRetry,
    resetToNewFisa: editor.resetToNewFisa,
    flushOrAbort: editor.flushOrAbort,
    refreshRecentFise: lists.refreshRecentFise,
    refreshAutocomplete: lists.refreshAutocomplete
  })
  const { locationBanner, checkLocation } = useLocationInfo({ showToast })
  const firstRun = useFirstRun({ initialCheckDone })
  const release = useRelease({
    fisa,
    readOnly,
    showToast,
    autosaver: editor.autosaver,
    fisaRef: editor.fisaRef,
    readOnlyRef: editor.readOnlyRef,
    releasingRef: editor.releasingRef,
    suspendAutosaveRef: editor.suspendAutosaveRef,
    removedDraftIdsRef: draftsApi.removedDraftIdsRef,
    setErrors,
    setPdfRetry,
    resetToNewFisa: editor.resetToNewFisa,
    goToNextDraftOrNew: draftsApi.goToNextDraftOrNew,
    refreshBackupStatus
  })

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [reportsOpen, setReportsOpen] = useState(false)
  const [vehicleHistoryQuery, setVehicleHistoryQuery] = useState(null) // { vin, nrInmatriculare }
  const searchInputRef = useRef(null)

  const modalOpen = Boolean(
    confirmState || settingsOpen || firstRun.firstRunOpen || reportsOpen || vehicleHistoryQuery || firstRun.whatsNew
  )
  useShortcuts({
    modalOpen,
    releasingRef: editor.releasingRef,
    searchInputRef,
    onNewFisa: draftsApi.handleNewFisa,
    autosaver: editor.autosaver,
    showToast,
    onRelease: release.handleRelease,
    onPreview: release.handlePreviewPdf,
    readOnly
  })

  // Pornirea: ordinea apelurilor = ordinea in care pornesc cererile IPC.
  // Decizia "prima rulare" se ia INAINTE ca formularul sa fie afisat/interactiv
  // (vezi useFirstRun), iar initialCheckDone se seteaza dupa incarcarea drafturilor.
  useEffect(() => {
    const draftsReady = draftsApi.loadInitialDrafts().finally(() => setInitialCheckDone(true))
    const recentReady = lists.refreshRecentFise()
    lists.refreshAutocomplete()
    checkLocation(Promise.all([draftsReady, recentReady]))
    firstRun.checkFirstRun()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const closeSettings = () => {
    firstRun.closeFirstRun()
    setSettingsOpen(false)
  }
  const closeReports = () => setReportsOpen(false)
  const closeVehicleHistory = () => setVehicleHistoryQuery(null)

  const handleShowVehicleHistory = useCallback(
    (vin, nr) => setVehicleHistoryQuery({ vin, nrInmatriculare: nr }),
    []
  )
  const handleOpenSettings = useCallback(() => setSettingsOpen(true), [])
  const handleOpenReports = () => setReportsOpen(true)

  // Dupa o restaurare din backup/trash (din Setari) listele din bara laterala trebuie reimprospatate.
  const { refreshDrafts } = draftsApi
  const { refreshRecentFise, refreshAutocomplete } = lists
  const onDataChanged = useCallback(() => {
    refreshDrafts()
    refreshRecentFise()
    refreshAutocomplete()
  }, [refreshDrafts, refreshRecentFise, refreshAutocomplete])

  const fisaGoala = isFisaEmpty(fisa)

  return (
    <div className="app" style={firstRun.firstRunChecked ? undefined : { visibility: 'hidden' }}>
      <DraftsSidebar
        drafts={draftsApi.drafts}
        currentId={fisa.id}
        onOpen={draftsApi.handleOpenDraft}
        onDelete={draftsApi.handleDeleteDraft}
        onNew={draftsApi.handleNewFisa}
        recentFise={lists.recentFise}
        onEditRecent={editor.handleEditRecent}
        onOpenPdf={lists.handleOpenPdfFromSearch}
        onPrintPdf={lists.handlePrintPdfFromList}
        onDeleteFinalized={lists.handleDeleteFinalized}
        onOpenSettings={handleOpenSettings}
        confirm={confirmAction}
        isCurrentEmpty={editor.isCurrentEmpty}
        updateBadge={updater.updateActionable}
      />

      <main className="main">
        <Banners
          readOnly={readOnly}
          onRequestActivation={onRequestActivation}
          locationBanner={locationBanner}
          updateInfo={updater.updateInfo}
          onDownload={updater.handleDownloadUpdate}
          onInstall={updater.handleInstallUpdate}
        />

        <Topbar
          fisa={fisa}
          fisaGoala={fisaGoala}
          showToast={showToast}
          searchInputRef={searchInputRef}
          updateInfo={updater.updateInfo}
          updateBtn={updater.updateBtn}
          showUpdatePill={updater.updateActionable}
          onUpdatePillClick={updater.onUpdatePillClick}
          onOpenReports={handleOpenReports}
          onOpenWhatsNew={firstRun.openWhatsNew}
          onOpenPdf={lists.handleOpenPdfFromSearch}
          onPrintPdf={lists.handlePrintPdfFromList}
          onDeleteFinalized={lists.handleDeleteFinalized}
          onEditRecent={editor.handleEditRecent}
          onNewForProfile={editor.handleNewFisaForProfile}
        />

        <FisaForm
          fisa={fisa}
          onChange={setFisa}
          errors={errors}
          autocomplete={lists.autocomplete}
          onShowVehicleHistory={handleShowVehicleHistory}
        />

        <ListaItems
          titlu="Piese"
          singular="piesă"
          items={fisa.piese}
          onChange={editor.handlePieseChange}
          priceKey="pretUnitar"
          codKey="cod"
          priceLabel="Preț unitar"
          errorPrefix="piese"
          errors={errors}
          suggestions={lists.autocomplete.piese}
          showToast={showToast}
          resetKey={fisa.id}
        />

        <ListaItems
          titlu="Lucrări"
          singular="lucrare"
          items={fisa.lucrari}
          onChange={editor.handleLucrariChange}
          priceKey="pret"
          priceLabel="Preț"
          errorPrefix="lucrari"
          errors={errors}
          suggestions={lists.autocomplete.lucrari}
          showToast={showToast}
          resetKey={fisa.id}
        />

        <Totaluri
          piese={fisa.piese}
          lucrari={fisa.lucrari}
          reducerePiesePercent={fisa.reducerePiesePercent}
          reducereLucrariPercent={fisa.reducereLucrariPercent}
          onChangeReducerePiese={editor.handleReducerePieseChange}
          onChangeReducereLucrari={editor.handleReducereLucrariChange}
          errors={errors}
        />

        <ReleaseBar
          totalFinal={editor.totals.totalFinal}
          saveState={editor.saveState}
          saveError={editor.saveError}
          savedAt={editor.savedAt}
          backupStatus={backupStatus}
          pdfRetry={editor.pdfRetry}
          onRetryPdf={release.handleRetryPdf}
          previewingPdf={release.previewingPdf}
          fisaGoala={fisaGoala}
          onPreview={release.handlePreviewPdf}
          releasing={release.releasing}
          readOnly={readOnly}
          onRelease={release.handleRelease}
        />
      </main>

      <Toast toasts={toasts} onClose={closeToast} />

      <ConfirmDialog state={confirmState} onResult={handleConfirmResult} />

      <ModalHost
        showToast={showToast}
        confirmAction={confirmAction}
        settingsOpen={settingsOpen}
        firstRunOpen={firstRun.firstRunOpen}
        onCloseSettings={closeSettings}
        onDataChanged={onDataChanged}
        updater={updater}
        readOnly={readOnly}
        whatsNew={firstRun.whatsNew}
        onCloseWhatsNew={firstRun.closeWhatsNew}
        reportsOpen={reportsOpen}
        onCloseReports={closeReports}
        vehicleHistoryQuery={vehicleHistoryQuery}
        onCloseVehicleHistory={closeVehicleHistory}
        onOpenPdf={lists.handleOpenPdfFromSearch}
        onPrintPdf={lists.handlePrintPdfFromList}
        onDeleteFinalized={lists.handleDeleteFinalized}
        onEditRecent={editor.handleEditRecent}
        onNewForProfile={editor.handleNewFisaForProfile}
      />
    </div>
  )
}
