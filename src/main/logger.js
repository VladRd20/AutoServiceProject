import log from 'electron-log/main'
import path from 'path'
import fs from 'fs/promises'
import { app } from 'electron'

log.initialize()
log.transports.file.level = 'info'
log.transports.file.maxSize = 5 * 1024 * 1024 // 5MB, apoi roteste
log.transports.console.level = 'debug'

// Prinde orice eroare neasteptata (nu ar trebui sa ajunga aici in mod normal,
// e ultima plasa de siguranta) - se logheaza, aplicatia NU se opreste.
process.on('uncaughtException', (err) => {
  log.error('[uncaughtException]', err)
})
process.on('unhandledRejection', (reason) => {
  log.error('[unhandledRejection]', reason)
})

// Copiaza fisierele de log (inclusiv cele vechi, rotite) intr-un folder pe
// Desktop, ca utilizatorul sa le poata trimite manual (WhatsApp/email) pentru
// debugging la distanta - nimic nu paraseste automat calculatorul clientului.
export async function exportLogs() {
  const currentLogFile = log.transports.file.getFile().path
  const logsDir = path.dirname(currentLogFile)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const destDir = path.join(app.getPath('desktop'), `ServiceAuto-loguri-${stamp}`)

  await fs.mkdir(destDir, { recursive: true })

  const files = await fs.readdir(logsDir)
  let copied = 0
  for (const f of files) {
    const src = path.join(logsDir, f)
    try {
      const stat = await fs.stat(src)
      if (!stat.isFile()) continue
      await fs.copyFile(src, path.join(destDir, f))
      copied++
    } catch (err) {
      log.warn(`[logger] nu s-a putut copia fisierul de log ${f}`, err)
    }
  }

  return { destDir, copied }
}

export default log
