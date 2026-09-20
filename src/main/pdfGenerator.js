import path from 'path'
import fs from 'fs'
import PdfPrinter from 'pdfmake'
import { app, BrowserWindow } from 'electron'
import { calcTotaluri, calcLinieTotal, reduceriDinFisa } from '../shared/calculations'
import { toAppError, AppError } from './errors'
import { getSettings } from './fileStore'
import log from './logger'

// build/fonts in dev, resources/fonts dupa build (vezi extraResources in package.json)
function fontsDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'fonts')
    : path.join(app.getAppPath(), 'build', 'fonts')
}

// Fonturile sunt incarcate o singura data in memorie si refolosite la fiecare
// PDF generat - fara asta, fiecare finalizare/reincercare citea din nou cele
// 4 fisiere .ttf de pe disc, inutil, de vreme ce nu se schimba in timpul rularii.
let cachedFonts = null

function getFonts() {
  if (cachedFonts) return cachedFonts

  const dir = fontsDir()
  const variants = {
    normal: path.join(dir, 'Roboto-Regular.ttf'),
    bold: path.join(dir, 'Roboto-Medium.ttf'),
    italics: path.join(dir, 'Roboto-Italic.ttf'),
    bolditalic: path.join(dir, 'Roboto-MediumItalic.ttf')
  }

  const roboto = {}
  for (const [style, filePath] of Object.entries(variants)) {
    try {
      roboto[style] = fs.readFileSync(filePath)
    } catch (err) {
      throw new AppError(
        'FONT_MISSING',
        'Fișierele de font lipsesc din instalare. Reinstalează aplicația.',
        err
      )
    }
  }

  cachedFonts = { Roboto: roboto }
  return cachedFonts
}

function formatBani(n) {
  const [int, dec] = Math.abs(n).toFixed(2).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${n < 0 ? '-' : ''}${grouped},${dec} lei`
}

// Tabel cu antet colorat si linii subtiri - mai lizibil decat implicitul.
const tableLayout = {
  hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length ? 0.8 : 0.4),
  vLineWidth: () => 0,
  hLineColor: (i) => (i <= 1 ? '#1c3552' : '#dddddd'),
  fillColor: (row) => (row === 0 ? '#eef2f7' : null),
  paddingTop: () => 4,
  paddingBottom: () => 4
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

function hdr(cols) {
  return cols.map((text, i) => ({ text, bold: true, color: '#1c3552', alignment: i === 0 ? 'left' : 'right' }))
}

function tabelPiese(piese) {
  const body = [hdr(['Denumire', 'Cant.', 'Preț unitar', 'Preț total'])]
  for (const p of piese || []) {
    body.push([
      p.denumire || '-',
      { text: String(p.cantitate ?? '-'), alignment: 'right' },
      { text: formatBani(Number(p.pretUnitar) || 0), alignment: 'right' },
      { text: formatBani(calcLinieTotal(p.cantitate, p.pretUnitar)), alignment: 'right' }
    ])
  }
  return body
}

function tabelLucrari(lucrari) {
  const body = [hdr(['Denumire', 'Cant.', 'Preț', 'Preț total'])]
  for (const l of lucrari || []) {
    body.push([
      l.denumire || '-',
      { text: String(l.cantitate ?? '-'), alignment: 'right' },
      { text: formatBani(Number(l.pret) || 0), alignment: 'right' },
      { text: formatBani(calcLinieTotal(l.cantitate, l.pret)), alignment: 'right' }
    ])
  }
  return body
}

function buildDocDefinition(fisa, settings) {
  const reduceri = reduceriDinFisa(fisa)
  const totals = calcTotaluri(fisa.piese, fisa.lucrari, reduceri.piese, reduceri.lucrari)

  const antetService = [settings?.adresa, settings?.telefon, settings?.cui && `CUI/IDNO: ${settings.cui}`]
    .filter(Boolean)
    .join(' · ')

  const titluFisa = fisa.nr ? `Fișă de service auto nr. ${fisa.nr}` : 'Fișă de service auto'

  const content = [
    { canvas: [{ type: 'rect', x: 0, y: 0, w: 515, h: 4, color: '#1c3552' }], margin: [0, 0, 0, 10] },
    settings?.numeService
      ? { text: settings.numeService, style: 'firma' }
      : { text: 'Fișă de service auto', style: 'titlu' },
    settings?.numeService && antetService ? { text: antetService, style: 'firmaSub' } : null,
    settings?.numeService
      ? { text: titluFisa, style: 'sectiune', margin: [0, 10, 0, 2] }
      : null,
    !settings?.numeService && fisa.nr ? { text: `Nr. ${fisa.nr}`, margin: [0, 0, 0, 4] } : null,
    { text: `Data intervenției: ${formatDataAfisare(fisa)}`, margin: [0, 0, 0, 12] },

    { text: 'Client', style: 'sectiune' },
    {
      columns: [
        { text: `Nume: ${fisa.client?.nume || '-'}` },
        { text: `Telefon: ${fisa.client?.telefon || '-'}` }
      ],
      margin: fisa.client?.cui ? [0, 0, 0, 0] : [0, 0, 0, 10]
    },
    fisa.client?.cui ? { text: `CUI/IDNO: ${fisa.client.cui}`, margin: [0, 0, 0, 10] } : null,

    { text: 'Automobil', style: 'sectiune' },
    {
      columns: [
        { text: `Nr. înmatriculare: ${fisa.auto?.nrInmatriculare || '-'}` },
        { text: `An fabricație: ${fisa.auto?.an || '-'}` }
      ]
    },
    fisa.km !== undefined && String(fisa.km).trim() !== ''
      ? { text: `Kilometraj: ${fisa.km} km` }
      : null,
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
          layout: tableLayout,
          margin: [0, 0, 0, 6]
        }
      : { text: 'Nicio piesă adăugată.', italics: true, margin: [0, 0, 0, 6] },
    { text: `Total piese: ${formatBani(totals.totalPiese)}`, alignment: 'right' },
    totals.procentReducerePiese > 0
      ? {
          text: `Reducere piese (${totals.procentReducerePiese}%): -${formatBani(totals.valoareReducerePiese)}`,
          alignment: 'right',
          color: '#15803d',
          margin: [0, 0, 0, 10]
        }
      : { text: '', margin: [0, 0, 0, 10] },

    { text: 'Lucrări', style: 'sectiune' },
    (fisa.lucrari?.length ?? 0) > 0
      ? {
          table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto'], body: tabelLucrari(fisa.lucrari) },
          layout: tableLayout,
          margin: [0, 0, 0, 6]
        }
      : { text: 'Nicio lucrare adăugată.', italics: true, margin: [0, 0, 0, 6] },
    { text: `Total lucrări: ${formatBani(totals.totalLucrari)}`, alignment: 'right' },
    totals.procentReducereLucrari > 0
      ? {
          text: `Reducere lucrări (${totals.procentReducereLucrari}%): -${formatBani(totals.valoareReducereLucrari)}`,
          alignment: 'right',
          color: '#15803d',
          margin: [0, 0, 0, 10]
        }
      : { text: '', margin: [0, 0, 0, 10] },

    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: '#cccccc' }], margin: [0, 0, 0, 10] },

    { text: `Total general: ${formatBani(totals.totalGeneral)}`, alignment: 'right' },
    { text: `Total final: ${formatBani(totals.totalFinal)}`, alignment: 'right', style: 'totalFinal' },
    fisa.plata?.status
      ? {
          text: `Plată: ${fisa.plata.status === 'achitat' ? 'achitat' : 'neachitat'}${fisa.plata.metoda ? ` (${fisa.plata.metoda})` : ''}`,
          alignment: 'right',
          margin: [0, 2, 0, 0]
        }
      : null,
    fisa.observatii?.trim()
      ? { text: 'Observații', style: 'sectiune', margin: [0, 14, 0, 2] }
      : null,
    fisa.observatii?.trim() ? { text: fisa.observatii.trim() } : null,

    {
      unbreakable: true,
      margin: [0, 40, 0, 0],
      columns: [
        {
          stack: [
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.8, lineColor: '#888888' }] },
            { text: 'Semnătura service', fontSize: 9, color: '#666666', margin: [0, 4, 0, 0] }
          ]
        },
        {
          stack: [
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.8, lineColor: '#888888' }] },
            { text: 'Semnătura client', fontSize: 9, color: '#666666', margin: [0, 4, 0, 0] }
          ],
          alignment: 'right'
        }
      ]
    }
  ].filter(Boolean)

  return {
    content,
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: settings?.numeService || 'Service Auto', fontSize: 8, color: '#888888', margin: [40, 0, 0, 0] },
        { text: `Pagina ${currentPage} / ${pageCount}`, alignment: 'right', fontSize: 8, color: '#888888', margin: [0, 0, 40, 0] }
      ]
    }),
    styles: {
      titlu: { fontSize: 18, bold: true, margin: [0, 0, 0, 10] },
      firma: { fontSize: 16, bold: true, margin: [0, 0, 0, 2] },
      firmaSub: { fontSize: 9, color: '#555555', margin: [0, 0, 0, 4] },
      sectiune: { fontSize: 12, bold: true, color: '#1c3552', margin: [0, 6, 0, 4] },
      totalFinal: { fontSize: 14, bold: true, margin: [0, 4, 0, 0] }
    },
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.15 }
  }
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

// Genereaza PDF-ul si il scrie la calea data. Rezolva/respinge cand streamul
// e complet inchis pe disc (nu doar cand pdfkit termina de generat continutul).
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
    try {
      const printer = new PdfPrinter(getFonts())
      const docDefinition = buildDocDefinition(fisa, settings)
      const pdfDoc = printer.createPdfKitDocument(docDefinition)

      const tmpPath = `${destPath}.tmp-${process.pid}-${Date.now()}`
      const stream = fs.createWriteStream(tmpPath)

      stream.on('error', (err) => {
        log.error('[pdfGenerator] scriere esuata', err)
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
      log.error('[pdfGenerator] generare esuata', err)
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
