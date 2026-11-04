import React, { useCallback, useEffect, useState } from 'react'
import CommandPalette from '../components/CommandPalette'
import OverflowMenu from '../components/OverflowMenu'
import ThemeToggle from '../components/ThemeToggle'
import ShortcutsOverlay from '../components/ShortcutsOverlay'
import { OPEN_PALETTE_EVENT, openShortcutsHelp } from '../hooks/useShortcuts'
import Icon from '../components/Icon'

// Bara de sus: titlul fisei, declansatorul paletei de comenzi (cautare +
// actiuni), butonul de update si meniul "mai multe". Paleta se deschide din
// clic pe camp sau din Ctrl+K (eveniment OPEN_PALETTE_EVENT).
export default function Topbar({
  fisa,
  fisaGoala,
  showToast,
  searchInputRef,
  updateInfo,
  updateBtn,
  showUpdatePill,
  onUpdatePillClick,
  onOpenReports,
  onOpenWhatsNew,
  onOpenPdf,
  onPrintPdf,
  onDeleteFinalized,
  onEditRecent,
  onNewForProfile,
  drafts,
  recentFise,
  onOpenDraft,
  onNewFisa,
  onOpenSettings,
  onShowVehicleHistory
}) {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [exportingLogs, setExportingLogs] = useState(false)
  const openPalette = useCallback(() => setPaletteOpen(true), [])
  const closePalette = useCallback(() => setPaletteOpen(false), [])

  // Ctrl+K (useShortcuts) cere deschiderea paletei printr-un eveniment.
  useEffect(() => {
    window.addEventListener(OPEN_PALETTE_EVENT, openPalette)
    return () => window.removeEventListener(OPEN_PALETTE_EVENT, openPalette)
  }, [openPalette])

  async function handleOpenFolder() {
    const res = await window.serviceAuto.fise.openFolder()
    if (!res.ok) showToast('error', res.error.message)
  }

  async function handleExportLogs() {
    setExportingLogs(true)
    const res = await window.serviceAuto.app.exportLogs()
    setExportingLogs(false)
    if (res.ok) {
      showToast('success', `Loguri exportate pe Desktop (${res.data.copied} fișiere) - trimite folderul pentru depanare.`)
    } else {
      showToast('error', res.error.message)
    }
  }

  const plate = fisa.auto.nrInmatriculare?.trim()
  const vehicul = [fisa.auto.marca, fisa.auto.model].map((x) => x?.trim()).filter(Boolean).join(' ')

  return (
    <header className="topbar">
      <div className="topbar-title">
        <h1>{fisa._replaceBaseName ? 'Editare fișă' : fisaGoala ? 'Fișă nouă' : 'Fișă de service'}</h1>
        {!fisaGoala && (plate || vehicul || fisa.client.nume?.trim()) && (
          <div className="crumbs">
            {plate && <span className="plate">{plate}</span>}
            {vehicul && <span>{vehicul}</span>}
            {fisa.client.nume?.trim() && (
              <span className="crumb-client">
                <Icon name="user" size={13} /> {fisa.client.nume.trim()}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="topbar-actions">
        <div className="search-box">
          <Icon name="search" size={15} className="search-icon" />
          {/* Doar declansator: paleta isi are propriul input (vezi CommandPalette). */}
          <input
            type="text"
            readOnly
            ref={searchInputRef}
            className="topbar-search"
            placeholder="Caută"
            aria-label="Caută"
            aria-haspopup="dialog"
            aria-expanded={paletteOpen}
            title="Caută (Ctrl+K)"
            value=""
            onClick={openPalette}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
                e.preventDefault()
                openPalette()
              }
            }}
          />
          <kbd className="search-kbd">Ctrl+K</kbd>
        </div>
        {paletteOpen && (
          <CommandPalette
            fisa={fisa}
            drafts={drafts}
            recentFise={recentFise}
            onClose={closePalette}
            onOpenPdf={onOpenPdf}
            onPrintPdf={onPrintPdf}
            onDeleteFinalized={onDeleteFinalized}
            onEditRecent={onEditRecent}
            onNewForProfile={onNewForProfile}
            onOpenDraft={onOpenDraft}
            onNewFisa={onNewFisa}
            onOpenReports={onOpenReports}
            onOpenSettings={onOpenSettings}
            onShowVehicleHistory={onShowVehicleHistory}
          />
        )}
        {showUpdatePill && (
          <button
            type="button"
            className={`btn-sm btn-status-${updateBtn.variant}`}
            disabled={updateInfo.status === 'downloading'}
            onClick={onUpdatePillClick}
          >
            <Icon name={updateInfo.status === 'downloading' ? 'loader' : 'download'} />
            {updateBtn.text}
          </button>
        )}
        <OverflowMenu
          items={[
            { label: 'Rapoarte', icon: 'chart', onClick: onOpenReports },
            { label: 'Ce e nou', icon: 'info', onClick: onOpenWhatsNew },
            { label: 'Scurtături de tastatură', icon: 'info', onClick: openShortcutsHelp },
            { label: 'Deschide folderul cu fișe', icon: 'folder', onClick: handleOpenFolder },
            {
              label: exportingLogs ? 'Se exportă...' : 'Exportă loguri',
              icon: 'download',
              onClick: handleExportLogs
            }
          ]}
        />
        <ThemeToggle />
      </div>
      <ShortcutsOverlay />
    </header>
  )
}
