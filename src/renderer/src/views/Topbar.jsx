import React, { useCallback, useEffect, useRef, useState } from 'react'
import SearchModal from '../components/SearchModal'
import OverflowMenu from '../components/OverflowMenu'
import ThemeToggle from '../components/ThemeToggle'
import Icon from '../components/Icon'

// Bara de sus: titlul fisei, cautarea (cu filtre pe data), butonul de update
// si meniul "mai multe". Starea cautarii e locala aici; App primeste doar
// referinta input-ului (searchInputRef) pentru scurtatura Ctrl+K.
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
  onNewForProfile
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchRange, setSearchRange] = useState({ from: '', to: '' })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [exportingLogs, setExportingLogs] = useState(false)
  const searchBoxRef = useRef(null)
  const searchActive = Boolean(searchQuery.trim() || searchRange.from || searchRange.to || filtersOpen)
  const closeSearch = useCallback(() => {
    setSearchQuery('')
    setSearchRange({ from: '', to: '' })
    setFiltersOpen(false)
  }, [])

  // Panoul de rezultate e un dropdown ancorat (nu mai are propriul backdrop
  // intunecat peste tot ecranul) - fara asta, click-ul in afara lui n-ar mai
  // avea cum sa-l inchida. Aceeasi conventie ca la Autocomplete/OverflowMenu.
  useEffect(() => {
    if (!searchActive) return undefined
    function handleClickOutside(e) {
      // Nu inchidem panoul de cautare la click-uri in alte overlay-uri proprii
      // (ex: ConfirmDialog deschis din interiorul SearchModal, la stergerea
      // unui rezultat) - acelea sunt randate la nivel de App, in afara
      // .search-box, dar fac parte din acelasi flux, nu sunt "in afara".
      if (e.target.closest?.('.confirm-overlay')) return
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target)) closeSearch()
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [searchActive, closeSearch])

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
        <div className="search-box" ref={searchBoxRef}>
          <Icon name="search" size={15} className="search-icon" />
          <input
            type="text"
            ref={searchInputRef}
            className="topbar-search"
            placeholder="Caută"
            aria-label="Caută fișe"
            title="Caută (Ctrl+K)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeSearch()
            }}
          />
          <button
            type="button"
            className={`btn-sm search-filter-btn${filtersOpen || searchRange.from || searchRange.to ? ' active' : ''}`}
            title="Filtrează după dată"
            aria-label="Filtrează după dată"
            onClick={() => setFiltersOpen((v) => !v)}
          >
            <Icon name="calendar" size={14} />
          </button>
          {searchActive && (
            <SearchModal
              query={searchQuery}
              range={searchRange}
              onRangeChange={setSearchRange}
              onClose={closeSearch}
              onOpenPdf={onOpenPdf}
              onPrintPdf={onPrintPdf}
              onDeleteFinalized={onDeleteFinalized}
              onEditRecent={onEditRecent}
              onNewForProfile={onNewForProfile}
              showToast={showToast}
            />
          )}
        </div>
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
    </header>
  )
}
