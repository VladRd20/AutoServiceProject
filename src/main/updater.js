import { autoUpdater } from 'electron-updater'
import log from './logger'
import { flushEverything } from './lifecycle'
import { getAutoUpdate, setAutoUpdate } from './appConfig'

autoUpdater.logger = log
// Nu descarcam automat - cerem intai acordul utilizatorului printr-un dialog,
// dupa ce gasim o versiune mai noua.
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

// Preferinta "actualizari automate": cand e pornita, o versiune noua se descarca
// singura, in fundal, si se instaleaza la urmatoarea INCHIDERE a aplicatiei
// (dupa salvarea draftului) - fara nicio intrerupere in timpul lucrului.
export function isAutoUpdateEnabled() {
  return getAutoUpdate()
}

export function setAutoUpdateEnabled(enabled) {
  setAutoUpdate(enabled)
  autoUpdater.autoDownload = Boolean(enabled)
  autoUpdater.autoInstallOnAppQuit = true
  // Daca acum e deja o versiune disponibila, o luam imediat.
  if (enabled) checkForUpdatesSafe()
}

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
  autoUpdater.autoDownload = getAutoUpdate()

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
    const notes = typeof info.releaseNotes === 'string' ? info.releaseNotes.replace(/<[^>]*>/g, '').trim().slice(0, 600) : ''
    sendStatus('available', { version: info.version, notes })
  })

  autoUpdater.on('download-progress', (progress) => {
    downloading = true
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

// Salveaza draftul curent si face un ultim backup INAINTE de a inchide
// aplicatia pentru instalare - un update nu trebuie sa piarda munca in curs.
export async function installUpdateNow() {
  if (!downloaded) return
  await flushEverything().catch((err) => log.error('[updater] flush inainte de instalare esuat', err))
  autoUpdater.quitAndInstall()
}
