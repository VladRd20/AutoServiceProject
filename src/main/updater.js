import { autoUpdater } from 'electron-updater'
import { dialog } from 'electron'
import log from './logger'

autoUpdater.logger = log
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true

let checking = false

// Update check: complet best-effort. Orice esec (fara net, GitHub jos, rate-limit)
// e logat si ignorat - aplicatia trebuie sa functioneze normal pe versiunea curenta.
export function initUpdater() {
  autoUpdater.on('error', (err) => {
    log.warn('[updater] verificare/descarcare update esuata (ignorat, aplicatia continua normal)', err)
  })

  autoUpdater.on('update-downloaded', (info) => {
    log.info(`[updater] update ${info.version} descarcat, se ofera restart`)
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Actualizare disponibila',
        message: `A fost descarcata versiunea ${info.version}. Repornesti aplicatia acum pentru a o instala?`,
        buttons: ['Repornire acum', 'Mai tarziu'],
        defaultId: 0,
        cancelId: 1
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall()
      })
      .catch((err) => log.warn('[updater] dialog update esuat', err))
  })

  checkForUpdatesSafe()
}

export function checkForUpdatesSafe() {
  if (checking) return
  checking = true
  autoUpdater
    .checkForUpdates()
    .catch((err) => log.warn('[updater] checkForUpdates esuat (ignorat)', err))
    .finally(() => {
      checking = false
    })
}
