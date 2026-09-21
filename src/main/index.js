import { app, shell, BrowserWindow, dialog, nativeTheme } from 'electron'
import path from 'path'
import { is } from '@electron-toolkit/utils'
import log, { setMainWindow } from './logger'
import { ensureDirs, backupNow } from './fileStore'
import { registerIpcHandlers } from './ipc'
import { initUpdater } from './updater'
import { checkRevocationOnline, isRevoked, warmFingerprint } from './license'
import { attachWindow, guardWindowClose } from './lifecycle'

let mainWindow = null
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000 // o data pe zi
const REVOCATION_RECHECK_MS = 24 * 60 * 60 * 1000

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    minWidth: 900,
    minHeight: 650,
    show: false,
    autoHideMenuBar: true,
    // Bara de titlu proprie (in aplicatie, in tema ei); Windows deseneaza doar butoanele
    // ferestrei (overlay). Culorile initiale urmeaza tema sistemului; aplicatia le
    // ajusteaza imediat dupa incarcare (TitleBar.jsx) si la schimbarea temei.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: nativeTheme.shouldUseDarkColors ? '#101216' : '#1f2430',
      symbolColor: '#e5e7eb',
      height: 36
    },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#101216' : '#1f2430',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  // Inchiderea asteapta salvarea draftului curent + un ultim backup.
  attachWindow(mainWindow)
  guardWindowClose(mainWindow)

  // Renderer-ul blocheaza inchiderea (beforeunload) doar cand are modificari
  // NESALVATE (salvarea a esuat): fara acest handler Electron ar ignora tacit
  // inchiderea si aplicatia nu s-ar mai putea inchide deloc. Lasam utilizatorul sa decida.
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Rămân în aplicație', 'Închid oricum'],
      defaultId: 0,
      cancelId: 0,
      title: 'Modificări nesalvate',
      message: 'Ultimele modificări nu au putut fi salvate (disc plin sau folder blocat).',
      detail: 'Dacă închizi acum, aceste modificări se pierd.'
    })
    if (choice === 1) event.preventDefault() // ignora beforeunload => inchiderea continua
  })

  // Un crash al procesului de randare nu trebuie sa lase o fereastra alba:
  // draftul e salvat pe disc de autosave, deci reincarcam pagina.
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log.error(`[main] renderer oprit: ${details.reason}`)
    if (details.reason !== 'clean-exit' && mainWindow && !mainWindow.isDestroyed()) mainWindow.reload()
  })

  // Linkurile externe se deschid in browser, nu in fereastra aplicatiei
  mainWindow.webContents.setWindowOpenHandler((details) => {
    // Doar https - nu lasam un link sa deschida protocoale arbitrare
    // (file:, ms-msdt:, etc) prin shell.
    if (/^https:\/\//i.test(details.url)) shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Fereastra principala nu navigheaza niciodata in afara aplicatiei.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = is.dev && process.env['ELECTRON_RENDERER_URL'] ? url.startsWith(process.env['ELECTRON_RENDERER_URL']) : url.startsWith('file://')
    if (!allowed) {
      event.preventDefault()
      if (/^https:\/\//i.test(url)) shell.openExternal(url)
    }
  })

  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    log.error(`[main] pagina nu s-a incarcat: ${code} ${desc}`)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// O singura instanta: doua procese pe acelasi folder de date ar avea cache-uri
// separate si autosave-uri care se calca reciproc.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return

  app.setAppUserModelId('com.serviceauto.app')

  try {
    await ensureDirs()
  } catch (err) {
    // Fara foldere de date, aplicatia nu poate functiona in siguranta.
    log.error('[main] initializare foldere esuata', err)
    dialog.showErrorBox(
      'Nu s-a putut porni aplicația',
      err.userMessage || 'Nu s-a putut crea folderul de date. Verifică permisiunile de scriere pe disc.'
    )
    app.quit()
    return
  }

  // Citeste MachineGuid asincron, o singura data, inainte de prima verificare
  // de licenta - altfel execSync bloca procesul principal la pornire.
  await warmFingerprint()

  registerIpcHandlers()
  createWindow()
  setMainWindow(mainWindow)
  initUpdater(mainWindow)

  // Best-effort, o singura data la pornire - daca gaseste id-ul curent in
  // lista publica de revocari, anunta imediat renderer-ul (altfel ramanea
  // ascuns pana la urmatoarea actiune care da eroare REVOKED prin IPC).
  function recheckRevocation() {
    checkRevocationOnline().then(() => {
      if (isRevoked() && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('license:revoked')
      }
    })
  }
  recheckRevocation()
  // O aplicatie lasata deschisa zile in sir trebuie sa prinda si ea o
  // revocare aparuta intre timp, nu doar la urmatoarea pornire.
  setInterval(recheckRevocation, REVOCATION_RECHECK_MS)

  // Backup zilnic, best-effort - nu blocheaza si nu opreste aplicatia daca esueaza.
  backupNow().catch((err) => log.warn('[main] backup initial esuat', err))
  setInterval(() => {
    backupNow().catch((err) => log.warn('[main] backup periodic esuat', err))
  }, BACKUP_INTERVAL_MS)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
