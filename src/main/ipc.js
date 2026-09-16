import { ipcMain, shell, app } from 'electron'
import log from './logger'
import { validateFisa } from '../shared/calculations'
import {
  saveDraft,
  loadDraft,
  listDrafts,
  deleteDraft,
  finalizeFisa,
  getFiseDir,
  getPdfPath,
  backupNow,
  isUsingFallbackLocation
} from './fileStore'
import { generatePdf } from './pdfGenerator'
import { checkForUpdatesSafe } from './updater'

// Orice eroare e prinsa aici si transformata intr-un rezultat {ok:false, error}
// serializabil - nu lasam niciodata o exceptie bruta sa traverseze IPC catre UI,
// pentru ca renderer-ul pierde proprietatile custom (code/userMessage) ale erorii.
async function wrap(fn, context) {
  try {
    const data = await fn()
    return { ok: true, data }
  } catch (err) {
    log.error(`[ipc] ${context} esuat`, err)
    return {
      ok: false,
      error: { code: err.code || 'UNKNOWN', message: err.userMessage || err.message || 'Eroare necunoscuta.' }
    }
  }
}

export function registerIpcHandlers() {
  ipcMain.handle('fisa:saveDraft', (e, fisa) => wrap(() => saveDraft(fisa), 'saveDraft'))
  ipcMain.handle('fisa:loadDraft', (e, id) => wrap(() => loadDraft(id), 'loadDraft'))
  ipcMain.handle('fisa:listDrafts', () => wrap(() => listDrafts(), 'listDrafts'))
  ipcMain.handle('fisa:deleteDraft', (e, id) => wrap(() => deleteDraft(id), 'deleteDraft'))

  ipcMain.handle('fisa:validate', (e, fisa) => wrap(() => validateFisa(fisa), 'validate'))

  ipcMain.handle('fisa:finalize', (e, fisa) =>
    wrap(async () => {
      const { valid, errors } = validateFisa(fisa)
      if (!valid) {
        const err = new Error('Fisa contine campuri invalide sau incomplete.')
        err.code = 'VALIDATION'
        err.fields = errors
        throw err
      }

      const { baseName, fisa: finalFisa } = await finalizeFisa(fisa)
      const pdfPath = getPdfPath(baseName)

      try {
        await generatePdf(finalFisa, pdfPath)
        return { fisa: finalFisa, baseName, pdfSaved: true, pdfPath }
      } catch (pdfErr) {
        // JSON-ul e deja salvat cu succes - nu pierdem datele introduse de utilizator
        // chiar daca generarea PDF-ului esueaza. Utilizatorul poate reincerca doar PDF-ul.
        log.error('[ipc] fisa finalizata dar PDF esuat', pdfErr)
        return {
          fisa: finalFisa,
          baseName,
          pdfSaved: false,
          pdfError: pdfErr.userMessage || pdfErr.message
        }
      }
    }, 'finalize')
  )

  ipcMain.handle('fisa:retryPdf', (e, { fisa, baseName }) =>
    wrap(async () => {
      const pdfPath = getPdfPath(baseName)
      await generatePdf(fisa, pdfPath)
      return { pdfSaved: true, pdfPath }
    }, 'retryPdf')
  )

  ipcMain.handle('fise:getLocationInfo', () =>
    wrap(async () => ({ dir: getFiseDir(), usingFallback: isUsingFallbackLocation() }), 'getLocationInfo')
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

  ipcMain.handle('app:checkForUpdates', () =>
    wrap(async () => {
      checkForUpdatesSafe()
      return true
    }, 'checkForUpdates')
  )
}
