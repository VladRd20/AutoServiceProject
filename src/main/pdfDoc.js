import { calcTotaluri, calcLinieTotal, reduceriDinFisa } from '../shared/calculations'

// Constructia docDefinition-ului pdfmake - functii pure, fara electron/pdfmake,
// folosite de worker-ul de generare (vezi pdfRender.js) si de teste.

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

export function buildDocDefinition(fisa, settings) {
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
    fisa.auto?.capacitate || fisa.auto?.combustibil
      ? {
          columns: [
            { text: `Capacitate cilindrică: ${fisa.auto?.capacitate ? `${fisa.auto.capacitate} cmc` : '-'}` },
            { text: `Combustibil: ${{ diesel: 'Diesel', benzina: 'Benzină' }[fisa.auto?.combustibil] || '-'}` }
          ]
        }
      : null,
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
    fisa.observatiiPrint && fisa.observatii?.trim()
      ? { text: 'Observații', style: 'sectiune', margin: [0, 14, 0, 2] }
      : null,
    fisa.observatiiPrint && fisa.observatii?.trim() ? { text: fisa.observatii.trim() } : null,

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
