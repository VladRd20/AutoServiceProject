import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fisa, makeEnv } from './helpers'
import { sanitizeFisa } from '../src/main/sanitize'

vi.mock('../src/main/logger', () => ({ default: { warn() {}, error() {}, info() {} } }))

import { buildDocDefinition } from '../src/main/pdfDoc'

const base = (piese, lucrari = []) => fisa({ piese, lucrari })

describe('sanitizeFisa - canonicalizare numere tastate', () => {
  it('"48,5" / "2,5" / "1 234,5" -> forma cu punct, fara rotunjire', () => {
    const out = sanitizeFisa(
      base([{ id: 'a', denumire: 'x', cod: '', cantitate: '2,5', pretUnitar: '48,5' }], [
        { id: 'b', denumire: 'y', cantitate: '1', pret: '1 234,5' }
      ])
    )
    expect(out.piese[0].cantitate).toBe('2.5')
    expect(out.piese[0].pretUnitar).toBe('48.5')
    expect(out.lucrari[0].pret).toBe('1234.5')
  })

  it('valori deja canonice sau legacy raman identice (48.555 nu se rotunjeste)', () => {
    const f = base([
      { id: 'a', denumire: 'x', cod: '', cantitate: '2.5', pretUnitar: '48.555' },
      { id: 'b', denumire: 'y', cod: '', cantitate: 3, pretUnitar: 10 },
      { id: 'c', denumire: 'z', cod: '', cantitate: '', pretUnitar: '' }
    ])
    const once = sanitizeFisa(f)
    expect(once.piese.map((p) => [p.cantitate, p.pretUnitar])).toEqual([
      ['2.5', '48.555'],
      [3, 10],
      ['', '']
    ])
    expect(JSON.stringify(sanitizeFisa(once))).toBe(JSON.stringify(once))
  })

  it('text ne-numeric ramane neatins (validarea il semnaleaza)', () => {
    const out = sanitizeFisa(base([{ id: 'a', denumire: 'x', cod: '', cantitate: '1', pretUnitar: 'abc, 5' }]))
    expect(out.piese[0].pretUnitar).toBe('abc, 5')
  })
})

describe('pdfDoc - fisa veche cu virgula', () => {
  it('pretul unitar nu devine 0,00', () => {
    const d = buildDocDefinition(
      base([{ denumire: 'x', cantitate: '2,5', pretUnitar: '48,5' }], [{ denumire: 'y', cantitate: 1, pret: '10,25' }]),
      { numeService: 'T' }
    )
    const txt = JSON.stringify(d.content)
    expect(txt).toMatch(/48,50/)
    expect(txt).toMatch(/10,25/)
  })
})

describe('finalizare + rapoarte cu virgula', () => {
  let env
  beforeEach(async () => {
    env = await makeEnv()
  })
  afterEach(() => env.cleanup?.())

  it('stocat "48.5", raportul numara 2.5', async () => {
    const { fise, reports } = env.s
    const raw = base([{ id: 'p1', denumire: 'Filtru', cod: '', cantitate: '2,5', pretUnitar: '48,5' }])
    const clean = sanitizeFisa(raw)
    expect(clean.piese[0].pretUnitar).toBe('48.5')
    await fise.finalizeFisa(clean)
    const r = await reports.getRapoarte('interval', {})
    expect(r.topPiese[0].count).toBe(2.5)
  })

  it('fisier legacy ramas cu virgula (fara sanitize): raportul tot numara 2.5', async () => {
    const { fise, reports } = env.s
    await fise.finalizeFisa(base([{ id: 'p1', denumire: 'Filtru', cod: '', cantitate: '2,5', pretUnitar: '48,5' }]))
    const r = await reports.getRapoarte('interval', {})
    expect(r.topPiese[0].count).toBe(2.5)
  })
})
