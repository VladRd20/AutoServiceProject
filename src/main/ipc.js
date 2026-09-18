import { ipcMain, shell, app, dialog, BrowserWindow } from 'electron'
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
  getFiseDir,
  getPdfPath,
  backupNow,
  isUsingFallbackLocation,
  isMigratedFromLegacy,
  isRecoveredFromSafetyBackup,
  searchFise,
  listRecentFise,
  getAutocompleteData,
  getSettings,
  saveSettings,
  getVehicleHistory,
  getRapoarte,
  getCurrentDataPath,
  getDefaultDataPath,
  changeDataPath
} from './fileStore'
import { generatePdf, printPdf } from './pdfGenerator'
import { checkForUpdatesSafe, downloadUpdateNow, installUpdateNow } from './updater'
import { isActivated, isRevoked, activate } from './license'

// Orice eroare e prinsa aici si transformata intr-un rezultat {ok:false, error}
// serializabil - nu lasam niciodata o exceptie bruta sa traverseze IPC catre UI,
// pentru ca renderer-ul pierde proprietatile custom (code/userMessage) ale erorii.
async function wrap(fn, context) {
  try {
    const data = await fn()
    return { ok: true, data }
  } catch (err) {
    // Erorile "asteptate" (validare, licenta) nu sunt defecte - warn, nu error,
    // ca sa nu acopere problemele reale din loguri.
    const expected = ['VALIDATION', 'NOT_LICENSED', 'REVOKED', 'INVALID_KEY', 'INVALID_ID']
    if (expected.includes(err.code)) log.warn(`[ipc] ${context}: ${err.code}`)
    else log.error(`[ipc] ${context} esuat`, err)
    return {
      ok: false,
      error: { code: err.code || 'UNKNOWN', message: err.userMessage || err.message || 'Eroare necunoscută.' }
    }
  }
}

// Poarta de licenta - gardeaza handlerele "de business" (fise, cautare,
// PDF-uri). Verificarea reala are loc in main process, nu doar in UI, ca
// simpla ascundere a ecranului din renderer sa nu fie suficienta pentru a
// ocoli activarea.
function wrapLicensed(fn, context) {
  return wrap(() => {
    if (!isActivated()) {
      const err = new Error('Aplicația nu este activată. Introdu cheia de licență.')
      err.code = 'NOT_LICENSED'
      throw err
    }
    if (isRevoked()) {
      const err = new Error('Această licență a fost revocată. Contactează dezvoltatorul pentru o cheie nouă.')
      err.code = 'REVOKED'
      throw err
    }
    return fn()
  }, context)
}

export function registerIpcHandlers() {
  ipcMain.handle('license:getStatus', () =>
    wrap(() => ({ activated: isActivated() && !isRevoked(), revoked: isActivated() && isRevoked() }), 'license:getStatus')
  )
  ipcMain.handle('license:activate', (e, key) =>
    wrap(async () => {
      const payload = await activate(key)
      return { activated: true, payload }
    }, 'license:activate')
  )

  ipcMain.handle('fisa:saveDraft', (e, fisa) => wrapLicensed(() => saveDraft(sanitizeFisa(fisa)), 'saveDraft'))
  ipcMain.handle('fisa:loadDraft', (e, id) => wrapLicensed(() => loadDraft(id), 'loadDraft'))
  ipcMain.handle('fisa:listDrafts', () => wrapLicensed(() => listDrafts(), 'listDrafts'))
  ipcMain.handle('fisa:deleteDraft', (e, id) => wrapLicensed(() => deleteDraft(id), 'deleteDraft'))

  ipcMain.handle('fisa:validate', (e, fisa) => wrapLicensed(() => validateFisa(fisa), 'validate'))

  ipcMain.handle('fisa:finalize', (e, fisa) =>
    wrapLicensed(async () => {
      // _replaceBaseName e un camp tehnic adaugat de App.jsx cand fisa vine
      // din "Editeaza" pe o lucrare deja finalizata - nu face parte din
      // datele fisei si nu trebuie validat/persistat ca atare.
      const { _replaceBaseName, ...fisaData } = sanitizeFisa(fisa)
      const { valid, errors } = validateFisa(fisaData)
      if (!valid) {
        const err = new Error('Fișa conține câmpuri invalide sau incomplete.')
        err.code = 'VALIDATION'
        err.fields = errors
        throw err
      }

      const {
        baseName,
        fisa: finalFisa,
        replaced
      } = await finalizeFisa(fisaData, { replaceBaseName: _replaceBaseName })
      const pdfPath = getPdfPath(baseName)

      try {
        await generatePdf(finalFisa, pdfPath)
        return { fisa: finalFisa, baseName, pdfSaved: true, pdfPath, replaced }
      } catch (pdfErr) {
        // JSON-ul e deja salvat cu succes - nu pierdem datele introduse de utilizator
        // chiar daca generarea PDF-ului esueaza. Utilizatorul poate reincerca doar PDF-ul.
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

  ipcMain.handle('fisa:retryPdf', (e, { fisa, baseName }) =>
    wrapLicensed(async () => {
      const pdfPath = getPdfPath(baseName)
      await generatePdf(sanitizeFisa(fisa), pdfPath)
      return { pdfSaved: true, pdfPath }
    }, 'retryPdf')
  )

  ipcMain.handle('fisa:deleteFinalizata', (e, fileName) =>
    wrapLicensed(() => deleteFinalizedFisa(fileName), 'deleteFinalizata')
  )

  ipcMain.handle('fisa:search', (e, query) => wrapLicensed(() => searchFise(query), 'search'))

  ipcMain.handle('fisa:listRecent', (e, limit) => wrapLicensed(() => listRecentFise(limit), 'listRecent'))

  ipcMain.handle('fisa:getAutocompleteData', () =>
    wrapLicensed(() => getAutocompleteData(), 'getAutocompleteData')
  )

  ipcMain.handle('fisa:getVehicleHistory', (e, vin, nrInmatriculare) =>
    wrapLicensed(() => getVehicleHistory(vin, nrInmatriculare), 'getVehicleHistory')
  )

  ipcMain.handle('fisa:getRapoarte', (e, period) => wrapLicensed(() => getRapoarte(period), 'getRapoarte'))

  ipcMain.handle('settings:get', () => wrapLicensed(() => getSettings(), 'settings:get'))
  ipcMain.handle('settings:save', (e, settings) =>
    wrapLicensed(() => saveSettings(settings), 'settings:save')
  )

  ipcMain.handle('settings:getDataPathInfo', () =>
    wrapLicensed(
      () => ({ current: getCurrentDataPath(), default: getDefaultDataPath() }),
      'settings:getDataPathInfo'
    )
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

  ipcMain.handle('fise:openPdf', (e, fileName) =>
    wrapLicensed(async () => {
      const baseName = String(fileName || '').replace(/\.json$/, '')
      const pdfPath = getPdfPath(baseName)
      const result = await shell.openPath(pdfPath)
      if (result) throw new Error(result)
      return pdfPath
    }, 'openPdf')
  )

  ipcMain.handle('fise:printPdf', (e, fileName) =>
    wrapLicensed(async () => {
      const baseName = String(fileName || '').replace(/\.json$/, '')
      await printPdf(getPdfPath(baseName))
      return true
    }, 'printPdf')
  )

  ipcMain.handle('fise:getLocationInfo', () =>
    wrap(
      async () => ({
        dir: getFiseDir(),
        usingFallback: isUsingFallbackLocation(),
        migratedFromLegacy: isMigratedFromLegacy(),
        recoveredFromSafetyBackup: isRecoveredFromSafetyBackup()
      }),
      'getLocationInfo'
    )
  )

  ipcMain.handle('fise:openFolder', () =>
    wrap(async () => {
      const dir = getFiseDir()
      const result = await shell.openPath(dir)
      if (result) throw new Error(result) // shell.openPath returns "" on success, mesaj de eroare altfel
      return dir
    }, 'openFolder')
  )

  ipcMain.handle('backup:now', () => wrap(() => backupNow(), 'backupNow'))

  ipcMain.handle('app:getVersion', () => wrap(() => app.getVersion(), 'getVersion'))

  ipcMain.handle('app:exportLogs', () =>
    wrap(async () => {
      const { destDir, copied } = await exportLogs()
      await shell.openPath(destDir)
      return { destDir, copied }
    }, 'exportLogs')
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

  ipcMain.handle('app:installUpdate', () =>
    wrap(async () => {
      installUpdateNow()
      return true
    }, 'installUpdate')
  )
}
