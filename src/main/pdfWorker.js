import { handlePdfRequest } from './pdfRender'

// Punctul de intrare al utilityProcess-ului de generare PDF. Primeste cereri
// prin parentPort si raspunde cu rezultatul; procesul ramane viu intre cereri
// (pdfmake + fonturile se incarca o singura data).
process.parentPort.on('message', async (e) => {
  const reply = await handlePdfRequest(e.data)
  process.parentPort.postMessage(reply)
})
