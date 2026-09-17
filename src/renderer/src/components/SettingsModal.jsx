import React, { useEffect, useState } from 'react'

export default function SettingsModal({ onClose, showToast }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState({ numeService: '', adresa: '', telefon: '', cui: '' })
  const [pathInfo, setPathInfo] = useState(null) // { current, default }
  const [changingPath, setChangingPath] = useState(false)

  useEffect(() => {
    window.serviceAuto.settings.get().then((res) => {
      setLoading(false)
      if (res.ok) setSettings(res.data)
      else showToast('error', res.error.message)
    })
    window.serviceAuto.settings.getDataPathInfo().then((res) => {
      if (res.ok) setPathInfo(res.data)
    })
  }, [showToast])

  async function handlePickFolder() {
    const picked = await window.serviceAuto.settings.pickDataFolder()
    if (!picked.ok || !picked.data) return
    await applyDataPath(picked.data)
  }

  async function handleResetFolder() {
    if (!pathInfo) return
    await applyDataPath(pathInfo.default)
  }

  async function applyDataPath(newPath) {
    setChangingPath(true)
    const res = await window.serviceAuto.settings.changeDataPath(newPath)
    setChangingPath(false)
    if (res.ok) {
      setPathInfo((p) => ({ ...p, current: res.data.path }))
      if (res.data.changed) {
        showToast(
          'success',
          `Fișele au fost copiate în noul folder. Locația veche (${res.data.oldPath}) a rămas neatinsă - o poți șterge manual după ce verifici.`
        )
      }
    } else {
      showToast('error', res.error.message)
    }
  }

  function setField(patch) {
    setSettings((s) => ({ ...s, ...patch }))
  }

  async function handleSave() {
    setSaving(true)
    const res = await window.serviceAuto.settings.save(settings)
    setSaving(false)
    if (res.ok) {
      showToast('success', 'Datele service-ului au fost salvate. Vor apărea pe fișele generate de acum.')
      onClose()
    } else {
      showToast('error', res.error.message)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Datele service-ului</h2>
          <button type="button" className="btn-remove" onClick={onClose}>
            ✕
          </button>
        </div>

        {loading ? (
          <p className="hint">Se încarcă...</p>
        ) : (
          <>
            <p className="hint" style={{ marginBottom: 14 }}>
              Aceste date apar pe antetul fișelor PDF generate, langa datele clientului.
            </p>
            <div className="field" style={{ marginBottom: 12 }}>
              <label>Nume service</label>
              <input
                type="text"
                placeholder="Auto Service SRL"
                value={settings.numeService}
                onChange={(e) => setField({ numeService: e.target.value })}
              />
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label>Adresă</label>
              <input
                type="text"
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
                  placeholder="+373 69 123 456"
                  value={settings.telefon}
                  onChange={(e) => setField({ telefon: e.target.value })}
                />
              </div>
              <div className="field">
                <label>CUI / IDNO</label>
                <input
                  type="text"
                  placeholder="1234567890123"
                  value={settings.cui}
                  onChange={(e) => setField({ cui: e.target.value })}
                />
              </div>
            </div>

            <div className="field" style={{ marginTop: 16, marginBottom: 4 }}>
              <label>Locația fișelor</label>
              <div className="hint" style={{ wordBreak: 'break-all', marginBottom: 8 }}>
                {pathInfo?.current || 'Se încarcă...'}
                {pathInfo && pathInfo.current === pathInfo.default && ' (implicit)'}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" disabled={changingPath} onClick={handlePickFolder}>
                  {changingPath ? 'Se copiază...' : 'Schimbă folderul...'}
                </button>
                {pathInfo && pathInfo.current !== pathInfo.default && (
                  <button type="button" disabled={changingPath} onClick={handleResetFolder}>
                    Resetează la implicit
                  </button>
                )}
              </div>
            </div>

            <div className="release-bar" style={{ marginTop: 18 }}>
              <span />
              <div className="release-bar-actions">
                <button type="button" className="btn-primary" disabled={saving} onClick={handleSave}>
                  {saving ? 'Se salvează...' : 'Salvează'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
