import path from 'path'
import { app, BrowserWindow, utilityProcess } from 'electron'
import { toAppError, AppError } from './errors'
import { getSettings } from './fileStore'
import log from './logger'

// Generarea PDF ruleaza intr-un utilityProcess separat (vezi pdfWorker.js /
// pdfRender.js): layout-ul pdfmake e CPU-intens si pe firul principal inghetea
// UI-ul si tot IPC-ul. Aici ramane doar clientul: porneste worker-ul (lazy sau
// prewarm), trimite cererile, aplica timeout si il reporneste daca moare.
// pdfmake NU se importa in procesul principal (costa ~300ms la pornire).

const REQUEST_TIMEOUT_MS = 30000

// build/fonts in dev, resources/fonts dupa build (vezi extraResources in package.json)
function fontsDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'fonts')
    : path.join(app.getAppPath(), 'build', 'fonts')
}

let child = null
let nextId = 1
const pending = new Map() // id -> { resolve, reject, timer }
// Injectabil pentru teste (utilityProcess nu exista in vitest).
let forkWorker = () => utilityProcess.fork(path.join(__dirname, 'pdfWorker.js'), [], { serviceName: 'pdf-worker' })

export function _setWorkerFactory(fn) {
  forkWorker = fn
}

function failAll(err) {
  for (const [id, p] of pending) {
    clearTimeout(p.timer)
    pending.delete(id)
    p.reject(err)
  }
}

function ensureWorker() {
  if (child) return child
  const proc = forkWorker()
  child = proc
  proc.on('message', (msg) => {
    const p = pending.get(msg?.id)
    if (!p) return
    pending.delete(msg.id)
    clearTimeout(p.timer)
    if (msg.ok) {
      p.resolve(msg.path)
    } else {
      log.error(`[pdfGenerator] worker: ${msg.code} ${msg.detail}`)
      p.reject(new AppError(msg.code || 'UNKNOWN', msg.userMessage || 'Generarea PDF-ului a eșuat.'))
    }
  })
  proc.on('exit', (code) => {
    if (child === proc) child = null // urmatoarea cerere porneste unul nou
    if (pending.size) {
      log.error(`[pdfGenerator] worker oprit neasteptat (cod ${code})`)
      failAll(new AppError('PDF_WORKER_CRASH', 'Generarea PDF-ului a eșuat (procesul de generare s-a oprit). Încearcă din nou.'))
    }
  })
  return proc
}

// Porneste worker-ul din timp (dupa ce fereastra e afisata), fara a genera nimic.
export function prewarmPdfWorker() {
  try {
    ensureWorker()
  } catch (err) {
    log.warn('[pdfGenerator] prewarm esuat', err)
  }
}

export function shutdownPdfWorker() {
  const proc = child
  child = null
  failAll(new AppError('PDF_WORKER_CRASH', 'Generarea PDF-ului a fost oprită.'))
  try {
    proc?.kill()
  } catch {
    /* deja oprit */
  }
}

// Genereaza PDF-ul si il scrie la calea data. Rezolva/respinge cand fisierul
// e complet scris pe disc (temp + rename, in worker).
export async function generatePdf(fisa, destPath) {
  let settings = null
  try {
    settings = await getSettings()
  } catch (err) {
    // Fara datele firmei PDF-ul tot iese, doar cu antetul generic - nu are
    // rost sa blocam generarea documentului pentru asta.
    log.warn('[pdfGenerator] nu s-au putut citi setarile firmei', err)
  }

  return new Promise((resolve, reject) => {
    let proc
    try {
      proc = ensureWorker()
    } catch (err) {
      log.error('[pdfGenerator] worker nepornit', err)
      reject(toAppError(err, 'Generarea PDF-ului a eșuat.'))
      return
    }
    const id = nextId++
    const timer = setTimeout(() => {
      if (!pending.delete(id)) return
      log.error('[pdfGenerator] timeout la generare, repornesc worker-ul')
      // Worker-ul poate fi blocat: il oprim, ramasele cereri esueaza si urmatoarea porneste altul.
      if (child === proc) child = null
      try {
        proc.kill()
      } catch {
        /* deja oprit */
      }
      failAll(new AppError('PDF_WORKER_CRASH', 'Generarea PDF-ului a eșuat (procesul de generare s-a oprit). Încearcă din nou.'))
      reject(new AppError('PDF_TIMEOUT', 'Generarea PDF-ului a durat prea mult. Încearcă din nou.'))
    }, REQUEST_TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })
    try {
      proc.postMessage({ id, fisa, settings, destPath, fontsDir: fontsDir() })
    } catch (err) {
      pending.delete(id)
      clearTimeout(timer)
      reject(toAppError(err, 'Generarea PDF-ului a eșuat.'))
    }
  })
}

// Trimite PDF-ul direct la dialogul de printare, fara sa fie nevoie sa fie
// deschis intr-un viewer extern intai. Foloseste o fereastra ascunsa care
// randeaza PDF-ul (viewer-ul PDF nativ al Chromium trebuie activat explicit
// prin webPreferences.plugins - e dezactivat implicit in Electron).
export function printPdf(pdfPath) {
  return new Promise((resolve, reject) => {
    const printWin = new BrowserWindow({ show: false, webPreferences: { plugins: true, sandbox: true } })

    function cleanup() {
      if (!printWin.isDestroyed()) printWin.destroy()
    }

    // Incarcarea PDF-ului n-are voie sa astepte la nesfarsit (doar dialogul
    // de printare, unde asteapta utilizatorul, ramane fara timeout).
    let loadTimer
    const loadTimeout = new Promise((_, rej) => {
      loadTimer = setTimeout(() => rej(new Error('timeout la incarcarea PDF-ului')), 20000)
    })

    Promise.race([printWin.loadFile(pdfPath), loadTimeout])
      .then(() => {
        clearTimeout(loadTimer)
        printWin.webContents.print({ silent: false, printBackground: true }, (success, errorType) => {
          cleanup()
          if (success) {
            resolve()
          } else if (/cancel/i.test(String(errorType || ''))) {
            // Utilizatorul a inchis dialogul de printare - nu e o eroare. Textul difera
            // dupa versiune/driver ("cancelled", "Print job canceled" etc.), deci potrivim larg.
            resolve()
          } else {
            log.warn(`[pdfGenerator] printare esuata: ${errorType}`)
            reject(toAppError(new Error(errorType), 'Printarea a eșuat.'))
          }
        })
      })
      .catch((err) => {
        clearTimeout(loadTimer)
        cleanup()
        reject(toAppError(err, 'Nu s-a putut deschide PDF-ul pentru printare.'))
      })
  })
}
