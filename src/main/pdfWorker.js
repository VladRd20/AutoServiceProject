import { handlePdfRequest, installFailureGuard } from './pdfRender'

// Punctul de intrare al utilityProcess-ului de generare PDF. Primeste cereri
// prin parentPort si raspunde cu rezultatul; procesul ramane viu intre cereri
// (pdfmake + fonturile se incarca o singura data).
const reply = (msg) => process.parentPort.postMessage(msg)

installFailureGuard(process, reply)

process.parentPort.on('message', async (e) => {
  reply(await handlePdfRequest(e.data))
})
