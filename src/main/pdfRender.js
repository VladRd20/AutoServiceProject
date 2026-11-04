import path from 'path'
import fs from 'fs'
import PdfPrinter from 'pdfmake'
import { toAppError, AppError } from './errors'
import { buildDocDefinition } from './pdfDoc'

// Partea care ruleaza in worker (utilityProcess): incarca fonturile asincron,
// genereaza PDF-ul cu pdfmake si il scrie atomic (temp + rename). Nu importa
// nimic din electron, ca sa poata fi testata direct in Node.

// Fonturile se citesc o singura data per worker si se refolosesc.
let fontsPromise = null
let fontsPromiseDir = null

function loadFonts(dir) {
  if (fontsPromise && fontsPromiseDir === dir) return fontsPromise
  const variants = {
    normal: 'Roboto-Regular.ttf',
    bold: 'Roboto-Medium.ttf',
    italics: 'Roboto-Italic.ttf',
    bolditalic: 'Roboto-MediumItalic.ttf'
  }
  fontsPromiseDir = dir
  const p = Promise.all(
    Object.entries(variants).map(async ([style, file]) => {
      try {
        return [style, await fs.promises.readFile(path.join(dir, file))]
      } catch (err) {
        throw new AppError('FONT_MISSING', 'Fișierele de font lipsesc din instalare. Reinstalează aplicația.', err)
      }
    })
  ).then((entries) => ({ Roboto: Object.fromEntries(entries) }))
  fontsPromise = p
  // Esec => nu pastram promisiunea respinsa in cache.
  p.catch(() => {
    if (fontsPromise === p) fontsPromise = null
  })
  return p
}

// Un viewer PDF deschis (sau antivirusul) poate bloca scurt fisierul tinta: EPERM/EBUSY
// se reincearca de cateva ori inainte sa fie tratate ca eroare.
function renameWithRetry(from, to, attemptsLeft, cb) {
  fs.rename(from, to, (err) => {
    if (err && ['EPERM', 'EBUSY', 'EACCES'].includes(err.code) && attemptsLeft > 1) {
      setTimeout(() => renameWithRetry(from, to, attemptsLeft - 1, cb), 150)
    } else {
      cb(err)
    }
  })
}

// Rezolva/respinge cand streamul e complet inchis pe disc.
export async function renderPdf({ fisa, settings, destPath, fontsDir }) {
  const fonts = await loadFonts(fontsDir)
  return new Promise((resolve, reject) => {
    try {
      const printer = new PdfPrinter(fonts)
      const docDefinition = buildDocDefinition(fisa, settings)
      const pdfDoc = printer.createPdfKitDocument(docDefinition)

      const tmpPath = `${destPath}.tmp-${process.pid}-${Date.now()}`
      const stream = fs.createWriteStream(tmpPath)

      stream.on('error', (err) => {
        fs.unlink(tmpPath, () => {})
        reject(toAppError(err, 'Nu s-a putut scrie fișierul PDF pe disc.'))
      })

      stream.on('finish', () => {
        renameWithRetry(tmpPath, destPath, 4, (err) => {
          if (err) {
            fs.unlink(tmpPath, () => {})
            reject(toAppError(err, 'PDF-ul a fost generat dar nu a putut fi salvat definitiv.'))
          } else {
            resolve(destPath)
          }
        })
      })

      pdfDoc.pipe(stream)
      pdfDoc.end()
    } catch (err) {
      reject(toAppError(err, 'Generarea PDF-ului a eșuat.'))
    }
  })
}

// Cereri aflate in lucru in acest worker (id-urile), ca sa putem raspunde cu
// eroare daca procesul are o respingere/exceptie necapturata.
const inFlight = new Set()

function errorReply(id, err) {
  const e = toAppError(err, 'Generarea PDF-ului a eșuat.')
  return {
    id,
    ok: false,
    code: e.code,
    userMessage: e.userMessage,
    detail: String(e.cause?.message || e.message)
  }
}

// Din Electron 37, un unhandledRejection intr-un utilityProcess NU mai opreste
// procesul. Fara asta, o respingere scapata (ex. dintr-un callback de stream)
// ar lasa cererea fara raspuns pana la timeout-ul de 30s din procesul principal.
// Aici raspundem cu eroare la toate cererile aflate in lucru. `proc` e `process`
// (injectabil in teste); `reply` trimite raspunsul prin parentPort.
export function installFailureGuard(proc, reply) {
  const failAll = (reason) => {
    for (const id of [...inFlight]) {
      inFlight.delete(id)
      try {
        reply(errorReply(id, reason instanceof Error ? reason : new Error(String(reason))))
      } catch {
        /* canalul spre procesul principal s-a inchis */
      }
    }
  }
  proc.on('unhandledRejection', failAll)
  proc.on('uncaughtException', failAll)
}

// Protocol: {id, fisa, settings, destPath, fontsDir}
//   -> {id, ok:true, path} | {id, ok:false, code, userMessage, detail}
export async function handlePdfRequest(msg) {
  inFlight.add(msg.id)
  try {
    const out = await renderPdf(msg)
    return { id: msg.id, ok: true, path: out }
  } catch (err) {
    return errorReply(msg.id, err)
  } finally {
    inFlight.delete(msg.id)
  }
}
