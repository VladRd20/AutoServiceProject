import { app, shell, BrowserWindow } from 'electron'
import path from 'path'
import { is } from '@electron-toolkit/utils'
import log from './logger'
import { ensureDirs, backupNow } from './fileStore'
import { registerIpcHandlers } from './ipc'
import { initUpdater } from './updater'

let mainWindow = null
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000 // o data pe zi

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    minWidth: 900,
    minHeight: 650,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  // Linkurile externe se deschid in browser, nu in fereastra aplicatiei
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
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

app.whenReady().then(async () => {
  app.setAppUserModelId('com.serviceauto.app')

  try {
    await ensureDirs()
  } catch (err) {
    // Fara foldere de date, aplicatia nu poate functiona in siguranta.
    log.error('[main] initializare foldere esuata', err)
    const { dialog } = await import('electron')
    dialog.showErrorBox(
      'Nu s-a putut porni aplicatia',
      err.userMessage || 'Nu s-a putut crea folderul de date. Verifica permisiunile de scriere pe disc.'
    )
    app.quit()
    return
  }

  registerIpcHandlers()
  createWindow()
  initUpdater()

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
