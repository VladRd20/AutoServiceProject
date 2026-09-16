import { autoUpdater } from 'electron-updater'
import log from './logger'

autoUpdater.logger = log
// Nu descarcam automat - cerem intai acordul utilizatorului printr-un dialog,
// dupa ce gasim o versiune mai noua.
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

let mainWindowRef = null
let checking = false
let downloading = false
let downloaded = false

function sendStatus(type, data) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('update:event', { type, ...data })
  }
}

// Update check: complet best-effort. Orice esec (fara net, GitHub jos, rate-limit)
// e logat si ignorat - aplicatia trebuie sa functioneze normal pe versiunea curenta.
export function initUpdater(mainWindow) {
  mainWindowRef = mainWindow

  autoUpdater.on('error', (err) => {
    log.warn('[updater] verificare/descarcare update esuata (ignorat, aplicatia continua normal)', err)
    sendStatus('error', { message: err?.message })
  })

  autoUpdater.on('checking-for-update', () => sendStatus('checking'))

  autoUpdater.on('update-not-available', () => sendStatus('not-available'))

  autoUpdater.on('update-available', (info) => {
    log.info(`[updater] versiune noua disponibila: ${info.version}`)
    // Anuntat doar prin banner-ul din UI (stilizat, cu buton propriu) - un
    // dialog nativ Windows aici arata neplacut si nu poate fi personalizat.
    sendStatus('available', { version: info.version })
  })

  autoUpdater.on('download-progress', (progress) => {
    sendStatus('progress', { percent: Math.round(progress.percent) })
  })

  autoUpdater.on('update-downloaded', (info) => {
    log.info(`[updater] update ${info.version} descarcat, se ofera restart`)
    downloading = false
    downloaded = true
    // La fel - doar banner-ul din UI, cu butonul lui "Reporneste acum".
    sendStatus('downloaded', { version: info.version })
  })

  checkForUpdatesSafe()
}

export function checkForUpdatesSafe() {
  if (checking) return
  checking = true
  autoUpdater
    .checkForUpdates()
    .catch((err) => {
      log.warn('[updater] checkForUpdates esuat (ignorat)', err)
      sendStatus('error', { message: err?.message })
    })
    .finally(() => {
      checking = false
    })
}

// Declansata din butonul "Descarca" al banner-ului din UI - idempotenta,
// nu porneste o a doua descarcare daca una e deja in curs.
export function downloadUpdateNow() {
  if (downloading || downloaded) return
  downloading = true
  sendStatus('downloading')
  autoUpdater.downloadUpdate().catch((err) => {
    downloading = false
    log.warn('[updater] downloadUpdate esuat', err)
    sendStatus('error', { message: err?.message })
  })
}

export function installUpdateNow() {
  if (!downloaded) return
  autoUpdater.quitAndInstall()
}
