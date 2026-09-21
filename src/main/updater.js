import { autoUpdater } from 'electron-updater'
import log from './logger'
import { flushEverything } from './lifecycle'
import { getAutoUpdate, setAutoUpdate } from './appConfig'
import { createUpdatePoller } from './updatePoller'

autoUpdater.logger = log
// Nu descarcam automat (decat daca utilizatorul a bifat "Actualizari automate" in
// Setari): cerem intai acordul, printr-un banner in aplicatie, cand gasim o versiune noua.
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

let mainWindowRef = null
let checking = false
let checkIsManual = false
let downloading = false
let downloaded = false

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

// Toate evenimentele poarta `manual`: interfata arata "Se verifica..." / "Esti la zi" /
// erori DOAR pentru verificarile cerute de utilizator; cele periodice sunt silentioase
// si apar in UI doar cand gasesc ceva (banner "Versiune noua").
function sendStatus(type, data) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('update:event', { type, manual: checkIsManual, ...data })
  }
}

// Verificarea periodica: la 10 min (+/- 1 min), cu backoff la esec, cu verificare
// imediata la revenirea pe fereastra (max o data la 5 min) si oprita cand exista deja
// o versiune noua. Vezi updatePoller.js.
const poller = createUpdatePoller({
  check: () => runCheck(false)
})

// Intoarce true = verificarea s-a putut face (chiar daca nu exista nimic nou).
async function runCheck(manual) {
  if (checking || downloading || downloaded) return true
  checking = true
  checkIsManual = manual
  try {
    await autoUpdater.checkForUpdates()
    return true
  } catch (err) {
    log.warn('[updater] checkForUpdates esuat (ignorat)', err)
    if (manual) sendStatus('error', { message: err?.message })
    return false
  } finally {
    checking = false
  }
}

// Update check: complet best-effort. Orice esec (fara net, GitHub jos, rate-limit)
// e logat si ignorat - aplicatia trebuie sa functioneze normal pe versiunea curenta.
export function initUpdater(mainWindow) {
  mainWindowRef = mainWindow
  autoUpdater.autoDownload = getAutoUpdate()

  autoUpdater.on('error', (err) => {
    log.warn('[updater] verificare/descarcare update esuata (ignorat, aplicatia continua normal)', err)
    // erorile verificarilor periodice nu se arata; cele de la descarcare si cele cerute manual, da
    if (checkIsManual || downloading) sendStatus('error', { message: err?.message })
  })

  autoUpdater.on('checking-for-update', () => sendStatus('checking'))

  autoUpdater.on('update-not-available', () => sendStatus('not-available'))

  autoUpdater.on('update-available', (info) => {
    log.info(`[updater] versiune noua disponibila: ${info.version}`)
    poller.pause() // am gasit-o - nu mai intrebam pana o instaleaza
    // Anuntat prin banner-ul din UI (stilizat, cu buton propriu), nu printr-un dialog nativ.
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
    poller.pause()
    sendStatus('downloaded', { version: info.version })
  })

  // Prima verificare la pornire (tacuta), apoi periodic.
  runCheck(false).finally(() => poller.start({ initialCheckDone: true }))

  // Revenirea pe fereastra dupa o pauza lunga = moment bun pentru o verificare
  // (fara sa depaseasca frecventa: maxim o data la 5 min).
  mainWindow.on('focus', () => poller.nudge())
}

// Verificarea ceruta de utilizator (buton din Setari): da feedback in UI.
export function checkForUpdatesSafe(manual = false) {
  runCheck(manual).catch(() => {})
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
    poller.resume() // descarcarea a esuat: reluam verificarile periodice
  })
}

// Salveaza draftul curent si face un ultim backup INAINTE de a inchide
// aplicatia pentru instalare - un update nu trebuie sa piarda munca in curs.
export async function installUpdateNow() {
  if (!downloaded) return
  await flushEverything().catch((err) => log.error('[updater] flush inainte de instalare esuat', err))
  autoUpdater.quitAndInstall()
}
