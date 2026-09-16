import log from 'electron-log/main'

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

export default log
