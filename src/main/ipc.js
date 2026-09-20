import { ipcMain, shell, app, dialog, BrowserWindow } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import log, { exportLogs } from './logger'
import { validateFisa } from '../shared/calculations'
import { sanitizeFisa } from './sanitize'
import {
  saveDraft,
  loadDraft,
  listDrafts,
  deleteDraft,
  finalizeFisa,
  deleteFinalizedFisa,
  listTrash,
  restoreFromTrash,
  readFisaByBaseName,
  getFiseDir,
  getPdfPath,
  backupNow,
  exportBackup,
  importBackup,
  getBackupStatus,
  isUsingFallbackLocation,
  isMigratedFromLegacy,
  isRecoveredFromSafetyBackup,
  storeState,
  searchFise,
  listRecentFise,
  getAutocompleteData,
  getSettings,
  saveSettings,
  getVehicleHistory,
  getRapoarte,
  exportFiseCsv,
  getCurrentDataPath,
  getDefaultDataPath,
  changeDataPath
} from './fileStore'
import { generatePdf, printPdf } from './pdfGenerator'
import {
  checkForUpdatesSafe,
  downloadUpdateNow,
  installUpdateNow,
  isAutoUpdateEnabled,
  setAutoUpdateEnabled
} from './updater'
import { isActivated, isRevoked, activate } from './license'
import { handleFlushDone } from './lifecycle'
import { getLastSeenVersion, setLastSeenVersion } from './appConfig'
import { entriesToShow, recentEntries } from '../shared/whatsNew'

// Erorile "asteptate" (validare, licenta, input gresit) nu sunt defecte -
// warn, nu error, ca sa nu acopere problemele reale din loguri.
const EXPECTED = new Set([
  'VALIDATION',
  'NOT_LICENSED',
  'REVOKED',
  'INVALID_KEY',
  'INVALID_ID',
  'INVALID_PATH',
  'NOT_FOUND',
  'BAD_BACKUP'
])

// Orice eroare e prinsa aici si transformata intr-un rezultat {ok:false, error}
// serializabil - nu lasam niciodata o exceptie bruta sa traverseze IPC catre UI,
// pentru ca renderer-ul pierde proprietatile custom (code/userMessage) ale erorii.
async function wrap(fn, context) {
  try {
    const data = await fn()
    return { ok: true, data }
  } catch (err) {
    if (EXPECTED.has(err?.code)) log.warn(`[ipc] ${context}: ${err.code}`)
    else log.error(`[ipc] ${context} esuat`, err)
    return {
      ok: false,
      error: { code: err?.code || 'UNKNOWN', message: err?.userMessage || err?.message || 'Eroare necunoscută.' }
    }
  }
}

function licenseError(code, message) {
  const err = new Error(message)
  err.code = code
  return err
}

// Poarta de licenta - gardeaza handlerele "de business". Verificarea reala are
// loc in main process, nu doar in UI.
// readOnlyOk: operatii de CITIRE/export/tiparire - raman disponibile si dupa
// revocarea licentei (mod doar-citire): clientul isi poate accesa oricand
// propriile fise, chiar daca nu mai poate crea altele noi.
function wrapLicensed(fn, context, { readOnlyOk = false } = {}) {
  return wrap(() => {
    if (!isActivated()) throw licenseError('NOT_LICENSED', 'Aplicația nu este activată. Introdu cheia de licență.')
    if (isRevoked() && !readOnlyOk) {
      throw licenseError(
        'REVOKED',
        'Această licență a fost revocată - aplicația este în mod doar-citire. Contactează dezvoltatorul pentru o cheie nouă.'
      )
    }
    return fn()
  }, context)
}

const readOnly = (fn, context) => wrapLicensed(fn, context, { readOnlyOk: true })

// PDF-ul lipseste (sters de antivirus/manual, sau fisa restaurata din backup):
// se regenereaza din JSON in loc sa dea eroare "fisier negasit".
async function ensurePdf(baseName) {
  const pdfPath = getPdfPath(baseName)
  try {
    const [pdf, json] = await Promise.all([fs.stat(pdfPath), fs.stat(pdfPath.replace(/\.pdf$/, '.json'))])
    // PDF-ul mai vechi decat JSON-ul e invechit (ex: editare cand PDF-ul era blocat de
    // un viewer) - il regeneram, ca sa nu se tipareasca o factura care nu corespunde datelor.
    if (pdf.size > 0 && pdf.mtimeMs >= json.mtimeMs) return pdfPath
  } catch {
    /* lipseste - il regeneram */
  }
  const fisa = await readFisaByBaseName(baseName)
  await generatePdf(fisa, pdfPath)
  return pdfPath
}

const baseNameOf = (fileName) => String(fileName || '').replace(/\.json$/, '')

const stamp = () => new Date().toISOString().slice(0, 10)

export function registerIpcHandlers() {
  ipcMain.handle('license:getStatus', () =>
    wrap(() => {
      const activated = isActivated()
      const revoked = activated && isRevoked()
      return { activated: activated && !revoked, revoked, readOnly: revoked }
    }, 'license:getStatus')
  )
  ipcMain.handle('license:activate', (e, key) =>
    wrap(async () => {
      const payload = await activate(key)
      return { activated: true, payload }
    }, 'license:activate')
  )

  // ---- fise in lucru ----
  ipcMain.handle('fisa:saveDraft', (e, fisa) => wrapLicensed(() => saveDraft(sanitizeFisa(fisa)), 'saveDraft'))
  ipcMain.handle('fisa:loadDraft', (e, id) => readOnly(() => loadDraft(id), 'loadDraft'))
  ipcMain.handle('fisa:listDrafts', () => readOnly(() => listDrafts(), 'listDrafts'))
  ipcMain.handle('fisa:deleteDraft', (e, id) => wrapLicensed(() => deleteDraft(id), 'deleteDraft'))

  // ---- finalizare ----
  ipcMain.handle('fisa:finalize', (e, fisa) =>
    wrapLicensed(async () => {
      // Validam fisa BRUTA (inainte de sanitize, care trunchiaza): un text
      // prea lung e respins cu mesaj clar, nu taiat in tacere.
      const raw = fisa && typeof fisa === 'object' ? fisa : {}
      const { valid, errors } = validateFisa(raw)
      if (!valid) {
        const err = new Error('Fișa conține câmpuri invalide sau incomplete.')
        err.code = 'VALIDATION'
        err.fields = errors
        throw err
      }
      // _replaceBaseName e un camp tehnic (fisa vine din "Editeaza") - nu face
      // parte din datele fisei si nu se persista ca atare.
      const { _replaceBaseName, ...fisaData } = sanitizeFisa(raw)

      const { baseName, fisa: finalFisa, replaced } = await finalizeFisa(fisaData, { replaceBaseName: _replaceBaseName })

      try {
        const pdfPath = getPdfPath(baseName)
        await generatePdf(finalFisa, pdfPath)
        return { fisa: finalFisa, baseName, pdfSaved: true, pdfPath, replaced }
      } catch (pdfErr) {
        // JSON-ul e deja salvat - nu pierdem datele chiar daca PDF-ul esueaza.
        // PDF-ul se regenereaza oricand din JSON (retryPdf / la deschidere).
        log.error('[ipc] fisa finalizata dar PDF esuat', pdfErr)
        return {
          fisa: finalFisa,
          baseName,
          pdfSaved: false,
          pdfError: pdfErr.userMessage || pdfErr.message,
          replaced
        }
      }
    }, 'finalize')
  )

  ipcMain.handle('fisa:retryPdf', (e, payload) =>
    wrapLicensed(async () => {
      // Regeneram din ce e salvat pe DISC (sursa de adevar), nu din datele
      // trimise de UI.
      const baseName = baseNameOf(payload?.baseName)
      const fisa = await readFisaByBaseName(baseName)
      const pdfPath = getPdfPath(baseName)
      await generatePdf(fisa, pdfPath)
      return { pdfSaved: true, pdfPath }
    }, 'retryPdf')
  )

  // ---- stergere (coș) ----
  ipcMain.handle('fisa:deleteFinalizata', (e, fileName) =>
    wrapLicensed(() => deleteFinalizedFisa(fileName), 'deleteFinalizata')
  )
  ipcMain.handle('trash:list', () => readOnly(() => listTrash(), 'trash:list'))
  ipcMain.handle('trash:restore', (e, trashId) => wrapLicensed(() => restoreFromTrash(trashId), 'trash:restore'))

  // ---- cautare / rapoarte ----
  ipcMain.handle('fisa:search', (e, query, range) =>
    readOnly(() => searchFise(String(query ?? '').slice(0, 200), range), 'search')
  )
  ipcMain.handle('fisa:listRecent', (e, limit) => readOnly(() => listRecentFise(limit), 'listRecent'))
  ipcMain.handle('fisa:getAutocompleteData', () => readOnly(() => getAutocompleteData(), 'getAutocompleteData'))
  ipcMain.handle('fisa:getVehicleHistory', (e, vin, nrInmatriculare) =>
    readOnly(() => getVehicleHistory(String(vin ?? ''), String(nrInmatriculare ?? '')), 'getVehicleHistory')
  )
  ipcMain.handle('fisa:getRapoarte', (e, period, range) =>
    readOnly(() => getRapoarte(period, range), 'getRapoarte')
  )

  ipcMain.handle('fisa:exportCsv', (e, period, range) =>
    readOnly(async () => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const { csv, count } = await exportFiseCsv(period, range)
      const res = await dialog.showSaveDialog(win, {
        title: 'Exportă fișele (CSV)',
        defaultPath: path.join(app.getPath('documents'), `fise-${String(period || 'tot').replace(/[^a-z]/gi, '')}-${stamp()}.csv`),
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      })
      if (res.canceled || !res.filePath) return null
      await fs.writeFile(res.filePath, csv, 'utf-8')
      return { path: res.filePath, count }
    }, 'exportCsv')
  )

  // ---- setari ----
  ipcMain.handle('settings:get', () => readOnly(() => getSettings(), 'settings:get'))
  ipcMain.handle('settings:save', (e, settings) => wrapLicensed(() => saveSettings(settings), 'settings:save'))

  ipcMain.handle('settings:getDataPathInfo', () =>
    readOnly(() => ({ current: getCurrentDataPath(), default: getDefaultDataPath() }), 'settings:getDataPathInfo')
  )

  ipcMain.handle('settings:pickDataFolder', async (e) =>
    wrapLicensed(async () => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Alege folderul pentru fișele de service'
      })
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    }, 'settings:pickDataFolder')
  )

  ipcMain.handle('settings:changeDataPath', (e, newPath) =>
    wrapLicensed(() => changeDataPath(newPath), 'settings:changeDataPath')
  )

  // ---- PDF ----
  ipcMain.handle('fise:openPdf', (e, fileName) =>
    readOnly(async () => {
      const pdfPath = await ensurePdf(baseNameOf(fileName))
      const result = await shell.openPath(pdfPath)
      if (result) throw new Error(result)
      return pdfPath
    }, 'openPdf')
  )

  ipcMain.handle('fise:printPdf', (e, fileName) =>
    readOnly(async () => {
      await printPdf(await ensurePdf(baseNameOf(fileName)))
      return true
    }, 'printPdf')
  )

  // ---- locatie / stare date ----
  ipcMain.handle('fise:getLocationInfo', () =>
    wrap(async () => {
      const q = storeState.quarantined
      return {
        dir: getFiseDir(),
        usingFallback: isUsingFallbackLocation(),
        overrideUnavailable: storeState.overrideUnavailable,
        migratedFromLegacy: isMigratedFromLegacy(),
        recoveredFromSafetyBackup: isRecoveredFromSafetyBackup(),
        healedFise: storeState.healedFise,
        mergedBackFromTemp: storeState.mergedBackFromTemp,
        quarantinedRestored: q.filter((x) => x.restored).length,
        quarantinedLost: q.filter((x) => !x.restored).length
      }
    }, 'getLocationInfo')
  )

  ipcMain.handle('fise:openFolder', () =>
    wrap(async () => {
      const dir = getFiseDir()
      const result = await shell.openPath(dir)
      if (result) throw new Error(result) // openPath intoarce "" la succes, mesajul de eroare altfel
      return dir
    }, 'openFolder')
  )

  // ---- backup ----
  ipcMain.handle('backup:now', () => wrap(() => backupNow(), 'backupNow'))
  ipcMain.handle('backup:status', () => wrap(() => getBackupStatus(), 'backup:status'))

  ipcMain.handle('backup:export', (e) =>
    readOnly(async () => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const res = await dialog.showSaveDialog(win, {
        title: 'Salvează backup',
        defaultPath: path.join(app.getPath('documents'), `ServiceAuto-backup-${stamp()}.json`),
        filters: [{ name: 'Backup Service Auto', extensions: ['json'] }]
      })
      if (res.canceled || !res.filePath) return null
      return exportBackup(res.filePath)
    }, 'backup:export')
  )

  // source: 'dialog' (fisier ales de utilizator) sau 'latest' (cel mai recent
  // snapshot automat). Renderer-ul NU poate trimite o cale arbitrara.
  ipcMain.handle('backup:import', (e, source) =>
    wrapLicensed(async () => {
      let file
      if (source === 'latest') {
        file = (await getBackupStatus()).latestSnapshotPath
        if (!file) throw Object.assign(new Error('Nu există niciun snapshot automat.'), { code: 'NOT_FOUND' })
      } else {
        const win = BrowserWindow.fromWebContents(e.sender)
        const res = await dialog.showOpenDialog(win, {
          title: 'Alege fișierul de backup',
          properties: ['openFile'],
          filters: [{ name: 'Backup Service Auto', extensions: ['json'] }]
        })
        if (res.canceled || res.filePaths.length === 0) return null
        file = res.filePaths[0]
      }
      return importBackup(file)
    }, 'backup:import')
  )

  // ---- aplicatie ----
  ipcMain.on('app:flushDone', (e, id) => handleFlushDone(id))

  // "Ce e nou": mode 'unseen' = ce nu a vazut inca (o instalare NOUA, fara nicio fisa,
  // nu primeste fereastra - o marcam ca vazuta), 'recent' = ultimele intrari (meniu).
  ipcMain.handle('app:getWhatsNew', (e, mode) =>
    wrap(async () => {
      const current = app.getVersion()
      if (mode === 'recent') return { current, entries: recentEntries(current, 5) }
      const lastSeen = getLastSeenVersion()
      if (!lastSeen) {
        const fresh = (await listRecentFise(1)).length === 0 && (await listDrafts()).length === 0
        if (fresh) {
          setLastSeenVersion(current)
          return { current, entries: [] }
        }
      }
      return { current, entries: entriesToShow(current, lastSeen) }
    }, 'getWhatsNew')
  )
  ipcMain.handle('app:markWhatsNewSeen', () =>
    wrap(() => {
      setLastSeenVersion(app.getVersion())
      return true
    }, 'markWhatsNewSeen')
  )

  ipcMain.handle('app:getVersion', () => wrap(() => app.getVersion(), 'getVersion'))

  ipcMain.handle('app:exportLogs', () =>
    wrap(async () => {
      const { destDir, copied } = await exportLogs()
      await shell.openPath(destDir)
      return { destDir, copied }
    }, 'exportLogs')
  )

  ipcMain.handle('app:getAutoUpdate', () => wrap(() => isAutoUpdateEnabled(), 'getAutoUpdate'))
  ipcMain.handle('app:setAutoUpdate', (e, enabled) =>
    wrap(() => {
      setAutoUpdateEnabled(enabled === true)
      return isAutoUpdateEnabled()
    }, 'setAutoUpdate')
  )

  ipcMain.handle('app:checkForUpdates', () =>
    wrap(async () => {
      checkForUpdatesSafe()
      return true
    }, 'checkForUpdates')
  )

  ipcMain.handle('app:downloadUpdate', () =>
    wrap(async () => {
      downloadUpdateNow()
      return true
    }, 'downloadUpdate')
  )

  // Salveaza tot INAINTE de instalare - installUpdateNow asteapta flush-ul.
  ipcMain.handle('app:installUpdate', () =>
    wrap(async () => {
      await installUpdateNow()
      return true
    }, 'installUpdate')
  )
}
