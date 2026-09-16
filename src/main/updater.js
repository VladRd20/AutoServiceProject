import { autoUpdater } from 'electron-updater'
import { dialog } from 'electron'
import log from './logger'

autoUpdater.logger = log
// Nu descarcam automat - cerem intai acordul utilizatorului printr-un dialog,
// dupa ce gasim o versiune mai noua.
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

let mainWindowRef = null
let checking = false

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
    sendStatus('available', { version: info.version })

    dialog
      .showMessageBox(mainWindowRef, {
        type: 'info',
        title: 'Actualizare disponibila',
        message: `Este disponibila versiunea ${info.version}.`,
        detail: 'Poti continua sa lucrezi cat timp se descarca in fundal.',
        buttons: ['Descarca acum', 'Mai tarziu'],
        defaultId: 0,
        cancelId: 1
      })
      .then(({ response }) => {
        if (response !== 0) return
        sendStatus('downloading')
        autoUpdater.downloadUpdate().catch((err) => {
          log.warn('[updater] downloadUpdate esuat', err)
          sendStatus('error', { message: err?.message })
        })
      })
      .catch((err) => log.warn('[updater] dialog update-available esuat', err))
  })

  autoUpdater.on('download-progress', (progress) => {
    sendStatus('progress', { percent: Math.round(progress.percent) })
  })

  autoUpdater.on('update-downloaded', (info) => {
    log.info(`[updater] update ${info.version} descarcat, se ofera restart`)
    sendStatus('downloaded', { version: info.version })

    dialog
      .showMessageBox(mainWindowRef, {
        type: 'info',
        title: 'Actualizare gata de instalare',
        message: `A fost descarcata versiunea ${info.version}. Repornesti aplicatia acum pentru a o instala?`,
        buttons: ['Repornire acum', 'Mai tarziu'],
        defaultId: 0,
        cancelId: 1
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall()
      })
      .catch((err) => log.warn('[updater] dialog update-downloaded esuat', err))
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
