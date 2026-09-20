import React, { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import BackupPanel from './BackupPanel'
import TrashPanel from './TrashPanel'
import './settings-extra.css'

export default function SettingsModal({ onClose, showToast, confirm, firstRun = false, readOnly = false, onDataChanged }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState({ numeService: '', adresa: '', telefon: '', cui: '' })
  const [corruptMsg, setCorruptMsg] = useState(null)
  const [pathInfo, setPathInfo] = useState(null) // { current, default }
  const [changingPath, setChangingPath] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const [autoUpdate, setAutoUpdate] = useState(false)
  const [autoUpdateBusy, setAutoUpdateBusy] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    const api = window.serviceAuto
    api.settings
      .get()
      .then((res) => {
        if (!mounted.current) return
        if (res.ok) {
          setSettings((s) => ({ ...s, ...res.data }))
        } else if (res.error.code === 'SETTINGS_CORRUPT') {
          // Fișierul e corupt: afișăm mesajul inline, utilizatorul poate reintroduce datele.
          setCorruptMsg(res.error.message)
        } else {
          showToast('error', res.error.message)
        }
      })
      .catch((err) => {
        if (mounted.current) showToast('error', String(err?.message || err))
      })
      .finally(() => {
        if (mounted.current) setLoading(false)
      })
    api.settings
      .getDataPathInfo()
      .then((res) => {
        if (mounted.current && res.ok) setPathInfo(res.data)
      })
      .catch(() => {})
    api.app
      .getAutoUpdate?.()
      .then((res) => {
        if (mounted.current && res.ok) setAutoUpdate(Boolean(res.data))
      })
      .catch(() => {})
    api.app
      .getVersion()
      .then((res) => {
        if (mounted.current && res.ok) setAppVersion(res.data)
      })
      .catch(() => {})
  }, [showToast])

  async function handleToggleAutoUpdate(e) {
    const next = e.target.checked
    if (autoUpdateBusy) return
    setAutoUpdateBusy(true)
    setAutoUpdate(next) // optimist; revenim daca esueaza
    try {
      const res = await window.serviceAuto.app.setAutoUpdate(next)
      if (!mounted.current) return
      if (res.ok) setAutoUpdate(Boolean(res.data))
      else {
        setAutoUpdate(!next)
        showToast('error', res.error.message)
      }
    } catch (err) {
      if (mounted.current) {
        setAutoUpdate(!next)
        showToast('error', String(err?.message || err))
      }
    } finally {
      if (mounted.current) setAutoUpdateBusy(false)
    }
  }

  async function handlePickFolder() {
    if (readOnly || changingPath) return
    try {
      const picked = await window.serviceAuto.settings.pickDataFolder()
      if (!mounted.current) return
      if (!picked.ok) return showToast('error', picked.error.message)
      if (!picked.data) return
      await applyDataPath(picked.data)
    } catch (err) {
      if (mounted.current) showToast('error', String(err?.message || err))
    }
  }

  async function handleResetFolder() {
    if (!pathInfo || readOnly) return
    await applyDataPath(pathInfo.default)
  }

  async function applyDataPath(newPath) {
    if (changingPath) return
    setChangingPath(true)
    try {
      const res = await window.serviceAuto.settings.changeDataPath(newPath)
      if (!mounted.current) return
      if (res.ok) {
        setPathInfo((p) => ({ ...p, current: res.data.path }))
        if (res.data.changed) {
          showToast(
            'success',
            `Fișierele au fost copiate în noul folder. Locația veche (${res.data.oldPath}) a rămas neatinsă - o poți șterge manual după ce verifici.`
          )
        }
      } else {
        showToast('error', res.error.message)
      }
    } catch (err) {
      if (mounted.current) showToast('error', String(err?.message || err))
    } finally {
      if (mounted.current) setChangingPath(false)
    }
  }

  function setField(patch) {
    setSettings((s) => ({ ...s, ...patch }))
  }

  async function handleSave() {
    if (readOnly || saving) return
    setSaving(true)
    try {
      const res = await window.serviceAuto.settings.save(settings)
      if (!mounted.current) return
      if (res.ok) {
        showToast('success', 'Datele service-ului au fost salvate. Vor apărea pe fișele generate de acum.')
        onClose()
      } else {
        showToast('error', res.error.message)
      }
    } catch (err) {
      if (mounted.current) showToast('error', String(err?.message || err))
    } finally {
      if (mounted.current) setSaving(false)
    }
  }

  return (
    <Modal title="Datele service-ului" onClose={onClose}>
      {loading ? (
        <p className="hint">Se încarcă...</p>
      ) : (
        <div className="settings-scroll">
          {firstRun && (
            <p className="settings-welcome">
              Bine ai venit! Completează datele service-ului — apar pe antetul fiecărui PDF.
            </p>
          )}
          {corruptMsg && (
            <div className="settings-warn" role="alert">
              {corruptMsg}
            </div>
          )}
          <p className="hint" style={{ marginBottom: 14 }}>
            Aceste date apar pe antetul fișelor PDF generate, lângă datele clientului.
          </p>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Nume service</label>
            <input
              type="text"
              maxLength={200}
              placeholder="Auto Service SRL"
              value={settings.numeService}
              onChange={(e) => setField({ numeService: e.target.value })}
            />
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Adresă</label>
            <input
              type="text"
              maxLength={200}
              placeholder="str. Exemplu 10, Chișinău"
              value={settings.adresa}
              onChange={(e) => setField({ adresa: e.target.value })}
            />
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Telefon</label>
              <input
                type="text"
                maxLength={40}
                placeholder="+373 69 123 456"
                value={settings.telefon}
                onChange={(e) => setField({ telefon: e.target.value })}
              />
            </div>
            <div className="field">
              <label>CUI / IDNO</label>
              <input
                type="text"
                maxLength={32}
                placeholder="1234567890123"
                value={settings.cui}
                onChange={(e) => setField({ cui: e.target.value })}
              />
            </div>
          </div>

          <div className="release-bar" style={{ marginTop: 14 }}>
            <span className="hint">{appVersion && `Versiune: ${appVersion}`}</span>
            <div className="release-bar-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={saving || readOnly}
                onClick={handleSave}
              >
                {saving ? 'Se salvează...' : 'Salvează'}
              </button>
            </div>
          </div>

          <div className="settings-section">
            <h3>Locația fișelor</h3>
            <div className="hint" style={{ wordBreak: 'break-all', marginBottom: 8 }}>
              {pathInfo?.current || 'Se încarcă...'}
              {pathInfo && pathInfo.current === pathInfo.default && ' (implicit)'}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" disabled={changingPath || readOnly} onClick={handlePickFolder}>
                {changingPath ? 'Se copiază...' : 'Schimbă folderul...'}
              </button>
              {pathInfo && pathInfo.current !== pathInfo.default && (
                <button type="button" disabled={changingPath || readOnly} onClick={handleResetFolder}>
                  Resetează la implicit
                </button>
              )}
            </div>
          </div>

          <div className="settings-section">
            <h3>Actualizări</h3>
            <label className="switch" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input type="checkbox" checked={autoUpdate} disabled={autoUpdateBusy} onChange={handleToggleAutoUpdate} />
              <span className="switch-track" aria-hidden="true" />
              Descarcă actualizările automat și instalează-le la închiderea aplicației
            </label>
            <p className="hint" style={{ marginTop: 6 }}>
              Nicio întrerupere în timpul lucrului: versiunea nouă se descarcă în fundal și se instalează abia când
              închizi aplicația (după ce fișa în lucru a fost salvată). Dacă aplicația nu se închide niciodată, ea
              rămâne pe versiunea veche până la următoarea repornire.
            </p>
          </div>

          <div className="settings-section">
            <h3>Backup</h3>
            <BackupPanel showToast={showToast} confirm={confirm} readOnly={readOnly} onDataChanged={onDataChanged} />
          </div>

          <div className="settings-section">
            <h3>Coș de gunoi — se păstrează 30 de zile</h3>
            <TrashPanel showToast={showToast} readOnly={readOnly} onDataChanged={onDataChanged} />
          </div>
        </div>
      )}
    </Modal>
  )
}
