import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('../src/main/fileStore', () => ({ getSettings: vi.fn(async () => ({ numeService: 'Test SRL' })) }))
vi.mock('../src/main/logger', () => ({ default: { warn() {}, error() {}, info() {} } }))

import { buildDocDefinition } from '../src/main/pdfDoc'
import { handlePdfRequest } from '../src/main/pdfRender'
import { generatePdf, _setWorkerFactory } from '../src/main/pdfGenerator'

const fisa = {
  nr: '12',
  data: '2026-11-01',
  client: { nume: 'Ion Popescu', telefon: '069000000' },
  auto: { marca: 'Dacia', model: 'Logan', nrInmatriculare: 'ABC123', vin: 'X' },
  piese: [{ denumire: 'Filtru ulei', cantitate: 1, pretUnitar: 120 }],
  lucrari: [{ denumire: 'Schimb ulei', cantitate: 1, pret: 200 }],
  plata: { status: 'achitat', metoda: 'cash' }
}
const fontsDir = path.resolve('build/fonts')

describe('pdfDoc', () => {
  it('construieste un docDefinition cu antet de firma si totaluri', () => {
    const d = buildDocDefinition(fisa, { numeService: 'Test SRL' })
    expect(d.defaultStyle.font).toBe('Roboto')
    expect(JSON.stringify(d.content)).toContain('Test SRL')
    expect(JSON.stringify(d.content)).toContain('Total final')
  })
})

describe('pdfRender (calea reala a worker-ului)', () => {
  it('genereaza un PDF valid pe disc', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'))
    const dest = path.join(dir, 'a.pdf')
    const r = await handlePdfRequest({ id: 7, fisa, settings: { numeService: 'Test SRL' }, destPath: dest, fontsDir })
    expect(r).toEqual({ id: 7, ok: true, path: dest })
    const buf = fs.readFileSync(dest)
    expect(buf.subarray(0, 4).toString()).toBe('%PDF')
    expect(buf.length).toBeGreaterThan(2000)
    expect(fs.readdirSync(dir)).toEqual(['a.pdf']) // fara fisiere .tmp ramase
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('raporteaza FONT_MISSING ca raspuns de eroare, nu exceptie', async () => {
    const r = await handlePdfRequest({
      id: 1,
      fisa,
      settings: null,
      destPath: path.join(os.tmpdir(), 'x.pdf'),
      fontsDir: path.join(os.tmpdir(), 'nu-exista-fonts')
    })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('FONT_MISSING')
  })
})

describe('pdfGenerator (client worker)', () => {
  let procs
  function fakeProc() {
    const p = new EventEmitter()
    p.sent = []
    p.postMessage = (m) => p.sent.push(m)
    p.kill = vi.fn(() => p.emit('exit', 1))
    procs.push(p)
    return p
  }
  beforeEach(() => {
    process.env.SA_APPPATH ||= process.cwd() // fontsDir() are nevoie de app.getAppPath()
    procs = []
    _setWorkerFactory(fakeProc)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('trimite cererea si rezolva cu calea; refoloseste acelasi worker', async () => {
    const p1 = generatePdf(fisa, 'a.pdf')
    await vi.waitFor(() => expect(procs[0]?.sent).toHaveLength(1))
    expect(procs[0].sent[0]).toMatchObject({ destPath: 'a.pdf', settings: { numeService: 'Test SRL' } })
    procs[0].emit('message', { id: procs[0].sent[0].id, ok: true, path: 'a.pdf' })
    await expect(p1).resolves.toBe('a.pdf')

    const p2 = generatePdf(fisa, 'b.pdf')
    await vi.waitFor(() => expect(procs[0].sent).toHaveLength(2))
    procs[0].emit('message', { id: procs[0].sent[1].id, ok: true, path: 'b.pdf' })
    await expect(p2).resolves.toBe('b.pdf')
    expect(procs).toHaveLength(1)
    procs[0].emit('exit', 0)
  })

  it('cereri concurente sunt corelate dupa id', async () => {
    const pa = generatePdf(fisa, 'a.pdf')
    const pb = generatePdf(fisa, 'b.pdf')
    await vi.waitFor(() => expect(procs[0]?.sent).toHaveLength(2))
    const [ma, mb] = procs[0].sent
    procs[0].emit('message', { id: mb.id, ok: true, path: 'b.pdf' })
    procs[0].emit('message', { id: ma.id, ok: true, path: 'a.pdf' })
    await expect(pa).resolves.toBe('a.pdf')
    await expect(pb).resolves.toBe('b.pdf')
    procs[0].emit('exit', 0)
  })

  it('propaga eroarea worker-ului ca AppError', async () => {
    const p = generatePdf(fisa, 'a.pdf')
    await vi.waitFor(() => expect(procs[0]?.sent).toHaveLength(1))
    procs[0].emit('message', { id: procs[0].sent[0].id, ok: false, code: 'ENOSPC', userMessage: 'fara spatiu', detail: 'x' })
    await expect(p).rejects.toMatchObject({ code: 'ENOSPC', userMessage: 'fara spatiu' })
    procs[0].emit('exit', 0)
  })

  it('crash in timpul cererii => eroare, apoi worker nou', async () => {
    const p = generatePdf(fisa, 'a.pdf')
    await vi.waitFor(() => expect(procs[0]?.sent).toHaveLength(1))
    procs[0].emit('exit', 1)
    await expect(p).rejects.toMatchObject({ code: 'PDF_WORKER_CRASH' })

    const p2 = generatePdf(fisa, 'b.pdf')
    await vi.waitFor(() => expect(procs[1]?.sent).toHaveLength(1))
    procs[1].emit('message', { id: procs[1].sent[0].id, ok: true, path: 'b.pdf' })
    await expect(p2).resolves.toBe('b.pdf')
    procs[1].emit('exit', 0)
  })

  it('timeout 30s => PDF_TIMEOUT si worker-ul blocat e oprit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const p = generatePdf(fisa, 'a.pdf')
    const assertion = expect(p).rejects.toMatchObject({ code: 'PDF_TIMEOUT' })
    await vi.waitFor(() => expect(procs[0]?.sent).toHaveLength(1), { interval: 0 })
    await vi.advanceTimersByTimeAsync(30001)
    await assertion
    expect(procs[0].kill).toHaveBeenCalled()
  })

  it('exit tardiv al worker-ului vechi NU esueaza cererea worker-ului nou', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    procs.length = 0
    const pa = generatePdf(fisa, 'a.pdf')
    const assertA = expect(pa).rejects.toMatchObject({ code: 'PDF_TIMEOUT' })
    await vi.waitFor(() => expect(procs[0]?.sent).toHaveLength(1), { interval: 0 })
    // kill() nu emite exit imediat: exit-ul vine tarziu, dupa ce B e deja pe worker #2
    procs[0].kill = vi.fn()
    await vi.advanceTimersByTimeAsync(30001)
    await assertA
    expect(procs[0].kill).toHaveBeenCalled()

    const pb = generatePdf(fisa, 'b.pdf')
    await vi.waitFor(() => expect(procs[1]?.sent).toHaveLength(1), { interval: 0 })
    procs[0].emit('exit', 1) // exit tardiv al worker-ului #1
    procs[1].emit('message', { id: procs[1].sent[0].id, ok: true, path: 'b.pdf' })
    await expect(pb).resolves.toBe('b.pdf')
    procs[1].emit('exit', 0)
  })
})
