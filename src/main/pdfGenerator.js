import path from 'path'
import fs from 'fs'
import PdfPrinter from 'pdfmake'
import { app } from 'electron'
import { calcTotaluri, calcLinieTotal } from '../shared/calculations'
import { toAppError, AppError } from './errors'
import log from './logger'

// build/fonts in dev, resources/fonts dupa build (vezi extraResources in package.json)
function fontsDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'fonts')
    : path.join(app.getAppPath(), 'build', 'fonts')
}

function getFonts() {
  const dir = fontsDir()
  const fonts = {
    Roboto: {
      normal: path.join(dir, 'Roboto-Regular.ttf'),
      bold: path.join(dir, 'Roboto-Medium.ttf'),
      italics: path.join(dir, 'Roboto-Italic.ttf'),
      bolditalic: path.join(dir, 'Roboto-MediumItalic.ttf')
    }
  }
  for (const variant of Object.values(fonts.Roboto)) {
    if (!fs.existsSync(variant)) {
      throw new AppError(
        'FONT_MISSING',
        'Fisierele de font lipsesc din instalare. Reinstaleaza aplicatia.',
        new Error(`Font lipsa: ${variant}`)
      )
    }
  }
  return fonts
}

function formatBani(n) {
  return `${n.toFixed(2)} lei`
}

function formatDataAfisare(fisa) {
  const dataISO = fisa?.data
  const [y, m, d] = String(dataISO || '').slice(0, 10).split('-')
  if (!y || !m || !d) return dataISO || '-'
  const dataStr = `${d}.${m}.${y}`

  // Cand fisa a fost finalizata cu "Data curenta" bifat, dataISO e un
  // datetime complet - afisam si ora exacta a finalizarii.
  if (fisa?.dataCurenta && dataISO.length > 10) {
    const dt = new Date(dataISO)
    if (!isNaN(dt)) {
      const hh = String(dt.getHours()).padStart(2, '0')
      const min = String(dt.getMinutes()).padStart(2, '0')
      return `${dataStr} ${hh}:${min}`
    }
  }

  return dataStr
}

function tabelPiese(piese) {
  const body = [['Denumire', 'Cant.', 'Pret unitar', 'Pret total']]
  for (const p of piese || []) {
    body.push([
      p.denumire || '-',
      String(p.cantitate ?? '-'),
      formatBani(Number(p.pretUnitar) || 0),
      formatBani(calcLinieTotal(p.cantitate, p.pretUnitar))
    ])
  }
  return body
}

function tabelLucrari(lucrari) {
  const body = [['Denumire', 'Cant.', 'Pret', 'Pret total']]
  for (const l of lucrari || []) {
    body.push([
      l.denumire || '-',
      String(l.cantitate ?? '-'),
      formatBani(Number(l.pret) || 0),
      formatBani(calcLinieTotal(l.cantitate, l.pret))
    ])
  }
  return body
}

function buildDocDefinition(fisa) {
  const totals = calcTotaluri(fisa.piese, fisa.lucrari, fisa.reducerePercent)

  const content = [
    { text: 'Fisa de service auto', style: 'titlu' },
    { text: `Data interventiei: ${formatDataAfisare(fisa)}`, margin: [0, 0, 0, 12] },

    { text: 'Client', style: 'sectiune' },
    {
      columns: [
        { text: `Nume: ${fisa.client?.nume || '-'}` },
        { text: `Telefon: ${fisa.client?.telefon || '-'}` }
      ],
      margin: [0, 0, 0, 10]
    },

    { text: 'Automobil', style: 'sectiune' },
    {
      columns: [
        { text: `Nr. inmatriculare: ${fisa.auto?.nrInmatriculare || '-'}` },
        { text: `An fabricatie: ${fisa.auto?.an || '-'}` }
      ]
    },
    {
      columns: [
        { text: `Marca: ${fisa.auto?.marca || '-'}` },
        { text: `Model: ${fisa.auto?.model || '-'}` }
      ]
    },
    { text: `VIN: ${fisa.auto?.vin || '-'}`, margin: [0, 0, 0, 10] },

    { text: 'Piese', style: 'sectiune' },
    (fisa.piese?.length ?? 0) > 0
      ? {
          table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto'], body: tabelPiese(fisa.piese) },
          layout: 'lightHorizontalLines',
          margin: [0, 0, 0, 6]
        }
      : { text: 'Nicio piesa adaugata.', italics: true, margin: [0, 0, 0, 6] },
    { text: `Total piese: ${formatBani(totals.totalPiese)}`, alignment: 'right', margin: [0, 0, 0, 10] },

    { text: 'Lucrari', style: 'sectiune' },
    (fisa.lucrari?.length ?? 0) > 0
      ? {
          table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto'], body: tabelLucrari(fisa.lucrari) },
          layout: 'lightHorizontalLines',
          margin: [0, 0, 0, 6]
        }
      : { text: 'Nicio lucrare adaugata.', italics: true, margin: [0, 0, 0, 6] },
    { text: `Total lucrari: ${formatBani(totals.totalLucrari)}`, alignment: 'right', margin: [0, 0, 0, 10] },

    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: '#cccccc' }], margin: [0, 0, 0, 10] },

    { text: `Total general: ${formatBani(totals.totalGeneral)}`, alignment: 'right' },
    totals.procentReducere > 0
      ? {
          text: `Reducere (${totals.procentReducere}%): -${formatBani(totals.valoareReducere)}`,
          alignment: 'right',
          color: '#b45309'
        }
      : null,
    { text: `Total final: ${formatBani(totals.totalFinal)}`, alignment: 'right', style: 'totalFinal' }
  ].filter(Boolean)

  return {
    content,
    styles: {
      titlu: { fontSize: 18, bold: true, margin: [0, 0, 0, 10] },
      sectiune: { fontSize: 13, bold: true, margin: [0, 6, 0, 4] },
      totalFinal: { fontSize: 14, bold: true, margin: [0, 4, 0, 0] }
    },
    defaultStyle: { font: 'Roboto', fontSize: 10 }
  }
}

// Genereaza PDF-ul si il scrie la calea data. Rezolva/respinge cand streamul
// e complet inchis pe disc (nu doar cand pdfkit termina de generat continutul).
export function generatePdf(fisa, destPath) {
  return new Promise((resolve, reject) => {
    try {
      const printer = new PdfPrinter(getFonts())
      const docDefinition = buildDocDefinition(fisa)
      const pdfDoc = printer.createPdfKitDocument(docDefinition)

      const tmpPath = `${destPath}.tmp-${process.pid}-${Date.now()}`
      const stream = fs.createWriteStream(tmpPath)

      stream.on('error', (err) => {
        log.error('[pdfGenerator] scriere esuata', err)
        reject(toAppError(err, 'Nu s-a putut scrie fisierul PDF pe disc.'))
      })

      stream.on('finish', () => {
        fs.rename(tmpPath, destPath, (err) => {
          if (err) {
            reject(toAppError(err, 'PDF-ul a fost generat dar nu a putut fi salvat definitiv.'))
          } else {
            resolve(destPath)
          }
        })
      })

      pdfDoc.pipe(stream)
      pdfDoc.end()
    } catch (err) {
      log.error('[pdfGenerator] generare esuata', err)
      reject(toAppError(err, 'Generarea PDF-ului a esuat.'))
    }
  })
}
