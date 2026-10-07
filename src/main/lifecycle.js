import { flushBackup } from './fileStore'
import { runExclusive } from './store/io'
import log from './logger'

// Inchiderea aplicatiei trebuie sa nu piarda ultimele modificari: inainte ca
// fereastra sa se inchida, cerem renderer-ului sa salveze imediat draftul
// curent (autosave-ul e cu debounce), asteptam confirmarea (cu timeout, ca un
// renderer blocat sa nu tina aplicatia deschisa la nesfarsit), apoi rulam un
// ultim backup.
const FLUSH_TIMEOUT_MS = 4000

let win = null
let seq = 0
const pending = new Map()

export function attachWindow(w) {
  win = w
}

// Apelat din handler-ul ipcMain.on('app:flushDone').
export function handleFlushDone(id) {
  pending.get(id)?.()
}

export function requestRendererFlush(timeoutMs = FLUSH_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const wc = win && !win.isDestroyed() ? win.webContents : null
    if (!wc || wc.isDestroyed() || wc.isCrashed()) return resolve(false)
    const id = ++seq
    const timer = setTimeout(() => {
      pending.delete(id)
      log.warn('[lifecycle] renderer-ul nu a confirmat salvarea la timp')
      resolve(false)
    }, timeoutMs)
    pending.set(id, () => {
      clearTimeout(timer)
      pending.delete(id)
      resolve(true)
    })
    try {
      wc.send('app:flush', id)
    } catch (err) {
      clearTimeout(timer)
      pending.delete(id)
      log.warn('[lifecycle] trimiterea cererii de salvare a esuat', err)
      resolve(false)
    }
  })
}

export async function flushEverything() {
  await requestRendererFlush()
  // O finalizare aflata in curs trebuie sa se termine INAINTE de ultimul backup.
  await runExclusive('fise-write', async () => {})
  await flushBackup()
}

// Amana inchiderea ferestrei pana dupa flush. Idempotent: inchideri repetate
// (dublu-click pe X, Alt+F4 + quit) nu declanseaza flush-uri suprapuse.
export function guardWindowClose(w) {
  let closing = false
  // Consumat exact o singura data, de catre propriul nostru w.close() de mai
  // jos - NU resetat dupa un timp fix. Evenimentul nativ 'close' al Electron
  // nu e garantat sincron cu apelul w.close() (poate ajunge pe urmatorul tick
  // prin bucla de mesaje a OS-ului); daca am reseta flagul imediat dupa ce
  // chemam w.close(), acel 'close' intarziat ar fi tratat ca o inchidere noua
  // a utilizatorului si am relua flush-ul la nesfarsit (fereastra nu s-ar mai
  // inchide niciodata).
  let forcedClose = false
  w.on('close', (event) => {
    if (forcedClose) {
      forcedClose = false
      return
    }
    event.preventDefault()
    if (closing) return
    closing = true
    flushEverything()
      .catch((err) => log.error('[lifecycle] flush la inchidere esuat', err))
      .finally(() => {
        closing = false
        // Daca inchiderea a fost oprita (utilizatorul a ales "Raman" la avertismentul
        // de modificari nesalvate), garda trebuie sa functioneze si la urmatoarea inchidere.
        if (!w.isDestroyed()) {
          forcedClose = true
          w.close()
        }
      })
  })
}
